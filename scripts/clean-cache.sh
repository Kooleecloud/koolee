#!/usr/bin/env bash
#
# Reclaim build-cache disk without touching anything you'd have to reinstall.
#
# What this removes is regenerated automatically by the next `pnpm dev` or
# `pnpm build`. `node_modules` is deliberately NOT touched, so there is no
# `pnpm install` afterwards — run `pnpm dev` and carry on. (`pnpm clean` is
# the heavier one that does remove node_modules.)
#
# The reason this script exists: `apps/*/.next/dev` is Next 16's turbopack DEV
# cache. It grows with every dev session and never self-trims — measured at
# 39 GB for apps/web alone. It was also being archived into `.turbo/cache` on
# every build until `turbo.json` learned to exclude it, which is how that
# directory reached 616 GB.
#
# Usage:
#   pnpm clean:cache          # delete
#   pnpm clean:cache --dry    # show what would go, delete nothing
#   pnpm clean:cache --force  # delete even with a dev server running
set -euo pipefail

cd "$(dirname "$0")/.."
DRY=false
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --dry|-n) DRY=true ;;
    --force|-f) FORCE=true ;;
  esac
done

# A running `next dev` recreates files as fast as `rm` removes them, so the
# delete fails half-done with "Directory not empty" and leaves the live server
# reading a tree that no longer matches what it compiled. Stop the servers
# first. (Observed: this is exactly what happened the first time this ran.)
running_dev_servers() {
  pgrep -f "next/dist/bin/next dev" 2>/dev/null | head -20
}

if ! $DRY && ! $FORCE && [[ -n "$(running_dev_servers)" ]]; then
  echo "A Next dev server is running:" >&2
  ps -o pid=,command= -p $(running_dev_servers | tr '\n' ' ') 2>/dev/null |
    sed 's/^/  /' | cut -c1-100 >&2
  echo >&2
  echo "Deleting .next under a live dev server half-succeeds and wedges it." >&2
  echo "Stop it (Ctrl-C in that terminal), then re-run. --force to override." >&2
  exit 1
fi

# `du -sh` on a missing path is an error, and `set -e` would abort the run.
size_of() { [[ -e "$1" ]] && du -sh "$1" 2>/dev/null | cut -f1 || echo "-"; }

TARGETS=(
  "apps/web/.next"
  "apps/admin/.next"
  "apps/agent/.next"
  ".turbo/cache"
)

echo "Build caches (regenerated on next dev/build):"
total_found=0
for t in "${TARGETS[@]}"; do
  if [[ -e "$t" ]]; then
    printf "  %-24s %s\n" "$t" "$(size_of "$t")"
    total_found=$((total_found + 1))
  fi
done

# Incremental typecheck state. Cheap to rebuild, and a stale one is a known
# source of "tsc says it's fine" on a tree where it is not.
#
# No `mapfile` here: macOS ships bash 3.2, where it does not exist, and
# `#!/usr/bin/env bash` finds that one first on a stock machine.
TSBUILD_COUNT=$(find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' 2>/dev/null | wc -l | tr -d ' ')
[[ "$TSBUILD_COUNT" -gt 0 ]] && printf "  %-24s %s files\n" "*.tsbuildinfo" "$TSBUILD_COUNT"

if [[ $total_found -eq 0 && "$TSBUILD_COUNT" -eq 0 ]]; then
  echo "  (nothing to clean)"
  exit 0
fi

if $DRY; then
  echo
  echo "--dry: nothing removed."
  exit 0
fi

echo
for t in "${TARGETS[@]}"; do
  rm -rf "$t"
done
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete 2>/dev/null || true

echo "Cleaned. node_modules untouched — no reinstall needed, just \`pnpm dev\`."
echo
df -h /System/Volumes/Data 2>/dev/null | tail -1 || df -h . | tail -1
