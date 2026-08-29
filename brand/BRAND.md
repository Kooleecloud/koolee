# Koolee brand guidelines

## The mark — Tag-K

The Koolee brand mark is a tamper-evident luggage tag drawn as the K of
"koolee". The tag body forms the K's stem with a punched eyelet; the upper arm
takes off at climb angle in Sky; the lower arm stays Navy and lands level with
the tag's foot. The single orange element is the grommet ringing the eyelet —
the same scarcity rule as the product's physical seal.

Selected 2026-08-02 from four candidates (see `logo-proposals-r2.pdf` for the
field and the reasoning).

## Files

| File | Use |
| --- | --- |
| `logo-full.svg` | Primary lockup (mark + wordmark), light grounds |
| `logo-full-inverse.svg` | Lockup for navy/dark grounds |
| `logo-full-mono.svg` | Single-color lockup (print, engraving, embroidery) |
| `logo-icon.svg` | Square mark alone, light grounds |
| `logo-icon-inverse.svg` | Square mark for navy/dark grounds |
| `logo-icon-mono.svg` | Single-color mark |
| `logo-wordmark.svg` / `-inverse` | Wordmark alone (Sora SemiBold baked outlines, +2% tracking) |
| `app-tile.svg` | Navy tile + inverse mark — source for favicons and PWA icons |

In app code, don't embed these files — use the `KooleeLogo` component from
`@koolee/ui` (`withWordmark={false}` for the mark alone). It renders the tag
body and wordmark in `currentColor` (brand navy by default); pass
`className="text-white"` on dark grounds. Sky arm and orange grommet never
change color.

## Color

| Token | Hex | Role |
| --- | --- | --- |
| Navy | `#0B2545` | Tag body, wordmark, primary UI color |
| Sky | `#38B6E3` | Upper arm only (in the mark); accent in UI |
| Tag Orange | `#FF6B35` | Grommet only (in the mark); CTA, seal, and live-custody marker in UI |
| Inverse | `#F4F7FA` | Tag body + wordmark on navy/dark grounds |

Rules:

- Orange stays scarce. In the mark it is only the grommet; in the UI it is
  CTAs, the seal motif, and the ONE custody event happening right now (the
  pulsing dot in `CustodyTimeline` — the moment the physical orange seal is in
  play). Never use it for text blocks, borders, or decorative fills.
  The scarcity is the point: exactly one orange dot exists per timeline, so
  "orange" keeps meaning "this, now" rather than "a stage".
- Text on orange is navy, never white (white fails WCAG at 2.8:1; navy passes
  at 5.4:1).
- Never recolor the sky arm or the grommet. If the ground clashes with sky or
  orange, use the mono variant instead.
- In pure mono, the grommet is omitted — the punched eyelet alone marks the
  seal. Mono may be reproduced in any single color.

## Clear space & minimum sizes

- **Clear space:** keep a margin of half the tag's height (½ of the icon's
  height) free on all sides of the lockup or icon.
- **Icon minimum:** 16 px. At 16 px the grommet reduces to a single orange
  point — this is accepted behavior, not a defect. Below 16 px, don't use the
  mark.
- **Lockup minimum:** 120 px wide. Below that, switch to the icon alone.
- In the lockup, the k's ascender is exactly as tall as the tag — don't
  rebuild the lockup by hand; use `logo-full.svg` or the component.

## Type

- Display / wordmark: **Sora** (SemiBold 600 in the wordmark, baked as
  outlines — logo rendering never depends on font loading).
- Body: **Inter**. Both loaded via `next/font` in the apps; the shared
  Tailwind preset (`packages/ui/tailwind-preset.js`) defines `font-display`
  and the fluid `text-display-*` scale.
- Don't typeset "koolee" in live text as a logo substitute; use the wordmark
  asset or component so tracking and cut stay exact.

## App surfaces

- **Web favicon:** `apps/web/src/app/icon.svg` (rounded tile, transparent
  corners) + `favicon.ico` + `apple-icon.png` (full-bleed square — Apple
  applies its own mask).
- **Agent PWA:** `apps/agent/public/icons/` icon.svg + 192/512 PNGs, all
  full-bleed squares with the mark inside the maskable safe zone (central 80%).
  Manifest `theme_color` is Navy, `background_color` is `#F8F9FB`.
- Voice reminder (from the repo README): "delivered to your airline's bag
  drop" — never "we check you in", "TSA", or "loaded onto your plane".
