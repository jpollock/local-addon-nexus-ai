#!/bin/bash
# Run the platform benchmark from a neutral directory so promptfoo
# uses the system Node's better-sqlite3, not the addon's Electron build.
#
# Usage:
#   cd ~/development/wpengine/local-addon-nexus-ai/tests/platform-bench
#   set -a; source ../../nexus.env.local; set +a     # supplies COWORKER_API_KEY
#   ./run.sh
#
# Extra args pass through to `promptfoo eval`. To run one scenario:
#   ./run.sh --filter-pattern 'CV-A-01'
# It is --filter-pattern, matched against the test description. There is no
# --filter-description in promptfoo 0.122.0, and passing one exits non-zero
# AFTER the isolation preflight has already run.

set -e

BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$BENCH_DIR/promptfooconfig.yaml"

# ── Isolation preflight ───────────────────────────────────────────────────────
# Claude Code keeps persistent memory per working directory and injects it into
# every session started there. Each column runs in its own cwd under
# ~/.nexus-bench (see providers/isolation.js); clear the memory those cwds map to
# so this run cannot read what an earlier run wrote. Without this, a repeat count
# measures memorisation rather than capability — which is exactly what happened in
# eval-t7J-2026-08-24T22:22:15.
CLEARED=0
for d in "$HOME/.claude/projects/"*nexus-bench*/memory; do
  [ -d "$d" ] || continue
  rm -rf "$d"
  CLEARED=$((CLEARED + 1))
done
echo "Isolation: cleared $CLEARED bench memory dir(s); columns run --tools '' (MCP only)."

# Refuse to run if the old shared /tmp memory is still in place — it carries the
# CV-B-01 answer key and would contaminate anything that still runs from /tmp.
STALE="$HOME/.claude/projects/-private-tmp/memory"
if [ -d "$STALE" ] && ls "$STALE"/*capybara* >/dev/null 2>&1; then
  echo "ERROR: benchmark answers still present in $STALE — quarantine them first." >&2
  exit 1
fi

# ── Model backend gate ────────────────────────────────────────────────────────
# The claude CLI serves the SAME pinned model ids from Vertex, Bedrock or
# Anthropic direct, chosen purely by environment — and a run on the wrong one
# does not fail. It silently succeeds and bills a different account, which is
# worse: nothing in the output says which one served. On this machine ~/.zshrc
# exports CLAUDE_CODE_USE_VERTEX=1, so a fresh terminal and a shell that unset
# it disagree invisibly, and their costs are not comparable (measured: opus
# $0.136 via Vertex vs $0.168 direct on one trivial prompt). Refuse rather than
# guess. A deliberate deviation is DECLARED, never skipped:
#   BENCH_EXPECTED_BACKEND=vertex ./run.sh
# This runs before the drift gate because it is free and the drift gate is not.
BACKEND_LINE=$(node -e "const m=require('$BENCH_DIR/providers/isolation'); const b=m.resolveModelBackend(); process.stdout.write(b.backend+'\t'+m.EXPECTED_BACKEND+'\t'+JSON.stringify(b));")
BACKEND_ACTUAL=$(printf '%s' "$BACKEND_LINE" | cut -f1)
BACKEND_WANTED=$(printf '%s' "$BACKEND_LINE" | cut -f2)
BACKEND_DETAIL=$(printf '%s' "$BACKEND_LINE" | cut -f3)
if [ "$BACKEND_ACTUAL" != "$BACKEND_WANTED" ]; then
  echo "ERROR: model backend is '$BACKEND_ACTUAL', but this run expects '$BACKEND_WANTED'." >&2
  echo "  Both backends serve the pinned model ids, so nothing would have failed —" >&2
  echo "  the run would simply bill a different account and produce costs that" >&2
  echo "  cannot be compared with the other runs already in results/." >&2
  case "$BACKEND_WANTED:$BACKEND_ACTUAL" in
    anthropic-oauth:vertex)
      echo "  For the personal account:  unset CLAUDE_CODE_USE_VERTEX" >&2
      echo "  (every fresh terminal turns Vertex ON via ~/.zshrc, so expect this)" >&2 ;;
    vertex:anthropic-oauth)
      echo "  For WP Engine's Vertex project:  export CLAUDE_CODE_USE_VERTEX=1" >&2 ;;
    *)
      echo "  Set the environment '$BACKEND_WANTED' requires before running." >&2 ;;
  esac
  echo "  To run deliberately on the current backend instead:" >&2
  echo "    BENCH_EXPECTED_BACKEND=$BACKEND_ACTUAL ./run.sh $*" >&2
  exit 1
fi
echo "Model backend: $BACKEND_DETAIL"

# ── Drift gate ────────────────────────────────────────────────────────────────
# keys.json is the answer key every rubric quotes. If the substrate no longer
# matches it, grading is meaningless — correct answers score wrong (the "8 vs
# 10" incident) or wrong ones score right. Re-measure before every run and
# refuse on mismatch. BENCH_SKIP_DRIFT=1 skips it for offline harness
# iteration — never for a run whose numbers anyone will quote.
GT_SNAPSHOT="$(mktemp -t nexus-bench-gt)"
if [ "${BENCH_SKIP_DRIFT:-0}" = "1" ]; then
  echo "Drift gate: SKIPPED (BENCH_SKIP_DRIFT=1) — do not publish numbers from this run."
  echo '{"skipped": true}' > "$GT_SNAPSHOT"
else
  echo "Drift gate: re-measuring substrate against keys.json…"
  if ! node "$BENCH_DIR/ground-truth.js" --check > "$GT_SNAPSHOT"; then
    echo "Drift gate FAILED — see mismatches above. Not running." >&2
    exit 1
  fi
  echo "Drift gate: substrate matches keys.json."
fi

# Pinned promptfoo — the previous floating-tag invocation broke once already
# (--filter-description ceased to exist between versions). The pin lives in providers/isolation.js.
PF_VERSION=$(node -p "require('$BENCH_DIR/providers/isolation.js').PF_VERSION")

# promptfoo itself runs from /tmp so its sqlite does not conflict with the addon's
# Electron-compiled better-sqlite3. The claude subprocesses do NOT inherit this
# cwd — each provider sets its own.
cd /tmp

OUT_JSON="$(mktemp -t nexus-bench-out).json"
echo "Running benchmark from /tmp (avoids Electron ABI conflict)..."

# promptfoo exits non-zero when any cell fails an assertion. That is a result,
# not an error — the archive step below must run either way (never lose a run),
# so the exit code is captured and re-raised at the end.
EVAL_EXIT=0
npx "promptfoo@$PF_VERSION" eval -c "$CONFIG" --no-cache -o "$OUT_JSON" "$@" || EVAL_EXIT=$?

# ── Archive ───────────────────────────────────────────────────────────────────
EVAL_ID=$(node -p "(require('$OUT_JSON').evalId) || ''" 2>/dev/null || true)
if [ -z "$EVAL_ID" ]; then
  echo "WARNING: no evalId in promptfoo output — run NOT archived (promptfoo exit $EVAL_EXIT)." >&2
  exit "$EVAL_EXIT"
fi
RUN_DIR="$BENCH_DIR/results/$EVAL_ID"
mkdir -p "$RUN_DIR"
cp "$OUT_JSON" "$RUN_DIR/results.json"
node "$BENCH_DIR/manifest.js" "$EVAL_ID" "$RUN_DIR" "$GT_SNAPSHOT"
echo "Archived: $RUN_DIR (results.json + manifest.json)"
exit "$EVAL_EXIT"
