# Slice F1 — hosted setup (TD's manual steps)

Everything in `fix/f1-gates-and-bugs` that cannot be done from the repository.
**There are no migrations in this slice** — nothing here touches schema, and
nothing new is stored. Actionability is derived; the ZIP check compares two
values that already exist.

Three items. The first two are the fix for bugs TD reported; the third is
housekeeping on any machine that has built this repo.

---

## 1. `ANTHROPIC_API_KEY` on every hosted scope that serves the funnel

**Required.** `apps/web` now refuses to boot in production without it
(`apps/web/src/env.ts`, alongside `RESEND_API_KEY` and `OPS_ALERT_EMAIL`).

### Why it became required

Without the key, `resolveExtractionConfig()` silently returns the in-process
**heuristic** extractor instead of Claude. Uploads still succeed, still report
`extracted`, and still prefill the review form — with a passenger name taken
from a heading, a departure time taken from a printed flight DURATION, and no
second leg at all on a round trip. Nothing in the UI, the logs or the status
code distinguished it from a good read. Measured over twelve ticket fixtures
the heuristic was confidently wrong on five where the Claude adapter was right
on all twelve: [RUN-REPORT-8](../run-reports/RUN-REPORT-8.md) §0.

That is almost certainly what TD was seeing on staging.

### What to do

Vercel → the `apps/web` project → Settings → Environment Variables:

| Scope | Variable | Value |
| ----- | -------- | ----- |
| Preview (`dev.koolee.cloud`) | `ANTHROPIC_API_KEY` | an Anthropic API key |
| Production (`koolee.cloud`) | `ANTHROPIC_API_KEY` | an Anthropic API key |

Then **redeploy with the build cache UNCHECKED** — Vercel bakes env vars at
build time, so an existing deployment does not pick this up.

Production is currently `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`, which exempts it
from every boot gate including this one; set the key anyway, so launch day is
not the moment the gate first fires.

### Verifying it took

The upload path already logs one structured line per upload, in every
environment, with no flag needed. Vercel → the deployment → Runtime Logs,
filter `[ticket-upload]`:

```
[ticket-upload] extraction {"uploadId":"…","status":"extracted","extractor":"claude",…}
                                                                ^^^^^^^^^^^^^^^^^^^^^
```

`"extractor":"claude"` is the whole answer. `"heuristic"` means the key is not
reaching the running server.

For a deeper look at one upload, set `TICKET_EXTRACTION_DEBUG=1` on the
**Preview scope only** and re-upload: the flight step then renders every
segment the model read, which leg was chosen and why, and every field that was
dropped. **Never set it on Production** — the payload contains the customer's
own itinerary.

---

## 2. Turnstile hostnames for the staff apps

**Required** — this is the `110200` error TD hit on `dev.admin.koolee.cloud`,
on both password reset and agent sign-in.

`110200` is Cloudflare Turnstile's client-side **"unknown domain"**: the widget
was loaded on a hostname that is not on its allowed list. The `postMessage`
origin mismatch and the `400` on
`challenges.cloudflare.com/cdn-cgi/challenge-platform/…` that follow it in the
console are downstream of the refusal, not separate faults.

**Why it looked covered and was not.** A Turnstile hostname entry covers that
hostname and **its own** subdomains. `dev.admin.koolee.cloud` reads
`dev` · `admin` · `koolee.cloud` — it is a subdomain of `admin.koolee.cloud`,
not of `dev.koolee.cloud`, so the `dev.koolee.cloud` entry never covered it.
`docs/ENVIRONMENT.md` §5.2 asserted otherwise and has been corrected.

**Confirmed empirically:** site key `0x4AAAAAAEEphyJv7s1q6VEp` — the same key
in the failing URL in TD's console — renders and challenges cleanly on
`localhost:3001` with no console error. The only variable between the two is
the hostname. (Turnstile accepts `localhost` without an entry, which is why
this never reproduces on a laptop.)

### What to do

Cloudflare dashboard → Turnstile → the **dev** widget → Settings → Hostname
Management. Add:

- `dev.agent.koolee.cloud`
- `dev.admin.koolee.cloud`

(substituting the actual staff hostnames if they differ). Do the same on the
**production** widget for the production staff hostnames when they exist.

**Do not add the apex `koolee.cloud` to the dev widget.** One entry would cover
everything, and it would also let the dev widget answer for production.

No redeploy is needed — the hostname list is read by Cloudflare at challenge
time, not baked into the bundle. Reload the page.

### While you are in there

The widget is currently rendering as a visible **"Verify you are human"**
checkbox, not the invisible widget `docs/ENVIRONMENT.md` describes. That is a
widget-mode setting, not a code setting, and it is not what caused `110200` —
but the docs and the deployed widget should agree. Either switch the widget to
Invisible or update the docs to say Managed.

---

## 3. Reclaim the turbo cache (any machine that has built this repo)

`turbo.json` was archiving Next 16's **turbopack dev cache** (`.next/dev/`)
into the build cache on every `turbo build`. On this machine that was
**616 GB**, leaving 1.5 GB free on a 926 GB volume — builds succeeded and then
failed their cache write. (5,070 files ≈ 1,690 entries, since turbo writes
three files per entry; a few dozen of those were 18–19 GB each, which is where
the bulk sat. `apps/web/.next/dev` alone was 39 GB.)

The fix is in the tree (`"!.next/dev/**"` added to the build task's `outputs`).
The accumulated cache is not. On any other checkout:

```bash
du -sh .turbo/cache      # if this is measured in GB, that machine has it
rm -rf .turbo/cache
```

It is a build cache; the next `turbo build` rebuilds what it needs. After the
fix, three full app builds produce **37 MB** total.
