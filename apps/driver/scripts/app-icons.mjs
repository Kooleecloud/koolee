/**
 * Renders the app's icons, splash mark and notification icon from the brand
 * SVGs in `brand/` — the same source the web favicons and PWA icons come
 * from, so the phone's home screen shows the mark the web shows.
 *
 * WHY A SCRIPT. Each platform wants the mark differently, and getting any of
 * them wrong is a store rejection or a white square:
 *
 *  - iOS: one 1024 px OPAQUE square, full-bleed navy. No alpha (App Store
 *    Connect refuses it) and no rounded corners (iOS applies its own mask —
 *    baked-in corners show as a second, smaller rounding).
 *  - Android adaptive: the mark on a TRANSPARENT 1024 px foreground, kept
 *    inside the 66 dp safe circle of the 108 dp canvas because launchers crop
 *    to circles, squircles and teardrops; the navy is a separate background
 *    layer. Plus a single-colour monochrome layer for Android 13 themed icons.
 *  - Splash: the inverse mark on transparent; app.json paints the navy.
 *  - Notification (Android small icon): WHITE on transparent, silhouette only
 *    — Android draws the alpha channel and ignores colour, so the orange
 *    grommet and sky arm would vanish or blot.
 *
 * Run `pnpm --filter @koolee/driver icons` whenever a brand SVG changes, and
 * commit the PNGs.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const BRAND = resolve(here, "../../../brand");
const OUT = resolve(here, "../assets/images");

const NAVY = "#0B2545";

/** The drawing inside an SVG file: everything between `<svg …>` and `</svg>`. */
export function innerSvg(svgText) {
  const open = svgText.indexOf(">", svgText.indexOf("<svg"));
  const close = svgText.lastIndexOf("</svg>");
  if (open < 0 || close < 0) throw new Error("not an SVG document");
  return svgText.slice(open + 1, close).trim();
}

/** Every stroke and fill in a drawing, forced to one colour. */
export function monochrome(inner, colour) {
  return inner
    .replace(/stroke="#[0-9a-fA-F]{3,8}"/g, `stroke="${colour}"`)
    .replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${colour}"`);
}

/**
 * The mark (a 48-unit drawing) centred on a 48-unit canvas at `scale`, with
 * an optional solid ground. Rendered at `size` pixels.
 */
export function composeSvg({ inner, scale, size, ground = null }) {
  const offset = (48 - 48 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">${
    ground ? `<rect width="48" height="48" fill="${ground}"/>` : ""
  }<g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g></svg>`;
}

async function write(name, svg, { opaque = false } = {}) {
  let image = sharp(Buffer.from(svg));
  // `flatten` drops the alpha channel entirely — iOS store icons must have none.
  if (opaque) image = image.flatten({ background: NAVY });
  await image.png().toFile(resolve(OUT, name));
  console.log(`wrote assets/images/${name}`);
}

async function main() {
  const inverse = innerSvg(readFileSync(resolve(BRAND, "logo-icon-inverse.svg"), "utf8"));
  const mono = innerSvg(readFileSync(resolve(BRAND, "logo-icon-mono.svg"), "utf8"));
  const white = monochrome(mono, "#FFFFFF");

  // iOS: the brand's app tile (`brand/app-tile.svg`, the mark at 0.68) with
  // its corner radius left to iOS's own mask, which has the same ~22 %.
  await write(
    "icon.png",
    composeSvg({ inner: inverse, scale: 0.68, size: 1024, ground: NAVY }),
    {
      opaque: true,
    },
  );

  // Android adaptive: at 0.5 the mark's diagonal is ~59 % of the canvas,
  // inside the 61 % safe circle.
  await write(
    "android-icon-foreground.png",
    composeSvg({ inner: inverse, scale: 0.5, size: 1024 }),
  );
  await write(
    "android-icon-background.png",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1024" height="1024"><rect width="48" height="48" fill="${NAVY}"/></svg>`,
  );
  await write(
    "android-icon-monochrome.png",
    composeSvg({ inner: white, scale: 0.5, size: 1024 }),
  );

  // Splash: shown at 120 dp on navy (app.json), so the full mark, no ground.
  await write("splash-icon.png", composeSvg({ inner: inverse, scale: 0.9, size: 1024 }));

  // Android status-bar icon: 96 px (xxxhdpi of 24 dp), white silhouette.
  await write(
    "notification-icon.png",
    composeSvg({ inner: white, scale: 0.9, size: 96 }),
  );

  // Web (expo export only; the app ships no web build): the brand tile as is.
  await sharp(readFileSync(resolve(BRAND, "app-tile.svg")))
    .resize(48, 48)
    .png()
    .toFile(resolve(OUT, "favicon.png"));
  console.log("wrote assets/images/favicon.png");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
