#!/bin/bash
# Test which Power API endpoints are accessible with a wpe_ API key.
# Usage: API_KEY=wpe_xxx ./scripts/test-power-api-key.sh

API_KEY="${API_KEY:-}"
BASE="https://api.ai.wpengine.com"
# From t2 site connection — update if testing a different project
PROJECT_ID="proj_cE8Ib44IuegI3rH5l1MbBy"

if [ -z "$API_KEY" ]; then
  echo "Usage: API_KEY=wpe_xxx $0"
  exit 1
fi

check() {
  local label=$1 method=$2 path=$3 body=$4
  local args=(-s -o /tmp/power_test_out.json -w "%{http_code}"
    -X "$method"
    -H "Authorization: Bearer $API_KEY"
    -H "WPEngine-Project: $PROJECT_ID")

  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local code
  code=$(curl "${args[@]}" "$BASE$path")
  local preview
  preview=$(cat /tmp/power_test_out.json 2>/dev/null | head -c 200)

  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    echo "✓ $code  $label"
  else
    echo "✗ $code  $label"
    [ -n "$preview" ] && echo "     $preview"
  fi
}

echo "=== Inference / Meta ==="
check "GET  /v1/models"          GET  "/v1/models"
check "GET  /v1/credits"         GET  "/v1/credits"
check "GET  /v1/analytics"       GET  "/v1/analytics?project_id=$PROJECT_ID&start_time=1700000000"

echo ""
echo "=== Content Tooling ==="
check "POST /v1/content/summarize" POST "/v1/content/summarize" \
  '{"content":"WordPress is an open-source content management system used by millions of websites."}'
check "POST /v1/content/suggest-taxonomy" POST "/v1/content/suggest-taxonomy" \
  '{"content":"A post about WordPress performance optimization.","categories":["Tech","WordPress","Performance"]}'
check "POST /v1/images/alt-text" POST "/v1/images/alt-text" \
  '{"image":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}'

echo ""
echo "=== Agent Registry ==="
check "GET  /v1/agents"          GET  "/v1/agents?project_id=$PROJECT_ID"
check "POST /v1/agents (create)" POST "/v1/agents" \
  "{\"name\":\"nexus-test-agent\",\"model\":\"anthropic/claude-haiku-4-5\",\"project_id\":\"$PROJECT_ID\"}"

echo ""
echo "=== Sessions ==="
check "GET  /v1/sessions"        GET  "/v1/sessions?project_id=$PROJECT_ID"

echo ""
echo "=== Knowledge Base ==="
check "GET  /v1/kb/collections"  GET  "/v1/kb/collections"
check "POST /v1/kb/collections"  POST "/v1/kb/collections" \
  '{"name":"nexus-test-collection"}'

echo ""
echo "Done."
