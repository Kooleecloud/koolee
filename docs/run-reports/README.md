# Run reports

> **Dated build logs.** Each one records what a slice of work changed, the
> decisions behind it, and what was verified — at the time it was written.
>
> These are HISTORY, not current-state documentation. A report is never edited
> to match later reality; when a decision in one is reversed, the report keeps
> its original text and gains a pointer to whatever superseded it. For what is
> true **now**, read [PROJECT-STATUS.md](../../PROJECT-STATUS.md) and
> [docs/](../README.md).

| Report                                                       | Covers                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [RUN-REPORT.md](RUN-REPORT.md)                               | Overnight run 1 — sessions, staff auth, ticket extraction, account area, payment lifecycle, agent visit, ops console |
| [RUN-REPORT-2.md](RUN-REPORT-2.md)                           | Overnight run 2 — real Stripe checkout, deploy readiness                                                             |
| [RUN-REPORT-3.md](RUN-REPORT-3.md)                           | Overnight run 3 — waitlist, dispatch + email slice, zone sweep                                                       |
| [RUN-REPORT-4.md](RUN-REPORT-4.md)                           | Validation close-out — core exception emitter, `KOO-XXXXX` refs, job tests                                           |
| [RUN-REPORT-5.md](RUN-REPORT-5.md)                           | Tier 3 — versioned agreements + passport verification (its re-acceptance model is **superseded**; see report 6 §6)   |
| [RUN-REPORT-6.md](RUN-REPORT-6.md)                           | Three parallel sessions merged: ticket extraction, design/brand, agreements editor + **version pinning**             |
| [REPORT-tier4-preflight.md](REPORT-tier4-preflight.md)       | Read-only survey before Tier 4 — what actually existed, and the five facts that reshaped the design                  |
| [RUN-REPORT-7.md](RUN-REPORT-7.md)                           | Tier 4 — driver role, shifts, customer driver selection, the pickup run, ETA + tracking; three dead tables dropped   |
| [RUN-REPORT-8.md](RUN-REPORT-8.md)                           | Slice F1 — the staging extraction bug diagnosed to a silently different extractor, funnel ZIP sync, the actionability gates, auth polish. No migrations |
| [RUN-REPORT-9.md](RUN-REPORT-9.md)                           | Slice F2 — live experience: `booking_signals` realtime (signal-only), the UX revamp, storage/avatars                  |
| [RUN-REPORT-10.md](RUN-REPORT-10.md)                         | Slice F3 — web push behind a default-off flag, assignment at a horizon, the duplicate-confirmation-email fix          |
| [REPORT-tier5-preflight.md](REPORT-tier5-preflight.md)       | Read-only survey before Tier 5 — ETA/geo, Sentry, launch data, the prod bring-up list, and the launch-checklist seed  |
| [RUN-REPORT-11.md](RUN-REPORT-11.md)                         | Tier 5 — launch readiness: seed guard, Routes/Places, Sentry, launch-data admin, boot gates, runbooks                 |
| [VALIDATION-REPORT-tier1-2.md](VALIDATION-REPORT-tier1-2.md) | Independent validation pass over the Tier 1–2 work                                                                   |
| [MIGRATION-NOTES.md](MIGRATION-NOTES.md)                     | The 10-phase dependency migration (Next 16 / Tailwind 4 / Stripe 22 / …)                                             |
