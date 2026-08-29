/**
 * The Koolee type system, in one place.
 *
 * Sora for display (geometric, airline-signage confidence), Inter for body
 * (quiet, highly readable). The CSS variables these expose are what
 * `styles/theme.css` reads for the `font-display` / `font-sans` families —
 * an app that mounts the classes below gets the brand type, and an app that
 * forgets silently renders every heading in system-ui.
 *
 * Imported through the `@koolee/ui/fonts` subpath, never the package barrel:
 * `next/font` only resolves inside a Next build, and Storybook builds this
 * package with Vite.
 */
import { Inter, Sora } from "next/font/google";

export const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/**
 * Everything `<body>` needs for brand type: both font variables plus the
 * `font-sans` default. Every app's root layout spreads this onto `<body>`.
 */
export const brandFontClassName = `${sora.variable} ${inter.variable} font-sans`;
