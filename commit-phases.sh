#!/usr/bin/env bash
# Replays the scaffold as six phase commits.
#
# Claude Code is not permitted to run `git commit` in this workspace, so this
# script exists for you to run instead. Each phase stages only the paths that
# belong to it, so you get a readable history rather than one giant commit.
#
# Caveat, stated plainly: these are partitioned from the FINAL tree, not
# point-in-time snapshots. Phase 1's commit therefore contains the final version
# of any file it touches. The history is honest about *what belongs where*, not
# about the order edits actually happened in.
#
# Usage:  bash commit-phases.sh
# Or:     git add -A && git commit -m "chore(scaffold): koolee monorepo"

set -euo pipefail
cd "$(dirname "$0")"

commit () {
  local message="$1"; shift
  git add -- "$@" 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "  (nothing staged for: $message)"
  else
    git commit -q -m "$message"
    echo "  ✓ $message"
  fi
}

echo "Phase 1 — repo skeleton"
commit "chore(scaffold): phase 1 — repo skeleton" \
  .gitignore .nvmrc .npmrc .prettierignore prettier.config.mjs \
  package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json \
  packages/config \
  packages/ui \
  apps/web/package.json apps/web/tsconfig.json apps/web/next.config.mjs \
  apps/web/postcss.config.mjs apps/web/tailwind.config.ts \
  apps/web/eslint.config.mjs apps/web/components.json apps/web/next-env.d.ts \
  apps/web/src/app/layout.tsx apps/web/src/app/page.tsx apps/web/src/app/globals.css \
  apps/web/src/components/env-status.tsx apps/web/src/env.ts \
  apps/agent/package.json apps/agent/tsconfig.json apps/agent/next.config.mjs \
  apps/agent/postcss.config.mjs apps/agent/tailwind.config.ts \
  apps/agent/eslint.config.mjs apps/agent/components.json apps/agent/next-env.d.ts \
  apps/agent/src/app/layout.tsx apps/agent/src/app/page.tsx apps/agent/src/app/globals.css \
  apps/agent/src/app/offline apps/agent/src/app/scan \
  apps/agent/src/components/env-status.tsx \
  apps/agent/src/components/camera-capture.tsx \
  apps/agent/src/components/service-worker-registrar.tsx \
  apps/agent/src/env.ts apps/agent/public \
  apps/admin/package.json apps/admin/tsconfig.json apps/admin/next.config.mjs \
  apps/admin/postcss.config.mjs apps/admin/tailwind.config.ts \
  apps/admin/eslint.config.mjs apps/admin/components.json apps/admin/next-env.d.ts \
  apps/admin/src/app/layout.tsx apps/admin/src/app/page.tsx apps/admin/src/app/globals.css \
  apps/admin/src/components/env-status.tsx apps/admin/src/env.ts

echo "Phase 2 — database"
commit "chore(scaffold): phase 2 — drizzle schema, migrations, seed" \
  packages/db docker-compose.yml

echo "Phase 3 — domain logic"
commit "chore(scaffold): phase 3 — core domain logic" \
  packages/core/package.json packages/core/tsconfig.json \
  packages/core/eslint.config.mjs packages/core/vitest.config.ts \
  packages/core/.env.example \
  packages/core/src/errors.ts packages/core/src/config.ts \
  packages/core/src/runtime.ts packages/core/src/index.ts \
  packages/core/src/booking packages/core/src/slots packages/core/src/pricing \
  packages/core/src/payments packages/core/src/auth packages/core/src/coverage \
  packages/core/src/services packages/core/src/notifications

echo "Phase 4 — apps wiring"
commit "chore(scaffold): phase 4 — booking flow, agent console, ops console" \
  apps/web/src apps/agent/src apps/admin/src

echo "Phase 5 — background jobs"
commit "chore(scaffold): phase 5 — inngest jobs" \
  packages/core/src/jobs

echo "Phase 6 — docs and env"
commit "chore(scaffold): phase 6 — docs and env" \
  README.md .env.example \
  apps/web/.env.example apps/agent/.env.example apps/admin/.env.example

# Anything not matched above (including this script).
echo "Remainder"
commit "chore(scaffold): remaining scaffold files" .

echo
echo "Done. History:"
git --no-pager log --oneline
