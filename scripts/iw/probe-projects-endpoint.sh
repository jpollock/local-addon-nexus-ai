#!/bin/bash
# Probe whether a wpe_ API key can ENUMERATE projects (and/or accounts) directly.
# This decides whether Nexus can build a native project picker for the global
# Layer-2 Power provider, or must fall back to manual project_id paste.
#
# Read-only: only GETs, creates no objects, needs no cleanup.
# Usage: API_KEY=wpe_xxx ./scripts/iw/probe-projects-endpoint.sh

API_KEY="${API_KEY:-}"
BASE="https://api.ai.wpengine.com"
# Known CAPI account id (== wpe_auth_account_id == CAPI w7579), see findings.md §3.
ACCOUNT_ID="${ACCOUNT_ID:-b97e432b-c10a-4f0a-9ce7-55cedd575099}"

if [ -z "$API_KEY" ]; then
  echo "Usage: API_KEY=wpe_xxx $0"
  exit 1
fi

check() {
  local label=$1 path=$2
  local code
  code=$(curl -s -o /tmp/power_projects_out.json -w "%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    -H "WPEngine-Project: dummy" \
    "$BASE$path")
  local preview
  preview=$(cat /tmp/power_projects_out.json 2>/dev/null | head -c 300)
  if [ "$code" = "200" ]; then
    echo "✓ $code  $label"
    echo "     $preview"
  else
    echo "✗ $code  $label"
    [ -n "$preview" ] && echo "     $preview"
  fi
}

echo "=== Candidate project/account enumeration endpoints (wpe_ key) ==="
check "GET /v1/projects"                          "/v1/projects"
check "GET /v1/projects?account_id="              "/v1/projects?account_id=$ACCOUNT_ID"
check "GET /v1/accounts"                          "/v1/accounts"
check "GET /v1/accounts/{id}/projects"            "/v1/accounts/$ACCOUNT_ID/projects"
echo ""
echo "Done. A 200 with a JSON list on ANY row => a native picker is feasible."
echo "All 403/404 => manual project_id paste for v1."
