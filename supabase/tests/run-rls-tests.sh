#!/usr/bin/env bash
# =============================================================================
# JibonJori - local RLS test harness (HOST PostgreSQL)
# =============================================================================
# The same suite as run-rls-tests.mjs, for the case where a local PostgreSQL is
# available without Docker (for example inside WSL, where the distribution ships
# a PostgreSQL server). It runs exactly the same files in exactly the same order:
#
#   tests/bootstrap.sql -> migrations/*.sql -> tests/fixtures.sql
#     -> tests/rls_assertions.sql
#
# There is no second copy of the suite: only the executor differs (a container in
# the .mjs runner, a local server here).
#
#   bash supabase/tests/run-rls-tests.sh
#
# From Windows, run it inside the distribution that holds PostgreSQL:
#
#   wsl -d Ubuntu -- bash /mnt/d/Zeem/app/jibon_jori/supabase/tests/run-rls-tests.sh
#
# This is a DEVELOPMENT tool. The shipped application never connects to a local
# database - it talks only to Supabase over HTTPS.
#
# Environment overrides:
#   JJ_TEST_DB      throwaway database name   (default jibonjori_rls_test)
#   JJ_TEST_PG_USER superuser role            (default postgres, via sudo/su)
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "$HERE/.." && pwd)"
MIGRATIONS_DIR="$SUPABASE_DIR/migrations"

DB="${JJ_TEST_DB:-jibonjori_rls_test}"
PG_USER="${JJ_TEST_PG_USER:-postgres}"

# Safety: this script drops a database. It must be the throwaway test database.
case "$DB" in
  jibonjori_rls_test|jj_validate|jj_*) : ;;
  *)
    echo "refusing to run: JJ_TEST_DB must be a throwaway name starting with 'jj' (got '$DB')" >&2
    exit 2
    ;;
esac

# Pick an executor that can act as the PostgreSQL superuser.
if psql -U "$PG_USER" -d postgres -tAc 'select 1' >/dev/null 2>&1; then
  AS_PG=(psql -U "$PG_USER")
elif command -v sudo >/dev/null 2>&1 && sudo -n -u "$PG_USER" true 2>/dev/null; then
  AS_PG=(sudo -n -u "$PG_USER" psql)
elif [ "$(id -u)" -eq 0 ] && id "$PG_USER" >/dev/null 2>&1; then
  AS_PG=(su "$PG_USER" -s /bin/bash -c 'psql "$@"' --)
else
  echo "cannot connect as '$PG_USER': check that PostgreSQL is running and that sudo is passwordless" >&2
  exit 2
fi

run() { "${AS_PG[@]}" "$@"; }

apply() {
  local file="$1"
  if run -v ON_ERROR_STOP=1 -q -d "$DB" -f "$file" >/tmp/jj_rls_step.log 2>&1; then
    echo "  ok  $(basename "$file")"
  else
    echo "  FAIL  $(basename "$file")" >&2
    sed -n '1,60p' /tmp/jj_rls_step.log >&2
    exit 1
  fi
}

echo "recreating disposable database $DB"
run -q -c "drop database if exists $DB" >/dev/null
run -q -c "create database $DB" >/dev/null

echo "applying bootstrap + migrations + fixtures"
apply "$HERE/bootstrap.sql"
while IFS= read -r file; do
  apply "$file"
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort)
apply "$HERE/fixtures.sql"

echo
echo "running RLS assertions"
echo
if ! run -d "$DB" -f "$HERE/rls_assertions.sql"; then
  echo >&2
  echo "RLS TESTS FAILED" >&2
  exit 1
fi

echo
echo "RLS TESTS PASSED"
