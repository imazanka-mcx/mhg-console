#!/usr/bin/env bash
# Proves that the Inn Code Standard's uniqueness guarantees are enforced by the
# database, not by application discipline (docs/01 §1.2, G3 and G8).
#
# Each case states what Postgres must do and fails loudly if it does something
# else. Run against a throwaway database:
#
#   PSQL="psql -h /tmp -p 5433 -U postgres -d console_test" ./constraints.sh
#
set -uo pipefail
PSQL="${PSQL:-psql -h /tmp -p 5433 -U postgres -d console_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0

ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; echo "        $2"; fail=$((fail+1)); }

# Runs SQL expecting it to SUCCEED.
expect_ok() {
  local label="$1" sql="$2" out
  out=$($PSQL -v ON_ERROR_STOP=1 -q -c "$sql" 2>&1) && ok "$label" || bad "$label" "$out"
}

# Runs SQL expecting Postgres to REFUSE it with the named error.
expect_violation() {
  local label="$1" sql="$2" want="$3" out
  out=$($PSQL -v ON_ERROR_STOP=1 -q -c "$sql" 2>&1)
  if [ $? -eq 0 ]; then
    bad "$label" "statement was ACCEPTED; the constraint is not doing its job"
  elif echo "$out" | grep -q "$want"; then
    ok "$label"
  else
    bad "$label" "refused, but not for the expected reason: $out"
  fi
}

seed_property() { # id, code, market, submarket
  $PSQL -q -c "INSERT INTO property (id, code, name, brand_code, brand_name, chain_code, market_code, city, state, submarket, status, effective_date, prop_code, updated_at)
               VALUES ('$1','$2','BYX Collection Evansville','BC','BYX Collection','MAZ','$3','Evansville','IN','$4','active','2026-09-15','$2', now());" >/dev/null
  $PSQL -q -c "INSERT INTO inn_code (code, property_id, name, brand_code, brand_name, chain_code, market_code, city, state, submarket, status, effective_date, prop_code)
               VALUES ('$2','$1','BYX Collection Evansville','BC','BYX Collection','MAZ','$3','Evansville','IN','$4','active','2026-09-15','$2');" >/dev/null
}

echo "Resetting schema…"
$PSQL -v ON_ERROR_STOP=1 -q -f "$HERE/ddl.sql" >/dev/null || { echo "DDL failed"; exit 1; }

echo
echo "G3/G8 — a code is claimed exactly once, forever"
seed_property prop-1 EVVBC EVV ''
expect_violation "a second property cannot take an issued code" \
  "INSERT INTO inn_code (code, property_id, name, brand_code, brand_name, chain_code, market_code, city, state, status, effective_date, prop_code)
   VALUES ('EVVBC','prop-1','Other','BC','BYX Collection','MAZ','EVV','Evansville','IN','active','2026-09-15','EVVBC');" \
  "duplicate key value violates unique constraint"

expect_ok "retiring a code leaves the row in place" \
  "UPDATE inn_code SET status = 'retired' WHERE code = 'EVVBC';"
expect_violation "a RETIRED code is still claimed — G3 fires against history" \
  "INSERT INTO inn_code (code, property_id, name, brand_code, brand_name, chain_code, market_code, city, state, status, effective_date, prop_code)
   VALUES ('EVVBC','prop-1','Reissue','BC','BYX Collection','MAZ','EVV','Evansville','IN','active','2026-09-15','EVVBC');" \
  "duplicate key value violates unique constraint"
$PSQL -q -c "UPDATE inn_code SET status='active' WHERE code='EVVBC';" >/dev/null

echo
echo "M6/M7 — a market code belongs to one place, a submarket to one claim"
expect_ok "a base market claim binds no submarket (null key)" \
  "INSERT INTO market_claim (market_code, city, state, submarket, source, claimed_at, submarket_key)
   VALUES ('EVV','Evansville','IN','','airport','2026-09-15', NULL);"
expect_violation "the same market code cannot be claimed twice (M7)" \
  "INSERT INTO market_claim (market_code, city, state, submarket, source, claimed_at, submarket_key)
   VALUES ('EVV','Owensboro','KY','','airport','2026-09-15', NULL);" \
  "duplicate key value violates unique constraint"

expect_ok "a second base market claim coexists — nulls do not collide" \
  "INSERT INTO market_claim (market_code, city, state, submarket, source, claimed_at, submarket_key)
   VALUES ('OWB','Owensboro','KY','','airport','2026-09-15', NULL);"

