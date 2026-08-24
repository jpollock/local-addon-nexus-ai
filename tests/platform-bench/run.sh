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

# Run from /tmp so promptfoo's sqlite does not conflict with the addon's
# Electron-compiled better-sqlite3
cd /tmp

echo "Running benchmark from /tmp (avoids Electron ABI conflict)..."
npx promptfoo@latest eval -c "$CONFIG" --no-cache "$@"
