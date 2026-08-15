# Koolee — Learning Track

> **What this is.** A nine-chapter mind map of the codebase, written to be
> re-entered. Every section is numbered (`1.2`, `4.3`, …) and every number is
> stable, so a question weeks later can be aimed at a section instead of at a
> scrollback position.
>
> **What this is not.** A reference. For chapter-level depth read
> [../CODEBASE-MAP.md](../CODEBASE-MAP.md); for _what shipped / what's next_
> read [../../PROJECT-STATUS.md](../../PROJECT-STATUS.md); for _how to run it_
> read [../../README.md](../../README.md).
>
> **Operational references** (canonical, kept separate from the teaching track):
> [ENVIRONMENT.md](../ENVIRONMENT.md) — every env var, boot gates, secret
> ownership · [MIGRATIONS.md](../MIGRATIONS.md) — schema change, drift, RLS
> stance · [SCRIPTS.md](../SCRIPTS.md) — every command and when to use it.
>
> **Source of truth.** Every chapter is written against `origin/dev` and states
> the commit it was verified at. If the chapter's commit is behind
> `origin/dev`, re-verify before trusting a detail.

## How to use this

- **Read in order.** The track is bottom-up: the shared foundation first, the
  three apps last. Chapter N assumes N-1.
- **Ask by number.** "Question on 3.4" is unambiguous. Section numbers never
  get renumbered — new material gets a new trailing number.
- **Every claim is anchored.** Links point at `file:line` on `origin/dev`.
  Trust the file over the prose; the prose is the map.
- **Boxes marked 🧭 are decision hooks** — the places where knowing this
  changes what you'd choose to build next.
- **Boxes marked ⚠️ are sharp edges** — things that have already bitten, or
  will.

## Chapters

| #   | Chapter                                                     | Status | Verified at |
| --- | ----------------------------------------------------------- | ------ | ----------- |
| 1   | [The product & its nouns](01-product-and-nouns.md)          | ✅     | `b17a7de`   |
| 2   | Repo map & boundaries                                       | ⬜     | —           |
| 3   | Data model & migrations                                     | ⬜     | —           |
| 4   | Domain core — state machine, cutoffs, windows, pricing      | ⬜     | —           |
| 5   | Auth — customer OTP & staff invite-only                     | ⬜     | —           |
| 6   | Customer funnel & drafts                                    | ⬜     | —           |
| 7   | Payments end-to-end                                         | ⬜     | —           |
| 8   | Agent PWA & admin ops console                               | ⬜     | —           |
| 9   | UI & brand, testing matrix, deployment                      | ⬜     | —           |
| —   | Glossary (written last, once the nouns have accumulated)     | ⬜     | —           |

## Section index

Jump straight to a numbered section.

**Chapter 1 — [The product & its nouns](01-product-and-nouns.md)**

| §   | Section                                                                       |
| --- | ----------------------------------------------------------------------------- |
| 1.1 | [The claim, and why it is a hard boundary](01-product-and-nouns.md#11--the-claim-and-why-it-is-a-hard-boundary) |
| 1.2 | [The nouns and the tables they live in](01-product-and-nouns.md#12--the-nouns-and-the-tables-they-live-in) |
| 1.3 | [Windows are not inventory](01-product-and-nouns.md#13--windows-are-not-inventory) |
| 1.4 | [Why `bags.ordinal` exists](01-product-and-nouns.md#14--why-bagsordinal-exists) |
| 1.5 | [The lifecycle: ten statuses, one authority](01-product-and-nouns.md#15--the-lifecycle-ten-statuses-one-authority) |
| 1.6 | [Three rules of the state machine](01-product-and-nouns.md#16--three-rules-of-the-state-machine) |
| 1.7 | [Three apps = three phases](01-product-and-nouns.md#17--three-apps--three-phases-of-the-lifecycle) |
| 1.8 | [`paid` means authorized, not collected](01-product-and-nouns.md#18--paid-means-authorized-not-collected) |
