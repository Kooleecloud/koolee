#!/usr/bin/env bash
#
# Koolee local test environment.
#
#   ./scripts/test-env.sh up       stand up + migrate + verify (idempotent)
#   ./scripts/test-env.sh verify   read-only assertions against the local DB
#   ./scripts/test-env.sh reset    wipe local DB, re-apply Drizzle migrations
#   ./scripts/test-env.sh down     stop the stack (data volumes persist)
#   ./scripts/test-env.sh doctor   diagnose without changing anything
#
# SAFETY: every subcommand that touches a database refuses to run unless the
# resolved DATABASE_URL host is 127.0.0.1 or localhost. There is no bypass
# flag. See assert_local below. Full docs: packages/core/docs/local-test-env.md
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOCAL_API_URL="http://127.0.0.1:54321"

ENV_TEST_FILE="$REPO_ROOT/.env.test"
CONFIG_TOML="$REPO_ROOT/supabase/config.toml"
DRIZZLE_DIR="$REPO_ROOT/packages/db/drizzle"
STATUS_ENV_FILE="/tmp/koolee-supabase-status.env"
DOCS="packages/core/docs/local-test-env.md"

# ---------------------------------------------------------------- output ----
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; BOLD=""; NC=""
fi

step() { printf '%s\n' "${BLUE}▸${NC} $*"; }
pass() { printf '%s\n' "  ${GREEN}PASS${NC} $*"; }
warn() { printf '%s\n' "  ${YELLOW}WARN${NC} $*"; }
fail() { printf '%s\n' "  ${RED}FAIL${NC} $*" >&2; }
die()  { printf '%s\n' "${RED}ERROR${NC} $*" >&2; exit 1; }

# ---------------------------------------------------------- safety guard ----
# Extract the host from a postgres URL without connecting anywhere.
url_host() {
  local rest="$1"
  rest="${rest#*://}"      # strip scheme
  rest="${rest%%/*}"       # keep authority: [user[:pass]@]host[:port]
  rest="${rest%%\?*}"
  rest="${rest##*@}"       # strip userinfo
  if [[ $rest == \[* ]]; then
    rest="${rest#\[}"; printf '%s' "${rest%%]*}"   # IPv6 [::1]:5432
  else
    printf '%s' "${rest%%:*}"
  fi
}

# The load-bearing guard: refuse any non-local database before connecting.
# Called by every subcommand that migrates, writes, or resets. No bypass flag.
assert_local() {
  local url="$1" host
  host="$(url_host "$url")"
  if [[ "$host" != "127.0.0.1" && "$host" != "localhost" ]]; then
    printf '%s\n' "${RED}${BOLD}REFUSING TO RUN: database host is '${host:-<none>}', not 127.0.0.1/localhost.${NC}" >&2
    printf '%s\n' "${RED}This script only ever operates on the local Supabase stack. Nothing was executed against '${host:-<none>}'.${NC}" >&2
    printf '%s\n' "Unset DATABASE_URL/DIRECT_DATABASE_URL in your shell, or see $DOCS." >&2
    exit 1
  fi
}

# Resolve the DB URL this script will use. An exported DATABASE_URL is
# honored so the guard can inspect it — assert_local then rejects anything
# that is not local.
resolve_db_url() {
  DB_URL="${DATABASE_URL:-$LOCAL_DB_URL}"
  assert_local "$DB_URL"
  if [[ -n "${DIRECT_DATABASE_URL:-}" ]]; then
    assert_local "$DIRECT_DATABASE_URL"
  fi
}

# ------------------------------------------------------------ toml helpers ----
# Value of `key` inside literal [section], comments stripped. Empty if absent.
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
  ' "$CONFIG_TOML"
}

