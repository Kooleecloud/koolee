# Koolee design system — the contract

One system serves every Koolee app (web, admin, agent, and whatever comes
next). Nothing visual gets redefined per app; apps compose what this package
exports. This file is the contract — read it before adding UI anywhere.

## Layering

```
packages/ui/styles/theme.css   tokens: color, type scale, spacing, shadows, container
        │
packages/ui  (primitives)      Button, CTAButton, Input, Label, Select, Card, Badge,
        │                      Dialog, Accordion, Toaster, KooleeLogo
        │
packages/ui  (shell)           AppHeader, ContentColumn, AppFooter, PageHeader, BackLink
        │
packages/ui  (feedback)        Spinner, FormMessage, EmptyState, DatabaseNotConfigured,
        │                      Skeleton/PageSkeleton, ConfirmDialog, toast,
        │                      BookingStatusBadge, EnvStatusCard
        │
packages/ui  (forms)           PhoneInput, OTPInput, PriceEstimator, StaffLoginForm,
        │                      PasswordResetForm, SetPasswordForm, usePreservedFormValues
        │
packages/ui  (marketing)       MarketingNav, MarketingFooter, Section/SectionHeader,
        │                      StepCard, AirportCard, FAQAccordion, StatBadge, SealMotif
        │
packages/ui  (domain + motion) CustodyTimeline, Reveal, HeroRouteScene
        │
apps/*                         pages compose the layers; app-specific modules only
```

`packages/ui/src/index.ts` is the authoritative export list; the tiers above
are how to think about it, not a substitute for reading it.

A pattern is promoted into this package when **two or more apps** repeat it.
Until then it lives in the app that needs it.

## Frame decisions (do not re-derive)

- **Header**: `AppHeader` on every in-app surface, `MarketingNav` on marketing.
  Both are `h-16`, full `container` width (1280px), so the logo never moves
  between pages.
- **Content**: `ContentColumn` — one width per surface type:
  `default` spans the same `container` as the header, so pages use the full
  frame and cap individual fields themselves · `focused` (max-w-3xl) guided
  step flows (booking funnel, agent visit) · `narrow` (max-w-md) auth forms
  and small utility screens · `full` is **genuinely full-bleed** — it drops
  `container` entirely and keeps only its 1.5rem gutters, for dense
  operational tables where every column matters more than the centered
  rhythm. Each variant owns its whole horizontal box, `container` included;
  before 2026-08-10 `full` still applied `container` and so was a silent
  alias of `default`.
  Rhythm is fixed: `py-10` page padding, `gap-6` between blocks. `AppFooter`
  takes the same `width` so the footer stays aligned to its page.
- **Dense tables**: cells and headers get `whitespace-nowrap` — an operator
  scanning a board reads rows, and a wrapped cell breaks the scan. Nothing is
  truncated: when columns outgrow the viewport the table scrolls inside its
  own `overflow-x-auto` wrapper, so the page body never scrolls sideways.
- **Page titles**: `PageHeader` only. Sora display (`text-display-sm`),
  optional muted subtitle, optional trailing `actions`.
- **Elevation**: two steps, both from `theme.css` — `shadow-lift` for anything
  that reads as a surface (this is what `Card` ships, as of 2026-08-16;
  it was `shadow-xs`, which left app cards visibly flatter than the marketing
  surfaces beside them) and `shadow-lift-lg` for its raised state. Do not reach
  for Tailwind's default `shadow-sm`/`shadow-md`: a second shadow scale is how
  two cards on one page end up sitting at different heights.
- **Surfaces are `Card`, always.** Never hand-roll
  `rounded-… border bg-… shadow-…` on a div. `Card` carries the three shapes:
  default (in-app, `rounded-xl`), `surface="panel"` (marketing, `rounded-2xl`),
  and `interactive` for a card that is itself a link or a picker option (hover
  lift, brand focus ring, reduced-motion hold). Use `asChild` to keep the real
  element — `<Card asChild interactive><Link …>` , `<Card asChild><li …>`.
  Padding stays on the child, so a row can be `p-3` and a panel `p-6 sm:p-8`.
  Until 2026-08-29 this recipe was transcribed by hand in 21 places across the
  three apps and had drifted in both ways that matter: `bg-white` (invisible in
  the dark theme, where `--card` is navy) and `shadow-xs` sitting next to
  `shadow-lift` on the same page.
- **Route states**: every data route ships `loading.tsx` (`PageSkeleton`),
  and each app has root `error.tsx` + `not-found.tsx`. Chrome lives in
  layouts, not pages, so those states keep the header alive.

## Interaction feedback (the user always knows what's going on)

