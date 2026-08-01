/**
 * Koolee design tokens.
 *
 * Single source of truth for the colour system. Injected as CSS custom
 * properties by the Tailwind preset (see `tailwind-preset.js`), so every app
 * gets identical tokens without importing CSS across package boundaries.
 *
 * Values are bare HSL channels — the preset wraps them in `hsl(...)`.
 */

const light = {
  "--background": "0 0% 100%",
  "--foreground": "222 47% 11%",

  "--card": "0 0% 100%",
  "--card-foreground": "222 47% 11%",

  "--popover": "0 0% 100%",
  "--popover-foreground": "222 47% 11%",

  /* Koolee brand: deep travel blue */
  "--primary": "214 90% 32%",
  "--primary-foreground": "210 40% 98%",

  "--secondary": "210 40% 96%",
  "--secondary-foreground": "222 47% 11%",

  "--muted": "210 40% 96%",
  "--muted-foreground": "215 16% 47%",

  "--accent": "190 90% 42%",
  "--accent-foreground": "222 47% 11%",

  "--destructive": "0 72% 51%",
  "--destructive-foreground": "210 40% 98%",

  "--success": "142 71% 34%",
  "--success-foreground": "210 40% 98%",

  "--warning": "38 92% 45%",
  "--warning-foreground": "222 47% 11%",

  "--border": "214 32% 91%",
  "--input": "214 32% 91%",
  "--ring": "214 90% 32%",

  "--radius": "0.625rem",
};

const dark = {
  "--background": "222 47% 8%",
  "--foreground": "210 40% 98%",

  "--card": "222 47% 11%",
  "--card-foreground": "210 40% 98%",

  "--popover": "222 47% 11%",
  "--popover-foreground": "210 40% 98%",

  "--primary": "214 90% 60%",
  "--primary-foreground": "222 47% 11%",

  "--secondary": "217 33% 18%",
  "--secondary-foreground": "210 40% 98%",

  "--muted": "217 33% 18%",
  "--muted-foreground": "215 20% 65%",

  "--accent": "190 90% 50%",
  "--accent-foreground": "222 47% 11%",

  "--destructive": "0 63% 45%",
  "--destructive-foreground": "210 40% 98%",

  "--success": "142 60% 45%",
  "--success-foreground": "222 47% 11%",

  "--warning": "38 92% 55%",
  "--warning-foreground": "222 47% 11%",

  "--border": "217 33% 20%",
  "--input": "217 33% 20%",
  "--ring": "214 90% 60%",
};

module.exports = { light, dark };
