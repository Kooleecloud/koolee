# Features — end-to-end walkthroughs

> **What the system does, and how each capability works from the first click to
> the database row.** Baseline: `dev` @ `2fe3a2b`.
>
> For _structure_ read [../ARCHITECTURE.md](../ARCHITECTURE.md). For _what is
> shipped vs planned_ read [../../PROJECT-STATUS.md](../../PROJECT-STATUS.md).

## The features

| Doc                                                      | Covers                                                                                   | Lifecycle phase                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- |
| [booking-funnel.md](booking-funnel.md)                   | Marketing site, the 4-step funnel, drafts, coverage, virtual windows, pricing            | `draft`                         |
| [auth.md](auth.md)                                       | Customer phone/email OTP, anonymous drafts, the upgrade guard, staff invite-only sign-in | cross-cutting                   |
| [payments.md](payments.md)                               | Intents, authorization, deferred capture, refunds, webhooks                              | `paid` → capture                |
| [agent-visit.md](agent-visit.md)                         | Field PWA: task list, arrival, identity check, bag sealing, transit                      | `agent_assigned` → `in_transit` |
| [agreements-and-passport.md](agreements-and-passport.md) | Versioned booking agreements, manual passport verification, the visit identity gate      | `paid` → `verified_sealed`      |
| [storage-and-avatars.md](storage-and-avatars.md)         | Bucket declaration and limits, storage RLS, profile pictures across all three apps, and who may see whose face | cross-cutting                   |
| [realtime-signals.md](realtime-signals.md)               | The doorbell table, the one RLS policy, `useBookingSignal`, and why a payload is never rendered | cross-cutting                   |
| [notifications.md](notifications.md)                     | The living notification matrix — in-app, email, and the parked SMS column                | cross-cutting                   |
| [f2-hosted-setup.md](f2-hosted-setup.md)                 | F2's hosted steps: two migrations, one dashboard check, no new env vars                  | ops                             |
| [driver-and-pickup-hosted-setup.md](driver-and-pickup-hosted-setup.md) | Trucks, shifts, `can_drive`, driver selection, the pickup run — and what TD must do by hand | `verified_sealed` → `completed` |
| [f1-hosted-setup.md](f1-hosted-setup.md) | Slice F1's manual steps: `ANTHROPIC_API_KEY` as a production requirement, the Turnstile hostnames the staff apps need, and the turbo-cache cleanup. **No migrations** | — |
| [ops-console.md](ops-console.md)                         | Dispatch board, assignment, exceptions, blackouts, staff, zones                          | oversight                       |
| [jobs-and-notifications.md](jobs-and-notifications.md)   | Inngest jobs, cron routes, the notification seam                                         | background                      |

## The spine

Everything below hangs off one booking moving through one state machine:

```
   CUSTOMER (apps/web)              FIELD (apps/agent)           OPS (apps/admin)
   ┌──────────────────┐
   │ marketing → /book│
   │ flight → pickup  │
   │ → window → pay   │
   │        ↓         │
   │  auth gate (OTP) │
   │        ↓         │
   │  Stripe intent   │
   └────────┬─────────┘
         draft
            ↓ authorize
          paid ──────────→ agent_assigned
                                ↓ arrive + verify ID + seal bags
                          verified_sealed ──→ awaiting_pickup
                                ↓ start transit
                            in_transit  ← cancel no longer possible
                                ↓ deliver
                       delivered_to_bagdrop
                                ↓
                            completed          exception ←─ from any live state
                                                   ↓ resolved by an admin,
                                                     always forward, always
                                                     with a recorded reason
```

**Money is authorized at `paid` and captured only once bags are in custody** —
by a sweep in `apps/web`, never on the agent's device.

## Conventions in these docs

- 🧭 **decision hook** — knowing this changes what you'd build next
- ⚠️ **sharp edge** — has bitten, or will
- Every claim links to `file:line` on `dev`
