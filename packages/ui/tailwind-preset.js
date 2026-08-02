const plugin = require("tailwindcss/plugin");
const { light, dark } = require("./theme-tokens");

/**
 * Injects the Koolee design tokens plus a small base layer.
 *
 * Tokens ship through the preset rather than a shared CSS file so apps never
 * have to `@import` across a package boundary — that path is brittle inside
 * Next's PostCSS pipeline.
 */
const kooleeBase = plugin(({ addBase }) => {
  addBase({
    ":root": light,
    ".dark": dark,
    "*": { borderColor: "hsl(var(--border))" },
    body: {
      backgroundColor: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      "-webkit-font-smoothing": "antialiased",
      fontFeatureSettings: '"rlig" 1, "calt" 1',
    },
  });
});

/**
 * Shared Tailwind preset for every Koolee app.
 *
 * Apps import this and add their own `content` globs.
 *
 * @type {import("tailwindcss").Config}
 */
module.exports = {
  darkMode: ["class"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        /*
         * Brand scales as literals: these are the brand, they do not flip
         * with the theme. Semantic tokens (primary/accent/…) stay CSS vars.
         *
         * `tag` is the colour of the physical tamper-evident seal — reserve
         * it for primary CTAs and the seal motif. Never decoration.
         */
        navy: {
          DEFAULT: "#0B2545",
          50: "#EEF2F8",
          100: "#DCE4F0",
          200: "#B4C5DE",
          300: "#84A0C6",
          400: "#4E74A3",
          500: "#2C517E",
          600: "#1B3A61",
          700: "#122E50",
          800: "#0B2545",
          900: "#081B33",
          950: "#051222",
        },
        sky: {
          DEFAULT: "#38B6E3",
          50: "#EDF8FD",
          100: "#D9F1FA",
          200: "#AEE2F5",
          300: "#7BD0EE",
          400: "#38B6E3",
          500: "#1E9DCB",
          600: "#177FA6",
          700: "#136683",
          800: "#114F65",
          900: "#0E3D4E",
        },
        tag: {
          DEFAULT: "#FF6B35",
          50: "#FFF2EC",
          100: "#FFE3D6",
          200: "#FFC5AC",
          300: "#FF9F76",
          400: "#FF6B35",
          500: "#F04F14",
          600: "#D6430D",
          700: "#B0370C",
          800: "#8C2E10",
        },
        cream: "#F8F9FB",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        /* Display face for headlines — airline-signage geometric sans. */
        display: [
          "var(--font-display)",
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        /* Fluid display sizes so headlines stay confident at 375px and 1440px. */
        "display-lg": [
          "clamp(2.5rem, 1.6rem + 4vw, 4.5rem)",
          { lineHeight: "1.05", letterSpacing: "-0.02em" },
        ],
        display: [
          "clamp(2rem, 1.4rem + 2.6vw, 3.25rem)",
          { lineHeight: "1.1", letterSpacing: "-0.02em" },
        ],
        "display-sm": [
          "clamp(1.5rem, 1.2rem + 1.4vw, 2.25rem)",
          { lineHeight: "1.15", letterSpacing: "-0.01em" },
        ],
      },
      boxShadow: {
        /* Soft elevation for cards — depth without corporate gloss. */
        lift: "0 1px 2px rgba(11, 37, 69, 0.06), 0 8px 24px rgba(11, 37, 69, 0.08)",
        "lift-lg":
          "0 2px 4px rgba(11, 37, 69, 0.06), 0 16px 40px rgba(11, 37, 69, 0.12)",
      },
      transitionTimingFunction: {
        /* House ease: quick start, calm landing. */
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), kooleeBase],
};
