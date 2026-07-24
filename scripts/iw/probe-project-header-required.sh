#!/bin/bash
# Is the WPEngine-Project header actually REQUIRED for Layer-2 inference with a
# wpe_ Full Access key? We have always SENT it; never tested omitting it. This
# settles whether project_id stays in the Phase 1 design or gets dropped.
#
# Read-mostly: GET /v1/models per case + one max_tokens=1 POST /v1/chat/completions
# per case (negligible cost). Creates no persistent objects, needs no cleanup.
# Usage: API_KEY=wpe_xxx ./scripts/iw/probe-project-header-required.sh

API_KEY="${API_KEY:-}"
BASE="https://api.ai.wpengine.com/v1"
# Control project_id (same one test-power-api-key.sh uses).
REAL_PROJECT="${PROJECT_ID:-proj_cE8Ib44IuegI3rH5l1MbBy}"

if [ -z "$API_KEY" ]; then echo "Usage: API_KEY=wpe_xxx $0"; exit 1; fi

hit() {
  # $1 label  $2 method  $3 path  $4 project-header ("" => omit)  $5 body ("" => none)
  local label=$1 method=$2 path=$3 proj=$4 body=$5
  local args=(-s -o /tmp/iw_hdr_out.json -w "%{http_code}" -X "$method"
              -H "Authorization: Bearer $API_KEY")
  [ -n "$proj" ] && args+=(-H "WPEngine-Project: $proj")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" -d "$body")
  local code; code=$(curl "${args[@]}" "$BASE$path")
  local preview; preview=$(head -c 160 /tmp/iw_hdr_out.json 2>/dev/null | tr '\n' ' ')
  printf '  %-32s %s\n       %s\n' "$label" "$code" "$preview"
}

# Control first: real header on /models also gives us a guaranteed-valid model id,
# so the chat test can't be confounded by a bad model string.
curl -s -o /tmp/iw_models_real.json -w "" \
  -H "Authorization: Bearer $API_KEY" -H "WPEngine-Project: $REAL_PROJECT" "$BASE/models"
MODEL=$(grep -o '"id":"[^"]*"' /tmp/iw_models_real.json | head -1 | cut -d'"' -f4)
echo "control: first model id => ${MODEL:-<none found>}"
[ -z "$MODEL" ] && MODEL="anthropic/claude-3-5-haiku-20241022"
CHAT="{\"model\":\"$MODEL\",\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
echo

echo "=== GET /v1/models ==="
hit "NO project header"     GET  "/models"          ""            ""
hit "BOGUS project header"  GET  "/models"          "proj_bogus"  ""
hit "REAL project header"   GET  "/models"          "$REAL_PROJECT" ""
echo
echo "=== POST /v1/chat/completions (max_tokens=1) ==="
hit "NO project header"     POST "/chat/completions" ""            "$CHAT"
hit "BOGUS project header"  POST "/chat/completions" "proj_bogus"  "$CHAT"
hit "REAL project header"   POST "/chat/completions" "$REAL_PROJECT" "$CHAT"
echo
echo "Interpretation (look at the chat rows):"
echo "  NO-header 200            => project_id NOT required; DROP it from Phase 1."
echo "  NO-header 4xx, REAL 200  => project_id REQUIRED; keep the setting + header."
echo "  BOGUS 4xx but REAL 200   => value is validated; validation UX needs a real project_id."
