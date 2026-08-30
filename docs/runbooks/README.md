# Runbooks

> **Procedures with a blast radius.** Each one is an ordered list somebody
> follows against real infrastructure, with the reason for every step and the
> way back. They are not tutorials and they are not architecture — for how
> something works, read [docs/](../README.md); for what is true now, read
> [PROJECT-STATUS.md](../../PROJECT-STATUS.md).

| Runbook | When |
| --- | --- |
| [prod-bringup.md](prod-bringup.md) | Standing up a production stack from nothing: Supabase, Vercel, Inngest, Turnstile, Sentry, and the launch data. Every step marked TD-manual or CI-automatic |
| [stripe-live-flip.md](stripe-live-flip.md) | Stripe business verification has cleared and Koolee is ready to take real money |
| [cutover-rehearsal.md](cutover-rehearsal.md) | One scripted end-to-end pass on prod infrastructure with a test card, before a real customer books |

Progress against all three is tracked in
[docs/LAUNCH-CHECKLIST.md](../LAUNCH-CHECKLIST.md).
