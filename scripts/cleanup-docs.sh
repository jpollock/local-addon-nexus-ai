#!/bin/bash

# Documentation Cleanup Script
# Deletes 62 sprint/planning/implementation files from docs/
#
# Run this from the repo root:
#   bash scripts/cleanup-docs.sh
#
# Date: 2026-03-25

set -e  # Exit on error

echo "🧹 Nexus AI Documentation Cleanup"
echo "=================================="
echo ""
echo "This will DELETE 62 files from docs/"
echo "  - Sprint plans and task checklists"
echo "  - Implementation notes"
echo "  - CLI planning docs (superseded by docs-site)"
echo "  - E2E test planning docs"
echo "  - Telemetry planning docs"
echo "  - Test result snapshots"
echo "  - Archived content"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled"
    exit 1
fi

echo ""
echo "🗑️  Deleting sprint planning docs..."
rm -f docs/sprint-1-detailed-plan.md
rm -f docs/sprint-1-task-checklist.md
rm -f docs/sprint-1-ui-mockup.md
rm -f docs/sprint-2-detailed-plan.md
rm -f docs/sprint-2-task-checklist.md
rm -f docs/sprint-2-completion.md
rm -f docs/sprint-3-detailed-plan.md
rm -f docs/sprint-3-task-checklist.md
rm -f docs/sprint-4-detailed-plan.md
rm -f docs/sprint-4-task-checklist.md
rm -f docs/sprint-4-completion.md
rm -f docs/SPRINT_1_README.md
rm -f docs/phase1-detailed-plan.md
rm -f docs/phase1-ui-plan.md

echo "🗑️  Deleting implementation notes..."
rm -rf docs/implementation-notes/

echo "🗑️  Deleting CLI planning docs (superseded by docs-site)..."
rm -f docs/CLI_IMPLEMENTATION_PLAN.md
rm -f docs/CLI_POC.md
rm -f docs/CLI_POC_RESULTS.md
rm -f docs/CLI_FEATURE_ROADMAP.md
rm -f docs/CLI_SUMMARY.md
rm -f docs/CLI_MISSING_BEHAVIORS.md
rm -f docs/CLI_BOOTSTRAP_SYSTEM.md
rm -f docs/CLI_IMPLEMENTATION_SUMMARY.md
rm -f docs/CLI_DESIGN_SPEC.md
rm -f docs/CLI_TEST_COVERAGE.md
rm -f docs/CLI_PHASES_3-7_COMPLETE.md
rm -f docs/CLI_MCP_FEATURE_PARITY.md
rm -f docs/CLI_E2E_TEST_FIX.md
rm -f docs/MCP_CLI_AUDIT.md

echo "🗑️  Deleting E2E test planning docs..."
rm -f docs/E2E_TEST_FAILURES_ANALYSIS.md
rm -f docs/E2E_TEST_100_PERCENT_PLAN.md
rm -f docs/E2E_100_PERCENT_IMPLEMENTATION.md
rm -f docs/E2E_FULL_SETUP_PLAN.md
rm -f docs/BROWSER_TESTING_SETUP.md
rm -f docs/BROWSER_TESTING_IMPLEMENTATION.md

echo "🗑️  Deleting telemetry planning docs..."
rm -f docs/CLOUDFLARE_TELEMETRY_PROPOSAL.md
rm -f docs/CLOUDFLARE_TELEMETRY_PHASE1_COMPLETE.md
rm -f docs/CLOUDFLARE_TELEMETRY_PHASE2_COMPLETE.md
rm -f docs/CLOUDFLARE_TELEMETRY_PHASE3_COMPLETE.md

echo "🗑️  Deleting test result snapshots..."
rm -f docs/STRESS_TEST_RESULTS.md
rm -f docs/MEMORY_LEAK_TEST_RESULTS.md
rm -f docs/PRODUCTION_VALIDATION_SUMMARY.md
rm -f docs/PRODUCTION_HARDENING_COMPLETE.md

echo "🗑️  Deleting archived content..."
rm -rf docs/archive/

echo "🗑️  Deleting UI planning docs..."
rm -f docs/UI_MINIMUM_SCOPE.md
rm -f docs/roadmap-short-term.md

echo "🗑️  Deleting WordPress plugin planning docs..."
rm -f docs/wordpress-event-sender-design.md
rm -f docs/wordpress-plugin-implementation-plan.md

echo "🗑️  Deleting duplicate/superseded guides..."
rm -f docs/ai-proxy-guide.md
rm -f docs/security.md
rm -f docs/wp-connector.md

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📊 Remaining docs/ structure:"
find docs -name "*.md" -type f | sort

echo ""
echo "📝 Next steps:"
echo "  1. Review remaining docs/ files"
echo "  2. Create .claude/project/ developer AI context"
echo "  3. Update docs-site/ content"
echo "  4. Create docs-site/docs/ai-context/ user AI context"
