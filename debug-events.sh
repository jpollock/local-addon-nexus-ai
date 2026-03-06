#!/bin/bash

SITE_NAME="${1:-nexus-e2e-test}"
SITE_PATH="$HOME/Local Sites/$SITE_NAME"

echo "🔍 Debugging WordPress Events for: $SITE_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Check if site exists
if [ ! -d "$SITE_PATH" ]; then
  echo "❌ Site not found at: $SITE_PATH"
  echo ""
  echo "Available sites:"
  ls -1 "$HOME/Local Sites/" | head -10
  exit 1
fi

echo "✅ Site found: $SITE_PATH"
echo ""

# 2. Check if plugin is installed
if [ -d "$SITE_PATH/app/public/wp-content/plugins/nexus-ai-connector" ]; then
  echo "✅ Plugin installed"
else
  echo "❌ Plugin NOT installed"
  echo "   Expected: $SITE_PATH/app/public/wp-content/plugins/nexus-ai-connector"
fi
echo ""

# 3. Check MU plugin configuration
MU_PLUGIN="$SITE_PATH/app/public/wp-content/mu-plugins/nexus-ai-connector-config.php"
if [ -f "$MU_PLUGIN" ]; then
  echo "✅ MU plugin configuration exists"
  echo "   Webhook URL:"
  grep "NEXUS_AI_WEBHOOK_URL" "$MU_PLUGIN" || echo "   ❌ Not found"
  echo "   Auth token:"
  grep "NEXUS_AI_AUTH_TOKEN" "$MU_PLUGIN" | head -c 60 || echo "   ❌ Not found"
  echo "..."
else
  echo "❌ MU plugin configuration NOT found"
  echo "   Expected: $MU_PLUGIN"
fi
echo ""

# 4. Check HTTP endpoint
echo "🌐 HTTP Endpoint Check:"
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:13000/health 2>/dev/null)
if [ "$HTTP_RESPONSE" = "200" ]; then
  echo "✅ HTTP server running on port 13000"
else
  echo "❌ HTTP server NOT responding (expected 200, got: $HTTP_RESPONSE)"
fi
echo ""

# 5. Check WordPress debug log
DEBUG_LOG="$SITE_PATH/app/public/wp-content/debug.log"
if [ -f "$DEBUG_LOG" ]; then
  echo "📝 Recent Nexus AI events from debug.log:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  tail -50 "$DEBUG_LOG" | grep -i "nexus ai" || echo "   (No Nexus AI log entries found)"
else
  echo "ℹ️  Debug log not found (WP_DEBUG might be disabled)"
fi
echo ""

# 6. Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next Steps:"
echo "1. If plugin not installed → restart site to trigger auto-install"
echo "2. If MU config missing → check addon is loaded in Local"
echo "3. If HTTP server down → check Local is running with addon"
echo "4. Create a post in WordPress admin and check debug.log again"
echo ""