expect_ok "a split claims its submarket (M5)" \
  "INSERT INTO market_claim (market_code, city, state, submarket, source, claimed_at, submarket_key)
   VALUES ('EVW','Evansville','IN','West','submarket','2026-09-15','evansville|IN|west');"
expect_violation "a second code cannot own the same submarket (M6)" \
  "INSERT INTO market_claim (market_code, city, state, submarket, source, claimed_at, submarket_key)
   VALUES ('EVX','Evansville','IN','West','submarket','2026-09-15','evansville|IN|west');" \
  "duplicate key value violates unique constraint"

echo
echo "G1/G2 — a rebrand moves the code, never the property id"
$PSQL -q -c "INSERT INTO inn_code (code, property_id, name, brand_code, brand_name, chain_code, market_code, city, state, status, predecessor_code, effective_date, prop_code)
             VALUES ('EVVLX','prop-1','BYX Luxury Evansville','LX','BYX Luxury','MAZ','EVV','Evansville','IN','active','EVVBC','2026-09-15','EVVLX');" >/dev/null
$PSQL -q -c "UPDATE property SET code='EVVLX', brand_code='LX', brand_name='BYX Luxury', predecessor_code='EVVBC', prop_code='EVVLX', updated_at=now() WHERE id='prop-1';" >/dev/null
$PSQL -q -c "UPDATE inn_code SET status='retired' WHERE code='EVVBC';" >/dev/null

check() { # label, sql, expected
  local out; out=$($PSQL -tAq -c "$2" 2>&1)
  [ "$out" = "$3" ] && ok "$1" || bad "$1" "expected '$3', got '$out'"
}
check "the property keeps its id"                 "SELECT count(*) FROM property WHERE id='prop-1';" "1"
check "…and there is still only one property row" "SELECT count(*) FROM property;"                   "1"
check "the property now flies the new code"       "SELECT code FROM property WHERE id='prop-1';"     "EVVLX"
check "both codes survive in the ledger"          "SELECT count(*) FROM inn_code WHERE property_id='prop-1';" "2"
check "the old code is retired, not deleted"      "SELECT status FROM inn_code WHERE code='EVVBC';"  "retired"
check "retiring it did not touch the property"    "SELECT status FROM property WHERE id='prop-1';"   "active"
check "the new code points back (G2)"             "SELECT predecessor_code FROM inn_code WHERE code='EVVLX';" "EVVBC"

echo
echo "G8 — the race two writers actually run"
# Two concurrent transactions derive the same free code and both try to claim it.
# Exactly one may win, and the loser must be refused by the database rather than
# by anything the application remembered to check.
$PSQL -q -c "INSERT INTO property (id, code, name, brand_code, brand_name, chain_code, market_code, city, state, status, effective_date, prop_code, updated_at)
             VALUES ('prop-2','TMPAA','Race A','BC','BYX Collection','MAZ','IND','Indianapolis','IN','active','2026-09-15','TMPAA', now());" >/dev/null
#
# Both sessions are launched together and each sleeps INSIDE its transaction
# before inserting, so the two inserts genuinely overlap. Whichever arrives
# second blocks on the unique index until the first commits, then is refused.
# (Run sequentially this proves nothing about concurrency — only that an
# already-committed row is in the way.)
race_sql="BEGIN; SELECT pg_sleep(0.5);
INSERT INTO inn_code (code, property_id, name, brand_code, brand_name, chain_code, market_code, city, state, status, effective_date, prop_code)
VALUES ('INDBC','prop-2','Racer','BC','BYX Collection','MAZ','IND','Indianapolis','IN','active','2026-09-15','INDBC'); COMMIT;"
$PSQL -v ON_ERROR_STOP=1 -q -c "$race_sql" >/tmp/race-a.log 2>&1 &
a_pid=$!
$PSQL -v ON_ERROR_STOP=1 -q -c "$race_sql" >/tmp/race-b.log 2>&1 &
b_pid=$!
wait $a_pid; a=$?
wait $b_pid; b=$?
a_out=$(cat /tmp/race-a.log); b_out=$(cat /tmp/race-b.log)
winners=$(( (a==0) + (b==0) ))
rows=$($PSQL -tAq -c "SELECT count(*) FROM inn_code WHERE code='INDBC';")
if [ "$winners" -eq 1 ] && [ "$rows" = "1" ]; then
  ok "exactly one writer claimed INDBC; the loser was refused by Postgres"
else
  bad "concurrent claim" "winners=$winners rows=$rows | A: $a_out | B: $b_out"
fi

echo
echo "─────────────────────────────────────────"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
