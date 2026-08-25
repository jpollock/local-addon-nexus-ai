#!/bin/bash
# Run the platform benchmark from a neutral directory so promptfoo
# uses the system Node's better-sqlite3, not the addon's Electron build.
#
# Usage:
#   cd ~/development/wpengine/local-addon-nexus-ai/tests/platform-bench
#   export COWORKER_API_KEY=wpe_...
#   ./run.sh

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

# promptfoo itself runs from /tmp so its sqlite does not conflict with the addon's
# Electron-compiled better-sqlite3. The claude subprocesses do NOT inherit this
# cwd — each provider sets its own.
cd /tmp

echo "Running benchmark from /tmp (avoids Electron ABI conflict)..."
npx promptfoo@latest eval -c "$CONFIG" --no-cache "$@"
