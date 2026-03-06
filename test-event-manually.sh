#!/bin/bash

echo "🧪 Manual Event Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get auth token from MU plugin
AUTH_TOKEN=$(grep "NEXUS_AI_AUTH_TOKEN" ~/Local\ Sites/nexus-e2e-test/app/public/wp-content/mu-plugins/nexus-ai-connector-config.php | grep -oE "'[^']+'" | tail -1 | tr -d "'")

echo "Sending test event to HTTP endpoint..."
echo ""

curl -v -X POST http://127.0.0.1:13000/wp-events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "site_id": "nexus-e2e-test",
    "event_type": "post_created",
    "timestamp": '$(date +%s000)',
    "payload": {
      "post_id": 999,
      "title": "Manual Test Event",
      "content": "This is a manually sent test event",
      "excerpt": "Test excerpt",
      "status": "publish",
      "post_type": "post",
      "author_id": 1,
      "created_at": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
      "updated_at": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
    }
  }' 2>&1

echo ""
echo ""
echo "Check event stats with:"
echo "  npm run test:e2e -- tests/e2e/18-wordpress-events.e2e.test.ts -t 'should track events'"
