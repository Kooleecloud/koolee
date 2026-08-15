#!/usr/bin/env bash
#
# Koolee local development environment — one command, start to finish.
#
#   ./scripts/local.sh up       Docker → Supabase → migrate → test DB → verify → seed
#   ./scripts/local.sh dev      up, then hand off to `pnpm dev`
#   ./scripts/local.sh status   read-only: what is actually running right now
#   ./scripts/local.sh down     stop the stack (data volumes persist)
#   ./scripts/local.sh reset    wipe + re-migrate the local DB, then reseed
#
# This is an ORCHESTRATOR, not a second implementation. Everything involving a
# database is delegated to scripts/test-env.sh, which owns the preflight, the
# migrations, the disposable koolee_test database, the assert_local guard, and
# the eight verify assertions. The only things added here are the steps that
# sat outside it and had to be run by hand: starting Docker Desktop, seeding,
# and a single status board covering infra *and* app ports.
#
# LOCAL ONLY. Every database URL below is hardcoded to 127.0.0.1 and
# test-env.sh refuses to run against any non-local host. There is no flag that
# points this at staging or production, by design.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TEST_ENV="$REPO_ROOT/scripts/test-env.sh"
CONFIG_TOML="$REPO_ROOT/supabase/config.toml"
LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
TEST_DB_NAME="koolee_test"

# How long to wait for Docker Desktop to finish starting before giving up.
DOCKER_WAIT_SECONDS=120

# Dev server ports, from each app's `next dev -p` flag.
APP_PORTS=("3000:web" "3001:agent" "3002:admin")

# ---------------------------------------------------------------- output ----
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; DIM=""; BOLD=""; NC=""
fi

step() { printf '%s\n' "${BLUE}▸${NC} ${BOLD}$*${NC}"; }
pass() { printf '%s\n' "  ${GREEN}✓${NC} $*"; }
warn() { printf '%s\n' "  ${YELLOW}!${NC} $*"; }
die()  { printf '%s\n' "${RED}ERROR${NC} $*" >&2; exit 1; }