test_otp_entries() {
  awk '
    $0 == "[auth.sms.test_otp]" { f = 1; next }
    /^\[/ { f = 0 }
    f && /^[ \t]*[0-9]+[ \t]*=/ { gsub(/["\t ]/, ""); print }
  ' "$CONFIG_TOML"
}

# Runs the four required config.toml assertions. Mode "die" aborts on the
# first problem; mode "print" reports each value (used by doctor).
config_check() {
  local mode="$1" bad=0

  local anon; anon="$(toml_value auth enable_anonymous_sign_ins)"
  local otp_count; otp_count="$(test_otp_entries | wc -l | tr -d ' ')"
  local twilio; twilio="$(toml_value auth.sms.twilio enabled)"
  local dcc; dcc="$(toml_value auth.email double_confirm_changes)"

  if [[ "$mode" == "print" ]]; then
    echo "  [auth] enable_anonymous_sign_ins   = ${anon:-<missing>}   (want: true)"
    echo "  [auth.sms.test_otp] entries        = ${otp_count}   (want: >= 1)"
    echo "  [auth.sms.twilio] enabled          = ${twilio:-<missing>}   (want: true)"
    echo "  [auth.email] double_confirm_changes = ${dcc:-<missing>}   (want: false)"
    return 0
  fi

  [[ "$anon" == "true" ]] || { fail "config.toml: [auth] enable_anonymous_sign_ins must be true (found: ${anon:-<missing>})"; bad=1; }
  [[ "$otp_count" -ge 1 ]] || { fail "config.toml: [auth.sms.test_otp] must contain at least one number = code entry"; bad=1; }
  [[ "$twilio" == "true" ]] || { fail "config.toml: [auth.sms.twilio] enabled must be true (found: ${twilio:-<missing>}) — dummy credentials are fine, test_otp intercepts first"; bad=1; }
  [[ "$dcc" == "false" ]] || { fail "config.toml: [auth.email] double_confirm_changes must be false (found: ${dcc:-<missing>})"; bad=1; }

  if [[ $bad -ne 0 ]]; then
    die "supabase/config.toml is not test-ready. Fix the value(s) above by hand (this script never edits config.toml) — see $DOCS."
  fi
  pass "config.toml has all four required auth settings"
}

# --------------------------------------------------------------- helpers ----
require_stack_running() {
  supabase status >/dev/null 2>&1 || die "local Supabase stack is not running. Remedy: pnpm test:env:up"
}

# First matching key from the captured `supabase status -o env` output.
# Tries each pattern in order; prints the unquoted value.
status_val() {
  local pattern line v
  for pattern in "$@"; do
    line="$(grep -E "^${pattern}=" "$STATUS_ENV_FILE" | head -1 || true)"
    if [[ -n "$line" ]]; then
      v="${line#*=}"
      v="${v%\"}"; v="${v#\"}"
      printf '%s' "$v"
      return 0
    fi
  done
  return 1
}

run_drizzle_migrations() {
  resolve_db_url
  # Inline env beats every dotenv file (packages/db/.env points at the cloud
  # project). Both variables are pinned so nothing else can win.
  DATABASE_URL="$DB_URL" DIRECT_DATABASE_URL="$DB_URL" \
    pnpm --filter @koolee/db db:migrate
}

# ------------------------------------------------------------------- up ----
cmd_up() {
  resolve_db_url

  step "Preflight"
  command -v docker >/dev/null 2>&1 || die "docker not found on PATH. Remedy: install Docker Desktop (https://docker.com/products/docker-desktop)"
  docker info >/dev/null 2>&1 || die "Docker daemon is not running. Remedy: open -a Docker  (wait for it to finish starting, then re-run)"
  command -v supabase >/dev/null 2>&1 || die "supabase CLI not found on PATH. Remedy: brew install supabase/tap/supabase"
  command -v psql >/dev/null 2>&1 || die "psql not found on PATH. Remedy: brew install libpq && brew link --force libpq"
  command -v node >/dev/null 2>&1 || die "node not found on PATH"
  pass "docker daemon, supabase CLI, psql, node all available"

  step "Config check (supabase/config.toml)"
  config_check die

  step "Supabase stack"
  local start_output=""
  if supabase status >/dev/null 2>&1; then
    pass "already running — skipped supabase start"
  else
    if ! start_output="$(supabase start 2>&1)"; then
      # A concurrent/partial start can make `start` fail while the stack is
      # actually healthy — trust status as the tiebreaker.
      if ! supabase status >/dev/null 2>&1; then
        printf '%s\n' "$start_output" >&2
        die "supabase start failed (output above)"
      fi
    fi
    pass "supabase start completed"
  fi

  step "Phone OTP login"
  local status_output
  status_output="$(supabase status 2>&1 || true)"
  if printf '%s\n%s\n' "$start_output" "$status_output" | grep -qi "no SMS provider is enabled"; then
    die "GoTrue reports 'no SMS provider is enabled' — phone login is silently OFF and auth tests 15/16 will fail.
Remedy: set [auth.sms.twilio] enabled = true with dummy credentials in supabase/config.toml (test_otp intercepts before any real call), then: supabase stop && pnpm test:env:up. See $DOCS."
  fi
  pass "SMS provider enabled (test_otp numbers never reach it)"

  step "Generate .env.test"
  supabase status -o env 2>/dev/null > "$STATUS_ENV_FILE"
  chmod 600 "$STATUS_ENV_FILE"

  local anon_key service_key
  anon_key="$(status_val 'ANON_KEY' 'SUPABASE_ANON_KEY' '[A-Z0-9_]*PUBLISHABLE[A-Z0-9_]*')" \
    || die "could not find an anon/publishable key in 'supabase status -o env' output — refusing to write a blank .env.test"
  service_key="$(status_val 'SERVICE_ROLE_KEY' 'SUPABASE_SERVICE_ROLE_KEY' '[A-Z0-9_]*SECRET_KEY')" \
    || die "could not find a service-role/secret key in 'supabase status -o env' output — refusing to write a blank .env.test"

  local studio_url mailpit_url
  studio_url="$(status_val 'STUDIO_URL' '[A-Z0-9_]*STUDIO[A-Z0-9_]*' || echo 'http://127.0.0.1:54323')"
  mailpit_url="$(status_val 'MAILPIT_URL' 'INBUCKET_URL' || echo 'http://127.0.0.1:54324')"

  local hmac_key hmac_note="newly generated"
  if [[ -f "$ENV_TEST_FILE" ]]; then
    hmac_key="$(grep -E '^OTP_LOG_HMAC_KEY=' "$ENV_TEST_FILE" | head -1 | cut -d= -f2- || true)"
    [[ -n "${hmac_key:-}" ]] && hmac_note="preserved from existing .env.test"
  fi
  if [[ -z "${hmac_key:-}" ]]; then
    hmac_key="$(openssl rand -hex 32)"
  fi

  umask 177
  cat > "$ENV_TEST_FILE" <<EOF
# Generated by scripts/test-env.sh — never commit. Regenerate: pnpm test:env:up
TEST_DATABASE_URL=$LOCAL_DB_URL
DATABASE_URL=$LOCAL_DB_URL
AUTH_SCHEMA_AVAILABLE=true
SUPABASE_URL=$LOCAL_API_URL
SUPABASE_ANON_KEY=$anon_key
SUPABASE_SERVICE_ROLE_KEY=$service_key
OTP_LOG_HMAC_KEY=$hmac_key
EOF
  umask 022
  rm -f "$STATUS_ENV_FILE"
  pass ".env.test written (OTP_LOG_HMAC_KEY $hmac_note)"

  if git check-ignore -q .env.test 2>/dev/null || grep -qxF '.env.test' .gitignore 2>/dev/null; then
    pass ".env.test is git-ignored"
  else
    printf '\n.env.test\n' >> .gitignore
    pass ".env.test appended to .gitignore"
  fi

  step "Apply Drizzle migrations → $(url_host "$DB_URL")"
  run_drizzle_migrations
  pass "migrations applied"

  step "Verify"
  cmd_verify

  step "Summary"
  echo "  Studio:    $studio_url"
  echo "  Mailpit:   $mailpit_url"
  echo "  Database:  $LOCAL_DB_URL"
  echo "  Test phone numbers (dial as +<number>, from [auth.sms.test_otp]):"
  test_otp_entries | awk -F= '{ printf "    +%s → code %s\n", $1, $2 }'
  echo "  Run integration tests:"
  echo "    pnpm --filter @koolee/core test:integration"
}

# --------------------------------------------------------------- verify ----
cmd_verify() {
  resolve_db_url
  require_stack_running

  local psql_cmd=(psql "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1)
  local failures=0

  vcheck() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
      pass "$name ($actual)"
    else
      fail "$name — expected: $expected, got: $actual"
      failures=$((failures + 1))
    fi
  }

  # 1. public table count == tables in the latest Drizzle snapshot (derived,
  #    never hardcoded, so it cannot rot as the schema grows).
  local expected_tables actual_tables
  expected_tables="$(node -e '
    const fs = require("fs");
    const dir = process.argv[1];
    const snaps = fs.readdirSync(dir).filter(f => /^\d+_snapshot\.json$/.test(f)).sort();
    if (!snaps.length) { console.error("no drizzle snapshots in " + dir); process.exit(1); }
    const snap = JSON.parse(fs.readFileSync(dir + "/" + snaps[snaps.length - 1], "utf8"));
    const keys = Object.keys(snap.tables || {});
    const pub = keys.filter(k => k.startsWith("public."));
    console.log((pub.length ? pub : keys).length);
  ' "$DRIZZLE_DIR/meta")" || die "could not derive expected table count from $DRIZZLE_DIR/meta"
  actual_tables="$("${psql_cmd[@]}" -c "select count(*) from pg_catalog.pg_tables where schemaname = 'public'")"
  vcheck "public table count matches Drizzle schema" "$expected_tables" "$actual_tables"

  # 2. otp_send_log columns — exactly these four, and NO plaintext destination.
  local otp_cols
  otp_cols="$("${psql_cmd[@]}" -c "select coalesce(string_agg(column_name, ',' order by column_name), '<table missing>') from information_schema.columns where table_schema = 'public' and table_name = 'otp_send_log'")"
  vcheck "otp_send_log columns are exactly id,user_id,destination_hash,created_at (no destination)" \
    "created_at,destination_hash,id,user_id" "$otp_cols"

  # 3. applied migration rows == .sql files in packages/db/drizzle.
  local sql_files mig_rows
  sql_files="$(find "$DRIZZLE_DIR" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
  mig_rows="$("${psql_cmd[@]}" -c "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null || echo '<table missing>')"
  vcheck "drizzle.__drizzle_migrations rows == migration files" "$sql_files" "$mig_rows"

  # 4. GoTrue-present check: auth.users with the columns tests 15/16 exercise.
  local auth_cols
  auth_cols="$("${psql_cmd[@]}" -c "select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name in ('phone','phone_change','email','email_change','is_anonymous')")"
  vcheck "auth.users exposes phone, phone_change, email, email_change, is_anonymous (GoTrue present)" "5" "$auth_cols"

  # 5. Round trip as the postgres role — proves the migrate role can use the
  #    table (RLS/grant regressions show up here). Cleans up after itself.
  local rt_id rt_n
  rt_id="$("${psql_cmd[@]}" -c "insert into otp_send_log (user_id, destination_hash) values (gen_random_uuid(), '__test_env_verify__') returning id" 2>/dev/null || true)"
  if [[ -n "$rt_id" ]]; then
    rt_n="$("${psql_cmd[@]}" -c "select count(*) from otp_send_log where id = '$rt_id'")"
    "${psql_cmd[@]}" -c "delete from otp_send_log where id = '$rt_id'" >/dev/null
    vcheck "otp_send_log write/read/delete round trip" "1" "$rt_n"
  else
    fail "otp_send_log write/read/delete round trip — insert failed"
    failures=$((failures + 1))
  fi

  if [[ $failures -gt 0 ]]; then
    die "verify: $failures check(s) failed"
  fi
  echo "  ${GREEN}${BOLD}verify: all 5 checks passed${NC}"
}

# ---------------------------------------------------------------- reset ----
cmd_reset() {
  resolve_db_url
  require_stack_running

  if [[ "${1:-}" != "--yes" ]]; then
    printf '%s\n' "${YELLOW}${BOLD}This wipes ALL data in the local database ($(url_host "$DB_URL")).${NC}"
    printf 'Type RESET to continue: '
    local answer
    read -r answer
    [[ "$answer" == "RESET" ]] || die "aborted (nothing was changed)"
  fi

  step "supabase db reset (drops local Postgres; the CLI has no migrations of its own)"
  supabase db reset

  # Mandatory: Koolee's migrations live in packages/db/drizzle, NOT
  # supabase/migrations — without this step the public schema stays empty.
  step "Re-apply Drizzle migrations → $(url_host "$DB_URL")"
  run_drizzle_migrations
  pass "migrations re-applied"

  step "Verify"
  cmd_verify
}

# ----------------------------------------------------------------- down ----
cmd_down() {
  step "Stopping local Supabase stack"
  supabase stop
  pass "stack stopped"
  echo "  Note: database data persists across stop/start. To also delete it, run: supabase stop --no-backup"
}

# --------------------------------------------------------------- doctor ----
# Mirrors the precedence migrate.ts uses: shell DIRECT_DATABASE_URL, shell
# DATABASE_URL, then per-variable first-file-wins across the dotenv paths.
resolve_migrate_url_source() {
  if [[ -n "${DIRECT_DATABASE_URL:-}" ]]; then printf '%s\n%s\n' "shell DIRECT_DATABASE_URL" "$DIRECT_DATABASE_URL"; return 0; fi
  if [[ -n "${DATABASE_URL:-}" ]]; then printf '%s\n%s\n' "shell DATABASE_URL" "$DATABASE_URL"; return 0; fi
  local key f v
  for key in DIRECT_DATABASE_URL DATABASE_URL; do
    for f in packages/db/.env.local packages/db/.env .env.local .env; do
      if [[ -f "$f" ]]; then
        v="$(grep -E "^${key}=" "$f" | head -1 | cut -d= -f2- || true)"
        v="${v%\"}"; v="${v#\"}"
        if [[ -n "$v" ]]; then printf '%s\n%s\n' "$f ($key)" "$v"; return 0; fi
      fi
    done
  done
  printf '%s\n%s\n' "nothing sets it" ""
}

cmd_doctor() {
  step "Doctor — read-only diagnosis (no secrets are ever printed)"

  if docker info >/dev/null 2>&1; then
    echo "  Docker:          running"
  else
    echo "  Docker:          ${RED}NOT running${NC} (remedy: open -a Docker)"
  fi

  if supabase status >/dev/null 2>&1; then
    echo "  Supabase stack:  healthy"
  else
    echo "  Supabase stack:  ${YELLOW}not running${NC} (remedy: pnpm test:env:up)"
  fi

  local src url host
  { read -r src; read -r url; } < <(resolve_migrate_url_source)
  echo ""
  echo "  Resolved migrate DATABASE_URL (what 'pnpm --filter @koolee/db db:migrate' would use):"
  echo "    source:  $src"
  if [[ -n "$url" ]]; then
    host="$(url_host "$url")"
    echo "    host:    $host"
    if [[ "$host" == "127.0.0.1" || "$host" == "localhost" ]]; then
      echo "    local:   yes — this script's commands would accept it"
      echo "    ssl:     disabled (local host)"
    else
      echo "    local:   ${RED}NO — remote host; this script's commands will refuse it${NC}"
      echo "    ssl:     require (non-local host)"
    fi
  else
    echo "    host:    <none — migrate would fail with MissingDatabaseUrlError>"
  fi

  echo ""
  echo "  Env file precedence for packages/db (first hit wins, per variable;"
  echo "  DIRECT_DATABASE_URL from any source beats DATABASE_URL from any source):"
  local n=1
  echo "    $n. shell DIRECT_DATABASE_URL   $( [[ -n "${DIRECT_DATABASE_URL:-}" ]] && echo '(set)' || echo '(unset)' )"; n=$((n+1))
  echo "    $n. shell DATABASE_URL          $( [[ -n "${DATABASE_URL:-}" ]] && echo '(set)' || echo '(unset)' )"; n=$((n+1))
  local f
  for f in packages/db/.env.local packages/db/.env .env.local .env; do
    echo "    $n. $f  $( [[ -f "$f" ]] && echo '(exists)' || echo '(missing)' )"
    n=$((n+1))
  done

  echo ""
  echo "  supabase/config.toml required values:"
  config_check print

  echo ""
  if [[ -f "$ENV_TEST_FILE" ]]; then
    echo "  .env.test:       exists (secrets not shown)"
  else
    echo "  .env.test:       ${YELLOW}missing${NC} (remedy: pnpm test:env:up)"
  fi
}

# ------------------------------------------------------------- dispatch ----
usage() {
  sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

main() {
  local cmd="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    up)      cmd_up "$@" ;;
    verify)  cmd_verify "$@" ;;
    reset)   cmd_reset "$@" ;;
    down)    cmd_down "$@" ;;
    doctor)  cmd_doctor "$@" ;;
    -h|--help|help) usage ;;
    *)       usage; exit 1 ;;
  esac
}

main "$@"