- Every async submit: `<Button loading={pending}>` (spinner + aria-busy +
  disable). Keep the specific pending verbs — "Checking coverage…" beats a
  bare spinner.
- Every mutation outcome: `FormMessage` inline (correct live-region roles,
  scrolls itself into view) or `toast` for actions whose UI disappears after
  success. Never silence.
- Every irreversible action: `ConfirmDialog`. Bare buttons must not write to
  append-only records (custody log, cancellations) or destroy work.
- Every empty list: `EmptyState`, preferably with an `action` — offer the
  next step, not a dead end.

## Brand rules (from brand/BRAND.md and brand/)

- Tag orange `#FF6B35` is **CTA, seal, and the live-custody dot only**; text on
  it is navy (white fails contrast). `CTAButton` encodes the CTA case and
  `CustodyTimeline` the custody case — do not hand-roll orange anywhere else.
  In a timeline exactly one dot is orange (the `current` item); everything
  banked is navy and everything ahead is hollow.
- `KooleeLogo` renders body/wordmark in `currentColor` — default on light,
  `className="text-white"` on navy. Never tint the whole SVG.
- Fonts: Sora (display) + Inter (body) come from `@koolee/ui/fonts` — one
  module, imported by every app's root layout as `brandFontClassName` and
  spread onto `<body>`. It exposes `--font-display` / `--font-sans`, which is
  what `theme.css` reads. Do not call `next/font` in an app. An app that
  mounts nothing here does not fail loudly; it silently renders every heading
  in system-ui, which is exactly how admin and agent ran until 2026-08-29.
  The subpath is deliberate: `next/font` resolves only in a Next build, and
  Storybook builds this package with Vite, so it must stay off the barrel.
- App icons: `icon.svg`, `favicon.ico` and `apple-icon.png` are the same bytes
  in every app, derived from `brand/app-tile.svg`. `src/lib/brand-assets.test.ts`
  fails if one drifts. Note `brand/` itself has been gitignored since
  2026-08-01, so it is absent from a fresh clone — web's committed copy is the
  in-repo reference.

## Adding a new app (the recipe)

1. Scaffold a Next.js app in `apps/`, depend on `@koolee/ui` (+ `@koolee/core`
   if it reads data).
2. `globals.css`: `@import "tailwindcss";` then
   `@import "@koolee/ui/styles/theme.css";`
3. Root layout: `import { brandFontClassName } from "@koolee/ui/fonts"` and
   spread it onto `<body>`, mount `<AppHeader>` + `<Toaster />`, set
   `themeColor` to navy `#0B2545`.
4. Copy `icon.svg`, `favicon.ico` and `apple-icon.png` from `apps/web/src/app`
   and add the app to `COPY_APPS` in `src/lib/brand-assets.test.ts`. PWA tiles
   are the one deliberate variant — full-bleed square, no corner radius, mark
   in the 80% safe zone, because the OS applies its own mask
   (`apps/agent/public/icons`).
5. Add root `loading.tsx` / `error.tsx` / `not-found.tsx` (copy from
   apps/admin — they are shell-composed one-liners).
6. Copy the `env.ts` convention: never throw at import, `requireEnv()` at the
   point of need, `EnvStatus` wrapper over `EnvStatusCard`.
7. Pages: `ContentColumn` + `PageHeader` + primitives. If you are writing a
   raw `<header>`, `<h1 className=…>`, or a bare pending button, stop — the
   shell already has it.

## Storybook

`pnpm --filter @koolee/ui storybook` (port 6006) — the catalog of primitives,
shell pieces, and feedback states. `pnpm --filter @koolee/ui build-storybook`
produces the static build. Stories are `src/**/*.stories.tsx`.

Coverage is currently `Primitives/Button`, `Primitives/CTAButton`,
`Primitives/ImageLightbox`, `Primitives/LinkedTableRow`, `Primitives/MultiSelect`,
`Patterns/CustodyTimeline`, `Shell`, and `Feedback`. That is still a gap, not
the standard: new component → new story in the same PR, and the marketing,
form, and motion components listed above are owed one.

The gap has a cost on record. `CustodyTimeline` went unstoried until
2026-08-16, and in that time its stage dots were rendering at **0×0** in the
vertical orientation — a bare `<span>` is `display:inline`, and width/height do
not apply to non-replaced inline elements, so `size-3` did nothing. The
horizontal marketing variant was fine (its dot is a direct flex child, and flex
blockifies its children), which is exactly why nobody caught it: the only
surface anyone looked at was the one that worked. Two rules out of that:
markers and shape-only spans carry `block`, and a story covers every
orientation a component claims to support, not just the one in the demo.
