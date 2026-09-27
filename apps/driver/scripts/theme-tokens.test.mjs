import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildTokens, renderTokens } from "./theme-tokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("theme-tokens", () => {
  it("converts HSL channels to RGB triplets and keeps brand hex scales", () => {
    const css = `
      :root { --primary: 213 73% 16%; --radius: 0.625rem; --font-sans: x; }
      .dark { --primary: 210 40% 98%; }
      @theme { --color-navy-800: #0b2545; --color-navy: #0b2545; --color-cream: #f8f9fb; --color-sky-950: initial; --color-primary: hsl(var(--primary)); }
    `;
    const t = buildTokens(css);
    // theme.css carries rounded HSL channels, so the triplet lands within a
    // unit or two of the brand hex (#0b2545 = 11 37 69) — the same drift the
    // web has, since the browser does this exact conversion.
    const light = t.vars.light["--primary"].split(" ").map(Number);
    expect(light).toHaveLength(3);
    expect(
      Math.abs(light[0] - 11) + Math.abs(light[1] - 37) + Math.abs(light[2] - 69),
    ).toBeLessThanOrEqual(4);
    expect(t.vars.dark["--primary"]).toMatch(/^\d+ \d+ \d+$/);
    expect(t.colors.primary).toBe("rgb(var(--primary) / <alpha-value>)");
    expect(t.colors.navy).toEqual({ 800: "#0b2545", DEFAULT: "#0b2545" });
    expect(t.colors.cream).toBe("#f8f9fb");
    expect(t.colors.sky).toBeUndefined();
    expect(t.borderRadius).toEqual({ lg: "10px", md: "8px", sm: "6px" });
  });

  it("the committed tailwind.tokens.js is what theme.css produces today", () => {
    const css = readFileSync(
      resolve(here, "../../../packages/ui/styles/theme.css"),
      "utf8",
    );
    const expected = renderTokens(buildTokens(css));
    const committed = readFileSync(resolve(here, "../tailwind.tokens.js"), "utf8");
    // Regenerate with `pnpm --filter @koolee/driver tokens` when theme.css changes.
    expect(committed).toBe(expected);
  });
});
