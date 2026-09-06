import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The app icon is one drawing. Next's metadata convention needs a physical
 * file inside each app's `src/app`, so the tile is necessarily copied per app
 * — this test is what keeps those copies honest.
 *
 * Before 2026-08-29 admin shipped no icon at all and agent had only PWA
 * icons, so a browser tab showed a generic page glyph for two of the three
 * apps. If you intentionally change the mark, update `brand/app-tile.svg` and
 * re-copy it to every app; do not edit one app's copy directly.
 *
 * Web is the in-repo reference rather than `brand/` because `brand/` has been
 * gitignored since 2026-08-01 and so is absent from a fresh clone and from
 * CI. When it is present it is cross-checked too — see the last case.
 */
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const REFERENCE_APP = "web";
const COPY_APPS = ["admin", "agent"];
/** Every file Next serves as this app's identity in a tab, on a home screen. */
const ICON_FILES = ["icon.svg", "favicon.ico", "apple-icon.png"];

/** Binary-safe: apple-icon.png and favicon.ico are compared the same way. */
const digest = (relPath: string) =>
  createHash("sha256")
    .update(readFileSync(repoRoot + relPath))
    .digest("hex");

describe("brand asset parity", () => {
  it.each(ICON_FILES)("every app ships the same %s", (asset) => {
    const expected = digest(`apps/${REFERENCE_APP}/src/app/${asset}`);
    for (const app of COPY_APPS) {
      expect(
        digest(`apps/${app}/src/app/${asset}`),
        `apps/${app}/src/app/${asset} has drifted from ${REFERENCE_APP}'s`,
      ).toBe(expected);
    }
  });

  it("matches the brand vector source when it is checked out", (context) => {
    const source = "brand/app-tile.svg";
    if (!existsSync(repoRoot + source)) return context.skip();
    expect(
      digest(`apps/${REFERENCE_APP}/src/app/icon.svg`),
      `the app icons have drifted from ${source}`,
    ).toBe(digest(source));
  });
});
