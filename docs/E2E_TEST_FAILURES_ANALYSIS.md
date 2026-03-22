# E2E Test Failures - Root Cause Analysis

**Current State:** 320/338 tests passing (94.7%)
**Target:** 338/338 tests passing (100%)
**Failures to Fix:** 18

---

## Failure Categories

### Category 1: AI Setup Infrastructure (3 failures)
**Suite:** `15-setup-ai.e2e.test.ts`

**Failures:**
1. `wp_setup_ai completes on the test site`
2. `AI experiments are enabled on the test site`
3. `wp_setup_ai is idempotent (second run succeeds)`

**Root Cause:**
Fresh WordPress sites don't have AI Experiments plugin or ACF PRO installed. The `wp_setup_ai` MCP tool tries to:
1. Download/install AI Experiments plugin → **Fails** (plugin not in WordPress.org repo)
2. Configure provider plugins → **Skipped** (previous step failed)
3. Set up Ollama provider → **Skipped**
4. Enable AI experiments → **Skipped**
5. Sync credentials → **Skipped**
6. Configure ACF abilities → **Skipped** (ACF PRO not installed)

**Error Message:**
```
Setup for AI partially failed on "nexus-e2e-test":
  AI Plugin: failed
  Provider Plugins: skipped
  Ollama Provider: skipped
  AI Experiments: skipped
  Credentials: skipped
  ACF Abilities: skipped
```

**Why This Happens:**
- AI Experiments plugin is a WP Engine internal plugin (not public)
- ACF PRO requires license key
- Tests assume these are available

---

### Category 2: Event Processing Pipeline (7 failures)

**Suites:**
- `16-event-processing.e2e.test.ts` (1 failure)
- `18-wordpress-events.e2e.test.ts` (3 failures)
- `19-graph-deletion.e2e.test.ts` (3 failures)

**Failures:**
1. `should receive and process post_created event`
2. `should send post_created event when post is created via wp-cli`
3. `should send post_deleted event when post is deleted`
4. `should make new content immediately searchable`
5. `should remove deleted post from graph database`
6. `should remove deleted plugin from graph database`
7. `should reflect deletions in graph statistics`

**Root Cause Chain:**
```
Fresh WordPress site created
    ↓
No webhook endpoint configured (requires AI plugin setup)
    ↓
Posts created via wp-cli don't trigger events
    ↓
Content pipeline doesn't process posts
    ↓
Posts not indexed in vector store
    ↓
Search returns "No results found"
    ↓
Graph database has no content
    ↓
Deletion tests fail (nothing to delete)
```

**Why This Happens:**
- Event processing requires webhook endpoint at `http://127.0.0.1:13001/wp-events`
- Webhook configuration happens during `wp_setup_ai` (Category 1)
- Without webhook, WordPress → Local event flow is broken
- Tests assume events are flowing

**Dependency:**
These tests depend on Category 1 (AI Setup) being fixed first.

---

### Category 3: CLI Test Regressions (8 failures)

**Suite:** `26-cli-commands.e2e.test.ts`

#### Subcategory 3A: WP-CLI on Halted Site (5 failures)

**Failures:**
1. `wp plugin list --json` (exit code 1)
2. `wp plugin list` status icons (exit code 1)
3. `wp core version` (exit code 1)
4. `wp theme list` (exit code 1)
5. `wp option get` (exit code 1)

**Root Cause:**
```
E2E setup creates "nexus-e2e-test" site → starts it
    ↓
Tests run for ~10 minutes
    ↓
Site stops/halts during test run (unknown trigger)
    ↓
CLI tries to run WP commands on halted site
    ↓
MCP tool returns: "Site is halted. Start it first."
    ↓
Test expects exit code 0, gets exit code 1
```

**Why This Happens:**
- Tests don't verify site is still running before executing WP commands
- Long test run (10 minutes) gives time for site to stop
- Could be: timeout, resource limits, or another test stopping it

**Evidence:**
- These exact tests passed in isolation (when site was running)
- getAnySite() returns first site (could be halted by time these tests run)

#### Subcategory 3B: CLI Bootstrap Timeouts (3 failures)

**Failures:**
1. `sync pull --validate WPE target syntax` (timeout after 30s)
2. `sync push --create flag` (timeout after 30s)
3. `error messages should provide helpful error context` (timeout after 30s)

**Root Cause:**
```
CLI test spawns: ./bin/nexus.js sync pull ...
    ↓
CLI bootstrap calls waitForGraphQL()
    ↓
Local's GraphQL server frozen (doesn't respond)
    ↓
Bootstrap times out after 30 seconds
    ↓
Test times out (no response from CLI)
```

**Why This Happens:**
- Same Local GraphQL freeze issue from earlier
- Long test runs trigger the freeze (happens after ~8-10 minutes)
- Pattern: Works fine initially → freezes after sustained load

**Evidence:**
- Earlier in session: CLI tests all passed in isolation
- Later in session: 3 CLI tests timeout
- Local restart fixes it temporarily

---

## Failure Statistics by Root Cause

| Root Cause | Failures | % of Total |
|------------|----------|------------|
| Missing AI plugin/dependencies | 3 | 16.7% |
| Event pipeline not configured | 7 | 38.9% |
| Site state changed during run | 5 | 27.8% |
| Local GraphQL freeze | 3 | 16.7% |
| **TOTAL** | **18** | **100%** |

---

## Dependencies Between Failures

```
Category 1: AI Setup (3 failures)
    ↓
    └─> Category 2: Event Processing (7 failures)
         - Depends on webhooks from AI setup
         - Can't pass until Category 1 fixed

Category 3A: Site State (5 failures)
    - Independent issue

Category 3B: GraphQL Freeze (3 failures)
    - Independent issue
```

**Critical Path:**
Fix Category 1 → Automatically fixes Category 2 (10 failures total)

---

## Test Environment Context

**What We Know:**
- Fresh site created: `nexus-e2e-test` (auto-created by E2E setup)
- Site starts successfully
- All tests begin running
- After ~8-10 minutes of testing:
  - Site may have stopped (halted)
  - Local GraphQL becomes unresponsive

**What We Don't Know:**
- Why site stops during test run
- What triggers Local GraphQL freeze
- Whether these are related

---

## Next Steps

See `E2E_TEST_100_PERCENT_PLAN.md` for detailed fix strategies.
