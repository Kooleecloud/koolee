/**
 * Single source of truth for public, static site facts: brand name, tagline,
 * contact email, metadata copy, served airports. Anything a visitor can read
 * that we may need to change later belongs here, not inline in a page.
 *
 * Env vars (`@/env`) are for per-environment values (URLs, keys) — not for
 * public content like this, which should be versioned and type-checked.
 */

const NAME = "Koolee";
const TAGLINE = "Fly Hassle-Free";

export const SITE = {
  name: NAME,
  tagline: TAGLINE,
  /** Default `<title>` and OG title. */
  title: `${NAME} — ${TAGLINE}`,
  /** `<title>` template for pages that set their own title. */
  titleTemplate: `%s · ${NAME}`,
  description:
    "Off-airport luggage pickup in NYC. From your doorstep to your airline's bag drop at JFK, LGA, or EWR — we seal every bag at your door, so you skip the haul and the bag-drop line.",
  ogDescription:
    "Off-airport luggage pickup, sealed at your door and delivered to your airline's bag drop at JFK, LGA, and EWR.",
  /** Public contact address shown in footers, FAQ, and legal pages. */
  contactEmail: "info@koolee.cloud",
  /** Airports we serve, for display copy. Booking validation has its own list. */
  airports: ["JFK", "LGA", "EWR"],
} as const;
