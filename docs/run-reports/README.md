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
| [VALIDATION-REPORT-tier1-2.md](VALIDATION-REPORT-tier1-2.md) | Independent validation pass over the Tier 1–2 work                                                                   |
| [MIGRATION-NOTES.md](MIGRATION-NOTES.md)                     | The 10-phase dependency migration (Next 16 / Tailwind 4 / Stripe 22 / …)                                             |
