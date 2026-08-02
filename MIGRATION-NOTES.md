# Koolee — Dependency Migration Notes

Working branch: `chore/dependency-migrations` (from `dev` @ `27bb0e6`).
One phase = one atomic commit on this branch. Commits are run by Tarun
(Claude Code is not permitted to run `git commit` in this workspace — see
`commit-phases.sh` for the same convention on the original scaffold).

## Phase 0 — Preflight

### Environment

| Item | Declared | Actual at baseline |
|---|---|---|
| Node | `.nvmrc` 22, `engines >=22` | **v24.15.0** (machine default; satisfies engines — noted as deviation, aligned in Phase 8) |
| pnpm | `packageManager pnpm@11.18.0` | 11.18.0 |
| turbo tasks | — | `build`, `dev`, `lint`, `typecheck`, `test`, `clean`, `db:generate`, `db:migrate` (names match the plan; no adaptation needed) |

### Before table (installed versions from lockfile)

| Package | Where | Declared range | Installed | Target |
|---|---|---|---|---|
| tailwindcss | 3 apps + ui | ^3.4.17 | 3.4.19 | 4.x |
| tailwind-merge | ui | ^2.6.0 | 2.6.1 | 3.x |
| tailwindcss-animate | ui | ^1.0.7 | 1.0.7 | replace with tw-animate-css |
| autoprefixer | 3 apps | ^10.4.20 | 10.5.4 | remove (v4 handles prefixing) |
| stripe | core | ^17.5.0 | 17.7.0 | 22.x |
| @stripe/stripe-js | web | ^5.5.0 | 5.10.0 | 9.x |
| @stripe/react-stripe-js | web | ^3.1.1 | 3.10.0 | 6.x |
| inngest | core, web | ^3.29.3 | 3.54.2 | 4.x |
| next | 3 apps | ^15.1.6 | 15.5.22 | 16.x |
| @next/eslint-plugin-next | config | ^15.1.6 | 15.5.22 | 16.x |
| zod | core + 3 apps | ^3.24.1 | 3.25.76 | 4.x |
| eslint | everywhere | ^9.18.0 | 9.39.5 | 10.x |
| @eslint/js | config | ^9.18.0 | 9.39.5 | 10.x |
| globals | config | ^15.14.0 | 15.15.0 | 17.x |
| eslint-plugin-react-hooks | config | ^5.1.0 | 5.2.0 | 7.x |
| drizzle-orm | core, db | ^0.38.4 | 0.38.4 | 0.45.x |
| drizzle-kit | db | ^0.30.2 | 0.30.6 | 0.31.x |
| lucide-react | 3 apps + ui | ^0.474.0 | 0.474.0 | 1.x |
| sonner | ui | ^1.7.2 | 1.7.4 | 2.x |
| dotenv | db | ^16.4.7 | 16.6.1 | 17.x |
| vitest | core | ^2.1.8 | 2.1.9 | 4.x |
| turbo | root | ^2.3.3 | 2.10.7 | 2.10.8 (also tighten range) |
| @types/node | everywhere | ^22.10.7 | 22.20.1 | ^24 (Phase 8) |

Out of scope (unchanged by design): react/react-dom 19, @supabase/*, gsap,
motion, @radix-ui/*, date-fns, typescript 5.x (5.9 line), postgres driver,
prettier, typescript-eslint, Postgres docker image.

### Baseline gate — GREEN (2026-08-01, Node v24.15.0)

- `pnpm install --frozen-lockfile` — lockfile up to date, no warnings.
- `pnpm turbo build lint typecheck test --force` — **16/16 tasks successful, uncached** (17.0s).
- Core vitest suite: **142 passed, 10 skipped** (5 files passed, 1 file skipped —
  integration tests). These skip counts are the reference for later phases.
- Runtime smoke: all three apps serve HTTP 200 with real HTML and zero
  "Application error" / "Internal Server Error" strings
  (web 294 KB "Koolee — Fly Hassle-Free", agent 53 KB "Koolee Agent",
  admin 54 KB "Koolee Ops"). No errors or hydration warnings in dev-server logs.

### Deviations / incidents

- Baseline ran under **Node v24.15.0** (machine default) although `.nvmrc` says 22.
  `engines: >=22` is satisfied. Phase 8 aligns declared versions with 24.
- A `turbo dev` session (all 3 apps) was already running when preflight started.
  The baseline production build wrote into the same `.next/` directories and broke
  those live servers (all returned 500). The session was stopped (processes killed
  cleanly), fresh dev servers were used for the smoke test above, then shut down.
  **Restart your dev session after the migration** — and expect the same clash if
  `turbo dev` runs while any phase's gate builds are executing.
