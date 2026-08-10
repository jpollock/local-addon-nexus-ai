#!/bin/bash
set -e

cd "$(dirname "$0")"

# Secrets Local needs at runtime (e.g. NEXUS_GOOGLE_CLIENT_SECRET for the Google OAuth token
# exchange). Kept in a gitignored file rather than the script, so nothing lands in the repo.
#
# `export FOO=… ; open /Applications/Local.app` does NOT work: `open` hands the launch to launchd,
# which starts the app with launchd's environment, not this shell's. `open --env` is the supported
# way to inject one, and it only applies when the app is actually starting — which is why the
# pkill above matters. If Local is already running, `open` just activates it and the env is
# ignored.
ENV_FILE="nexus.env.local"
OPEN_ARGS=()
PASSED=""
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    # Strip an optional leading `export ` so the file can be sourced by hand too.
    line="${line#export }"
    OPEN_ARGS+=(--env "$line")
    PASSED="$PASSED ${line%%=*}"
  done < "$ENV_FILE"
fi

echo "Killing Local..."
pkill -x "Local" 2>/dev/null || true
sleep 1

echo "Building..."
npm run build

echo "Rebuilding native modules..."
npm run rebuild

if [ -n "$PASSED" ]; then
  # Names only — never the values.
  echo "Passing env to Local:$PASSED"
else
  echo "No $ENV_FILE — launching without extra env."
fi

echo "Launching Local..."
open "${OPEN_ARGS[@]}" /Applications/Local.app
