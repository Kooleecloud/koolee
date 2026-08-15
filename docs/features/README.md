# Features — end-to-end walkthroughs

> **What the system does, and how each capability works from the first click to
> the database row.** Baseline: `dev` @ `5973047`.
>
> For _structure_ read [../ARCHITECTURE.md](../ARCHITECTURE.md). For _what is
> shipped vs planned_ read [../../PROJECT-STATUS.md](../../PROJECT-STATUS.md).

## The features

| Doc                                                    | Covers                                                                                   | Lifecycle phase                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------- |
| [booking-funnel.md](booking-funnel.md)                 | Marketing site, the 4-step funnel, drafts, coverage, virtual windows, pricing            | `draft`                         |
| [auth.md](auth.md)                                     | Customer phone/email OTP, anonymous drafts, the upgrade guard, staff invite-only sign-in | cross-cutting                   |
| [payments.md](payments.md)                             | Intents, authorization, deferred capture, refunds, webhooks                              | `paid` → capture                |
| [agent-visit.md](agent-visit.md)                       | Field PWA: task list, arrival, identity check, bag sealing, transit                      | `agent_assigned` → `in_transit` |
| [ops-console.md](ops-console.md)                       | Dispatch board, assignment, exceptions, blackouts, staff, zones                          | oversight                       |
| [jobs-and-notifications.md](jobs-and-notifications.md) | Inngest jobs, cron routes, the notification seam                                         | background                      |

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
