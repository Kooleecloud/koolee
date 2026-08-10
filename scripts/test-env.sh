#!/usr/bin/env bash
#
# Koolee local test environment.
#
#   ./scripts/test-env.sh up       stand up + migrate + verify (idempotent)
#   ./scripts/test-env.sh verify   read-only assertions against the local DB
#   ./scripts/test-env.sh reset    wipe local DB, re-apply Drizzle migrations
#   ./scripts/test-env.sh down     stop the stack (data volumes persist)
#   ./scripts/test-env.sh doctor   diagnose without changing anything
#   ./scripts/test-env.sh setup-test-db  create/migrate/mark koolee_test only
#   ./scripts/test-env.sh drop-test-db   delete the disposable koolee_test DB
#
# TWO DATABASES, one Postgres container: `postgres` is what the dev servers
# and your real bookings use; `koolee_test` is disposable and is the only one
# the integration suites are allowed to wipe. See setup_test_database below.
#
# SAFETY: every subcommand that touches a database refuses to run unless the
# resolved DATABASE_URL host is 127.0.0.1 or localhost. There is no bypass
# flag. See assert_local below. Full docs: packages/core/docs/local-test-env.md
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOCAL_API_URL="http://127.0.0.1:54321"

# The integration suites delete rows between tests, so they get their own
# database rather than the one the dev servers (and real bookings) live in.
# It is a second database inside the Postgres container that is ALREADY
# running — no extra service, no extra memory. Disposable by design: drop it
# any time and `test-env.sh up` rebuilds it.
#
# `MARKER_TABLE` is what makes the separation enforceable rather than a
# convention: packages/core/vitest.global-setup.ts refuses to run unless it
# finds this table, so a mispointed TEST_DATABASE_URL fails closed instead of
# emptying the dev database.
TEST_DB_NAME="koolee_test"
TEST_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/$TEST_DB_NAME"
MARKER_TABLE="__koolee_test_database"

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

# ------------------------------------------------------- test database ----
# Create (if absent), migrate, and mark the disposable test database. Safe to
# re-run: CREATE DATABASE is guarded by a catalog check and the marker table
# uses IF NOT EXISTS. Never touches the dev database's contents.
setup_test_database() {
  assert_local "$TEST_DB_URL"

  local exists
  exists="$(psql "$LOCAL_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "select 1 from pg_database where datname = '$TEST_DB_NAME'")"
  if [[ "$exists" == "1" ]]; then
    pass "database $TEST_DB_NAME already exists"
  else
    # CREATE DATABASE cannot run inside a transaction block, hence its own -c.
    psql "$LOCAL_DB_URL" -X -q -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE $TEST_DB_NAME" >/dev/null
    pass "created database $TEST_DB_NAME"
  fi

  # The marker goes on FIRST, so a run that races the rest still fails the
  # guard for the right reason rather than looking like the dev database.
  psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "
    CREATE TABLE IF NOT EXISTS $MARKER_TABLE (
      note text NOT NULL DEFAULT
        'Disposable. Integration tests delete rows here between runs. Never point a dev server at this database.'
    )" >/dev/null
  pass "marker table $MARKER_TABLE present"

  # Structure is CLONED from the dev database rather than rebuilt by running
  # the Drizzle migrations against an empty one. Those migrations cannot build
  # a database on their own: they create RLS policies over `storage.objects`,
  # insert the `bag-photos` row into `storage.buckets`, and call `auth.uid()`
  # — all owned by Supabase's GoTrue/Storage services, which only ever
  # provision the `postgres` database. `db:migrate` against a fresh database
  # dies on `relation "storage.buckets" does not exist`.
  #
  # `pg_dump --schema-only` copies DDL and no rows, so nothing of yours is
  # duplicated, and it keeps working as the schema grows without this script
  # needing to know which Supabase schemas are involved. The dev database is
  # only ever READ here.
  step "Clone schema from the dev database (structure only, zero rows)"
  command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found on PATH. Remedy: brew install libpq && brew link --force libpq"
  # ON_ERROR_STOP=0: a Supabase dump replays extension and role grants that
  # are already satisfied cluster-wide and harmlessly re-error. The table-count
  # assertion below is what actually decides whether the clone worked.
  pg_dump "$LOCAL_DB_URL" --schema-only --quote-all-identifiers 2>/dev/null \
    | psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 || true

  local expected actual
  expected="$(psql "$LOCAL_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "select count(*) from pg_catalog.pg_tables where schemaname = 'public'")"
  actual="$(psql "$TEST_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "select count(*) from pg_catalog.pg_tables where schemaname = 'public' and tablename <> '$MARKER_TABLE'")"
  if [[ "$expected" != "$actual" ]]; then
    die "schema clone incomplete: dev has $expected public tables, $TEST_DB_NAME has $actual. Nothing else was changed; inspect with: pnpm test:env:doctor"
  fi
  pass "cloned $actual public tables (plus auth/storage schemas)"

  # The ONE table whose rows are copied: Drizzle's journal. --schema-only
  # brings the table but not its contents, so without this Drizzle sees a
  # database with every table already present and no migrations recorded, and
  # re-runs 0000 straight into `type "booking_status" already exists`.
  pg_dump "$LOCAL_DB_URL" --data-only --table 'drizzle.__drizzle_migrations' 2>/dev/null \
    | psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null
  pass "migration journal copied"

  # Applies anything the dev database has not caught up to yet; a no-op right
  # after a clone.
  DATABASE_URL="$TEST_DB_URL" DIRECT_DATABASE_URL="$TEST_DB_URL" \
    pnpm --filter @koolee/db db:migrate
  pass "migrations up to date on $TEST_DB_NAME"
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
#
# TEST_DATABASE_URL is the DISPOSABLE database the integration suites wipe
# between tests. GOTRUE_TEST_DATABASE_URL is the dev database, used only by
# the three suites that drive the real GoTrue API and must read auth.users in
# the same connection — those preserve pre-existing rows (see
# packages/core/src/test-utils/preserve-existing-rows.ts). Do not swap them.
TEST_DATABASE_URL=$TEST_DB_URL
GOTRUE_TEST_DATABASE_URL=$LOCAL_DB_URL
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

  step "Disposable test database ($TEST_DB_NAME)"
  setup_test_database

  step "Verify"
  cmd_verify

  step "Summary"
  echo "  Studio:    $studio_url"
  echo "  Mailpit:   $mailpit_url"
  echo "  Dev DB:    $LOCAL_DB_URL"
  echo "  Test DB:   $TEST_DB_URL  (disposable — integration suites wipe this one)"
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
  local failures=0 checks=0

  vcheck() {
    local name="$1" expected="$2" actual="$3"
    checks=$((checks + 1))
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

  # 6+7. The disposable test database exists, carries the marker the vitest
  #      guard looks for, and has the same schema as the dev database. Without
  #      the marker every integration suite refuses to run — by design.
  local test_marker test_tables
  test_marker="$(psql "$TEST_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "select count(*) from pg_catalog.pg_tables where schemaname = 'public' and tablename = '$MARKER_TABLE'" 2>/dev/null || echo '<database missing>')"
  vcheck "$TEST_DB_NAME carries the $MARKER_TABLE marker" "1" "$test_marker"

  if [[ "$test_marker" == "1" ]]; then
    test_tables="$(psql "$TEST_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -c "select count(*) from pg_catalog.pg_tables where schemaname = 'public' and tablename <> '$MARKER_TABLE'")"
    vcheck "$TEST_DB_NAME public table count matches Drizzle schema" "$expected_tables" "$test_tables"
  fi

  if [[ $failures -gt 0 ]]; then
    die "verify: $failures of $checks check(s) failed"
  fi
  echo "  ${GREEN}${BOLD}verify: all $checks checks passed${NC}"
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

  # `supabase db reset` only rebuilds the database GoTrue serves, so the test
  # database is recreated here rather than assumed to have survived.
  step "Rebuild disposable test database ($TEST_DB_NAME)"
  setup_test_database

  step "Verify"
  cmd_verify
}

