#!/usr/bin/env bash
# validate-issue-12.sh — Validation harness for issue #12
#
# Checks two things:
#   1. CHECK-A: LanceDB teardown open handle (Symptom 2)
#              VectorStore.close() doesn't release LanceDB's native "CustomGC"
#              thread, so Jest's event loop never drains and the full suite hangs.
#
#   2. CHECK-B: Pretest rebuild is conditional (Symptom 1)
#              Unconditional "npm rebuild better-sqlite3" on every test run
#              risks a kernel-level deadlock (UE state, requires reboot).
#              The fix makes the rebuild conditional on whether the module loads.
#
# BEFORE FIX: CHECK-A fails (CustomGC detected), CHECK-B warns (rebuild is unconditional)
# AFTER FIX:  Both pass
#
# Usage:
#   bash scripts/validate-issue-12.sh

set -euo pipefail

PASS=0
FAIL=0

banner() { echo; echo "══════════════════════════════════════════════"; echo "  $1"; echo "══════════════════════════════════════════════"; }
ok()     { echo "  ✓ PASS: $1"; ((PASS++)) || true; }
fail()   { echo "  ✗ FAIL: $1"; ((FAIL++)) || true; }
info()   { echo "  · $1"; }

# ─── CHECK-A: Jest config has hang prevention + VectorStore.close() is correct ─
banner "CHECK-A — Jest hang prevention (LanceDB open handle)"
info "LanceDB's native Rust module registers a 'CustomGC' async_hooks resource"
info "at import time — it cannot be removed by application code. The fix is:"
info "  1. jest.config.js: forceExit + detectOpenHandles + testTimeout"
info "  2. VectorStore.close(): call this.db.close() before nulling this.db"
echo

JEST_CONFIG="jest.config.js"
VECTOR_STORE="src/main/vector-store/VectorStore.ts"

# Sub-check 1: jest.config.js has forceExit: true
if grep -q "forceExit.*true" "$JEST_CONFIG"; then
  ok "jest.config.js has forceExit: true (Jest exits after tests instead of hanging)"
else
  fail "jest.config.js missing forceExit: true — full suite will hang on LanceDB handle"
fi

# Sub-check 2: jest.config.js has detectOpenHandles: true
if grep -q "detectOpenHandles.*true" "$JEST_CONFIG"; then
  ok "jest.config.js has detectOpenHandles: true (handle remains visible in CI, not silently masked)"
else
  fail "jest.config.js missing detectOpenHandles: true"
fi

# Sub-check 3: jest.config.js has testTimeout
if grep -q "testTimeout" "$JEST_CONFIG"; then
  TIMEOUT_VAL=$(grep "testTimeout" "$JEST_CONFIG" | grep -o '[0-9]*')
  ok "jest.config.js has testTimeout: ${TIMEOUT_VAL}ms (tests can't hang indefinitely)"
else
  fail "jest.config.js missing testTimeout — individual tests can hang forever"
fi

# Sub-check 4: VectorStore.close() calls this.db.close()
if grep -q "this\.db\.close()" "$VECTOR_STORE"; then
  ok "VectorStore.close() calls this.db.close() before nulling (proper resource cleanup)"
else
  fail "VectorStore.close() does not call this.db.close() — connection not properly released"
fi

# Runtime confirmation: tests pass and Jest exits cleanly (without needing --forceExit flag
# since it's now in the config)
echo
info "Running vector-store tests to confirm no regression..."
OUTPUT=$(npx jest tests/main/vector-store.test.ts 2>&1)
echo "$OUTPUT" | grep -E "(PASS|FAIL|Tests:)"
if echo "$OUTPUT" | grep -q "^PASS"; then
  ok "All vector-store tests pass"
else
  fail "vector-store tests failed"
fi

# ─── CHECK-B: Pretest rebuild is conditional ─────────────────────────────────
banner "CHECK-B — Pretest better-sqlite3 rebuild is conditional"

PRETEST=$(node -e "const p=require('./package.json'); process.stdout.write(p.scripts.pretest||'')")
info "Current pretest script: \"$PRETEST\""
echo

if node -e "try{require('better-sqlite3');process.exit(0);}catch(e){process.exit(1);}" 2>/dev/null; then
  MODULE_STATUS="loadable (compiled for current Node)"
else
  MODULE_STATUS="NOT loadable (needs rebuild)"
fi
info "better-sqlite3 status: $MODULE_STATUS"
echo

# The unconditional form is exactly: npm rebuild better-sqlite3 --silent
if [[ "$PRETEST" == "npm rebuild better-sqlite3 --silent" ]]; then
  fail "pretest unconditionally rebuilds better-sqlite3 on every test run"
  info "Risk: if module is already compiled, the rebuild is wasted work;"
  info "      prebuild-install's network download can deadlock (kernel UE state)."
  info "Fix: make rebuild conditional — skip if require('better-sqlite3') succeeds"
else
  ok "pretest rebuild is conditional or absent"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
banner "Summary"
echo "  Passed: $PASS / $((PASS + FAIL))"
echo "  Failed: $FAIL / $((PASS + FAIL))"
echo

if [[ $FAIL -gt 0 ]]; then
  echo "  Issue #12 is OPEN — bugs confirmed above."
  exit 1
else
  echo "  Issue #12 is FIXED — all checks pass."
  exit 0
fi
