#!/usr/bin/env node
/**
 * Copies MapLibre's tile-parsing worker into an app's `public/` so it can be
 * served same-origin, at a URL we control.
 *
 * WHY THIS EXISTS — the bug it fixes, in full, because it is invisible.
 *
 * maplibre-gl 6 decides where its worker lives like this:
 *
 *     function getWorkerUrl() {
 *       const here = import.meta.url;
 *       if (!/^https?:/.test(here)) return "";        // <-- the whole bug
 *       return new URL("./maplibre-gl-worker.mjs", here).href;
 *     }
 *
 * It assumes the library is loaded as an unbundled ES module served over HTTP,
 * where `import.meta.url` really is `https://…/maplibre-gl.mjs` and the worker
 * is its sibling on disk. Under a bundler that is false: Turbopack rewrites the
 * module and `import.meta.url` is not an `http(s):` URL, so the guard returns
 * the EMPTY STRING and MapLibre goes on to call
 *
 *     new Worker("", { type: "module" })
 *
 * An empty URL resolves against the document, so the browser fetches the
 * current PAGE and tries to run the HTML as a module. It fails, the Worker
 * emits an `error` event — and MapLibre never re-raises that as a map `error`,
 * so nothing anywhere reports a problem.
 *
 * What you SEE is: the style JSON, the TileJSON and the sprites all fetch and
 * return 200, the canvas mounts at the right size, the zoom buttons work, and
 * not one glyph or vector tile is ever requested. A blank cream rectangle that
 * never resolves, forever. `load` never fires, which is why `LiveMap`'s
 * ten-second deadline is the only thing that catches it at all.
 *
 * It affects EVERY bundler, not just Vite's dependency optimizer (which the
 * Storybook config already works around, for what was believed to be the same
 * failure and is in fact a second, older one). It is why the map was broken on
 * a laptop and on Vercel identically.
 *
 * THE FIX. Serve the worker ourselves and tell MapLibre where it is, via
 * `setWorkerUrl` in `packages/ui/src/components/live-map.tsx`. That path is
 * app-root-relative and same-origin, so MapLibre constructs the worker
 * directly rather than going through its cross-origin blob dance.
 *
 * TWO FILES, NOT ONE. `maplibre-gl-worker.mjs` is a real ES module and its
 * first line imports `./maplibre-gl-shared.mjs` — a relative specifier
 * resolved against the WORKER's own URL. Copy only the worker and the worker
 * 404s on its import, which fails exactly as silently as the empty URL did.
 *
 * COPIED AT BUILD TIME, NEVER COMMITTED. Vendoring half a megabyte of a
 * dependency's build output into git is a copy that drifts the moment somebody
 * bumps the version, and nothing would fail when it did. Here the copy is
 * regenerated from `node_modules` on every `dev` and every `build`, so it
 * cannot be stale, and `public/maplibre/` is gitignored.
 *
 * Usage: node scripts/copy-maplibre-worker.mjs <app-dir>
 *   e.g. node ../../scripts/copy-maplibre-worker.mjs apps/web
 */

import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The worker and the module it imports. Both, or neither works. */
const ASSETS = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

/** Where the copies land, relative to the app. Mirrors `WORKER_URL` in live-map.tsx. */
const PUBLIC_SUBDIR = path.join("public", "maplibre");

async function main() {
  const appArg = process.argv[2];
  if (!appArg) {
    console.error("usage: node scripts/copy-maplibre-worker.mjs <app-dir>");
    process.exit(1);
  }

  const appDir = path.resolve(REPO_ROOT, appArg);

  /*
   * Resolved from the APP, not from this script. Under pnpm's isolated
   * node-linker the app has its own `maplibre-gl` symlink, and resolving from
   * the repo root could find a different copy — or none at all.
   */
  const requireFromApp = createRequire(path.join(appDir, "package.json"));
  let distDir;
  try {
    distDir = path.dirname(
      requireFromApp.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"),
    );
  } catch (error) {
    console.error(
      `[copy-maplibre-worker] maplibre-gl is not resolvable from ${appArg}. ` +
        `Add it as a dependency, or drop this step from that app's scripts.`,
    );
    throw error;
  }

  const targetDir = path.join(appDir, PUBLIC_SUBDIR);
  await mkdir(targetDir, { recursive: true });

  for (const asset of ASSETS) {
    await copyFile(path.join(distDir, asset), path.join(targetDir, asset));
  }

  /*
   * A note beside the copies, for whoever finds them and wonders. `public/` is
   * the one directory in a Next app where a stray file is served to the world,
   * so an unexplained one there deserves an explanation in place.
   */
  const version = JSON.parse(
    await readFile(requireFromApp.resolve("maplibre-gl/package.json"), "utf8"),
  ).version;
  await writeFile(
    path.join(targetDir, "README.md"),
    [
      "# Generated — do not edit, do not commit",
      "",
      `Copied from \`maplibre-gl@${version}\` by \`scripts/copy-maplibre-worker.mjs\`,`,
      "which runs before every `dev` and every `build`. This directory is",
      "gitignored.",
      "",
      "MapLibre 6 works out the URL of its tile-parsing worker from",
      "`import.meta.url` and gives up — returning an empty string, and then",
      'constructing `new Worker("")` — whenever that is not an `http(s):` URL,',
      "which under any bundler it is not. The map then fetches its style, its",
      "TileJSON and its sprites successfully and never requests a single tile,",
      "raising no error. Serving the worker from here and pointing",
      "`setWorkerUrl` at it is the fix; see the header of",
      "`scripts/copy-maplibre-worker.mjs` for the whole story.",
      "",
    ].join("\n"),
  );

  console.log(
    `[copy-maplibre-worker] maplibre-gl@${version} → ${path.relative(REPO_ROOT, targetDir)}`,
  );
}

await main();