# ------------------------------------------------ set up the test database ----
# Just the disposable database, and the two URLs .env.test needs to point at
# it — no `supabase start`, no dev-database migrations, no key regeneration.
# For picking up this separation on an existing checkout whose stack is already
# healthy, without touching the database your bookings live in.
cmd_setup_test_db() {
  resolve_db_url
  require_stack_running
  [[ -f "$ENV_TEST_FILE" ]] || die ".env.test not found — run: pnpm test:env:up"

  step "Disposable test database ($TEST_DB_NAME)"
  setup_test_database

  step "Point .env.test at it"
  # Rewrite just these two keys; everything else in the file is preserved.
  local tmp
  tmp="$(mktemp)"
  grep -vE '^(TEST_DATABASE_URL|GOTRUE_TEST_DATABASE_URL)=' "$ENV_TEST_FILE" > "$tmp"
  {
    echo "TEST_DATABASE_URL=$TEST_DB_URL"
    echo "GOTRUE_TEST_DATABASE_URL=$LOCAL_DB_URL"
  } >> "$tmp"
  cat "$tmp" > "$ENV_TEST_FILE"
  rm -f "$tmp"
  pass "TEST_DATABASE_URL → $TEST_DB_NAME, GOTRUE_TEST_DATABASE_URL → postgres"
}

# ------------------------------------------------- drop the test database ----
# The disposable database holds nothing anyone needs; this exists so reclaiming
# the space is an obvious one-liner rather than remembered psql. `up` and
# `reset` both rebuild it.
cmd_drop_test_db() {
  resolve_db_url
  require_stack_running
  psql "$LOCAL_DB_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $TEST_DB_NAME WITH (FORCE)" >/dev/null
  pass "dropped $TEST_DB_NAME (rebuild with: pnpm test:env:up)"
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
    setup-test-db) cmd_setup_test_db "$@" ;;
    drop-test-db)  cmd_drop_test_db "$@" ;;
    -h|--help|help) usage ;;
    *)       usage; exit 1 ;;
  esac
}

main "$@"
