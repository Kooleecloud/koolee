/**
 * Koolee design tokens.
 *
 * Single source of truth for the colour system. Injected as CSS custom
 * properties by the Tailwind preset (see `tailwind-preset.js`), so every app
 * gets identical tokens without importing CSS across package boundaries.
 *
 * Values are bare HSL channels — the preset wraps them in `hsl(...)`.
 *
 * Brand anchors (see also the literal scales in `tailwind-preset.js`):
 *   navy #0B2545 → 213 73% 16%   depth, reliability — headings, dark sections
 *   sky  #38B6E3 → 196 75% 55%   movement, air — accents, links, progress
 *   tag  #FF6B35 → 16 100% 60%   CTA ONLY — the colour of the physical seal tag
 */

const light = {
  /* Warm off-white (#F8F9FB-ish) — generous whitespace reads calm, not sterile */
  "--background": "220 27% 98%",
  "--foreground": "215 45% 15%",

  "--card": "0 0% 100%",
  "--card-foreground": "215 45% 15%",

  "--popover": "0 0% 100%",
  "--popover-foreground": "215 45% 15%",

  /* Koolee navy — primary surfaces, headings, footer */
  "--primary": "213 73% 16%",
  "--primary-foreground": "210 40% 98%",

  "--secondary": "213 35% 94%",
  "--secondary-foreground": "213 73% 16%",

  "--muted": "215 30% 94%",
  "--muted-foreground": "215 18% 42%",

  /* Koolee sky — links, progress, illustration accents */
  "--accent": "196 75% 55%",
  "--accent-foreground": "213 73% 16%",

  "--destructive": "0 72% 51%",
  "--destructive-foreground": "210 40% 98%",

  "--success": "142 71% 34%",
  "--success-foreground": "210 40% 98%",

  "--warning": "38 92% 45%",
  "--warning-foreground": "215 45% 15%",

  "--border": "215 28% 89%",
  "--input": "215 28% 85%",
  "--ring": "196 75% 45%",

  "--radius": "0.625rem",
};

const dark = {
  "--background": "214 60% 7%",
  "--foreground": "210 40% 98%",

  "--card": "213 55% 11%",
  "--card-foreground": "210 40% 98%",

  "--popover": "213 55% 11%",
  "--popover-foreground": "210 40% 98%",

  /* In the dark theme sky carries the brand — navy has no contrast to give */
  "--primary": "196 75% 55%",
  "--primary-foreground": "213 73% 12%",

  "--secondary": "214 40% 16%",
  "--secondary-foreground": "210 40% 98%",

  "--muted": "214 40% 16%",
  "--muted-foreground": "213 20% 68%",

  "--accent": "196 75% 55%",
  "--accent-foreground": "213 73% 12%",

  "--destructive": "0 63% 45%",
  "--destructive-foreground": "210 40% 98%",

  "--success": "142 60% 45%",
  "--success-foreground": "213 73% 12%",

  "--warning": "38 92% 55%",
  "--warning-foreground": "213 73% 12%",

  "--border": "214 40% 18%",
  "--input": "214 40% 20%",
  "--ring": "196 75% 55%",
};

module.exports = { light, dark };