# ---------------------------------------------------------------- helpers ----
# Value of `key` inside literal [section] in config.toml, comments stripped.
toml_value() {
  awk -v section="[$1]" -v key="$2" '
    $0 == section { insec = 1; next }
    /^\[/ { insec = 0 }
    insec {
      line = $0; sub(/#.*/, "", line)
      if (line ~ ("^[ \t]*" key "[ \t]*=")) {
        sub("^[ \t]*" key "[ \t]*=[ \t]*", "", line)
        gsub(/^[ \t]+|[ \t]+$/, "", line)
        print line; exit
      }
    }
  ' "$CONFIG_TOML" 2>/dev/null
}

# First non-empty value across several [section] names, else the default.
# The mail UI section was renamed [inbucket] → [local_smtp] by the Supabase
# CLI, so both are tried; a missing/renamed section falls back rather than
# printing a URL with a blank port.
toml_port_or() {
  local default="$1"; shift
  local section value
  for section in "$@"; do
    value="$(toml_value "$section" port)"
    if [[ -n "$value" ]]; then printf '%s\n' "$value"; return 0; fi
  done
  printf '%s\n' "$default"
}

studio_url()  { printf 'http://127.0.0.1:%s\n' "$(toml_port_or 54323 studio)"; }
mailpit_url() { printf 'http://127.0.0.1:%s\n' "$(toml_port_or 54324 local_smtp inbucket)"; }

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

docker_running()   { docker info >/dev/null 2>&1; }
supabase_running() { supabase status >/dev/null 2>&1; }

# Scalar from the local dev database. Empty string if the query fails for any
# reason (no stack, no psql, table missing) — every caller treats empty as
# "not seeded / unknown" rather than erroring.
db_scalar() {
  psql "$LOCAL_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null | tr -d '[:space:]'
}

# An exported DATABASE_URL pointing somewhere remote makes `pnpm dev` and the
# seed talk to that host even though the stack we just started is local.
# test-env.sh already refuses in that situation; fail here too so the message
# names the real cause instead of surfacing as a confusing mid-run abort.
assert_no_remote_env() {
  local key url host
  for key in DATABASE_URL DIRECT_DATABASE_URL; do
    url="${!key:-}"
    [[ -z "$url" ]] && continue
    host="$(printf '%s\n' "$url" | sed -E 's#^[^:]+://##; s#^[^@]*@##; s#[:/?].*$##')"
    if [[ "$host" != "127.0.0.1" && "$host" != "localhost" ]]; then
      die "$key is exported in your shell and points at '$host', not localhost.
This script only ever operates on the local stack. Nothing was executed.
Remedy: unset $key"
    fi
  done
}

# ----------------------------------------------------------------- docker ----
# test-env.sh dies with 'open -a Docker' as a remedy. Since that remedy is the
# same every time, do it — then wait for the daemon to actually accept
# connections, which lags the app launching by a good few seconds.
ensure_docker() {
  step "Docker"

  if docker_running; then
    pass "daemon running"
    return 0
  fi

  command -v docker >/dev/null 2>&1 \
    || die "docker not found on PATH. Remedy: install Docker Desktop (https://docker.com/products/docker-desktop)"

  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "Docker daemon is not running, and this script only knows how to start Docker Desktop on macOS.
Remedy: start your Docker daemon, then re-run."
  fi

  warn "daemon not running — starting Docker Desktop"
  open -a Docker \
    || die "could not launch Docker Desktop. Remedy: start it manually, then re-run."

  local waited=0
  while ! docker_running; do
    if (( waited >= DOCKER_WAIT_SECONDS )); then
      die "Docker Desktop did not become ready within ${DOCKER_WAIT_SECONDS}s.
Remedy: check the Docker Desktop window for a startup error, then re-run."
    fi
    sleep 2
    waited=$((waited + 2))
    if (( waited % 10 == 0 )); then
      printf '%s\n' "    ${DIM}waiting for Docker daemon… ${waited}s${NC}"
    fi
  done

  pass "daemon ready (took ${waited}s)"
}

# ------------------------------------------------------------------- seed ----
# `airports` and `staff_members` are the two tables a successful seed always
# populates (reference data + local staff accounts). Both non-empty means the
# seed has run against this database; either empty means it has not, or only
# got halfway.
#
# seed.ts is itself idempotent, so re-running is safe — this check exists to
# keep `local up` fast and quiet on the common path, not to prevent damage.
seed_needed() {
  local airports staff
  airports="$(db_scalar "select count(*) from airports")"
  staff="$(db_scalar "select count(*) from staff_members")"
  [[ -z "$airports" || -z "$staff" || "$airports" == "0" || "$staff" == "0" ]]
}

run_seed() {
  pnpm seed:local >/tmp/koolee-local-seed.log 2>&1 \
    || die "seed failed. Full output: /tmp/koolee-local-seed.log"
}

seed_step() {
  local force="${1:-}"
  step "Seed"

  if [[ "$force" != "force" ]] && ! seed_needed; then
    pass "already seeded ($(db_scalar "select count(*) from airports") airports, $(db_scalar "select count(*) from staff_members") staff) — skipped"
    printf '%s\n' "    ${DIM}force a fresh seed with: pnpm local:reset${NC}"
    return 0
  fi

  run_seed
  pass "seeded ($(db_scalar "select count(*) from airports") airports, $(db_scalar "select count(*) from staff_members") staff)"
}

# ----------------------------------------------------------------- board ----
# The single "is everything up?" view. Read-only and safe to run any time.
status_board() {
  local db_state test_db_state
  printf '\n%s\n' "${BOLD}  Koolee local environment${NC}"
  printf '%s\n' "  ────────────────────────────────────────────────────────"

  if docker_running; then
    printf '  %-12s %s\n' "Docker" "${GREEN}running${NC}"
  else
    printf '  %-12s %s\n' "Docker" "${RED}stopped${NC}  ${DIM}→ pnpm local${NC}"
  fi

  if supabase_running; then
    printf '  %-12s %s\n' "Supabase" "${GREEN}running${NC}"
  else
    printf '  %-12s %s\n' "Supabase" "${RED}stopped${NC}  ${DIM}→ pnpm local${NC}"
    printf '%s\n\n' "  ────────────────────────────────────────────────────────"
    return 0
  fi

  db_state="$(db_scalar "select count(*) from pg_catalog.pg_tables where schemaname = 'public'")"
  printf '  %-12s %s\n' "Dev DB" "${GREEN}up${NC} ${DIM}(${db_state:-?} public tables)${NC}"

  test_db_state="$(psql "postgresql://postgres:postgres@127.0.0.1:54322/$TEST_DB_NAME" \
    -X -q -A -t -v ON_ERROR_STOP=1 -c "select 1" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$test_db_state" == "1" ]]; then
    printf '  %-12s %s\n' "Test DB" "${GREEN}up${NC} ${DIM}($TEST_DB_NAME — disposable)${NC}"
  else
    printf '  %-12s %s\n' "Test DB" "${YELLOW}missing${NC}  ${DIM}→ pnpm test:db:setup${NC}"
  fi

  if seed_needed; then
    printf '  %-12s %s\n' "Seed" "${YELLOW}not seeded${NC}  ${DIM}→ pnpm seed:local${NC}"
  else
    printf '  %-12s %s\n' "Seed" "${GREEN}present${NC}"
  fi

  printf '\n%s\n' "  ${DIM}Infra${NC}"
  printf '    %-10s %s\n' "Studio" "$(studio_url)"
  printf '    %-10s %s\n' "Mailpit" "$(mailpit_url)"
  printf '    %-10s %s\n' "Dev DB" "$LOCAL_DB_URL"

  printf '\n%s\n' "  ${DIM}Apps${NC}"
  local entry port name
  for entry in "${APP_PORTS[@]}"; do
    port="${entry%%:*}"; name="${entry##*:}"
    if port_listening "$port"; then
      printf '    %-10s %s  %s\n' "$name" "http://localhost:$port" "${GREEN}listening${NC}"
    else
      printf '    %-10s %s  %s\n' "$name" "http://localhost:$port" "${DIM}not running${NC}"
    fi
  done

  printf '%s\n\n' "  ────────────────────────────────────────────────────────"
}

# ------------------------------------------------------------------- up ----
cmd_up() {
  assert_no_remote_env
  ensure_docker

  # Owns preflight, config check, supabase start, .env.test, migrations,
  # the disposable test DB, and the eight verify assertions.
  "$TEST_ENV" up

  seed_step

  status_board
  printf '%s\n' "  ${BOLD}Next:${NC} pnpm dev   ${DIM}(or: pnpm local:dev)${NC}"
  printf '%s\n\n' "  Test OTP numbers are listed in the supabase section above."
}

cmd_dev() {
  cmd_up
  step "Starting dev servers"
  printf '%s\n\n' "  ${DIM}Ctrl-C stops the dev servers; the Supabase stack keeps running.${NC}"
  exec pnpm dev
}

cmd_status() {
  status_board
}

cmd_down() {
  "$TEST_ENV" down
}

# Destructive. The RESET confirmation prompt lives in test-env.sh and is left
# intact — `--yes` is forwarded through for anyone who wants to skip it.
cmd_reset() {
  assert_no_remote_env
  ensure_docker

  # test-env.sh reset requires a running stack (it drives `supabase db reset`).
  if ! supabase_running; then
    step "Supabase stack"
    warn "not running — starting it first"
    supabase start >/dev/null || die "supabase start failed. Remedy: pnpm local"
    pass "started"
  fi

  "$TEST_ENV" reset "$@"
  seed_step force
  status_board
}

# ------------------------------------------------------------- dispatch ----
usage() {
  # The header comment block, which ends at `set -euo pipefail`.
  sed -n "2,$(($(grep -n '^set -euo' "${BASH_SOURCE[0]}" | cut -d: -f1) - 1))p" \
    "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

main() {
  local cmd="${1:-up}"
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    up)     cmd_up "$@" ;;
    dev)    cmd_dev "$@" ;;
    status) cmd_status "$@" ;;
    down)   cmd_down "$@" ;;
    reset)  cmd_reset "$@" ;;
    -h|--help|help) usage ;;
    *)      usage; exit 1 ;;
  esac
}

main "$@"
