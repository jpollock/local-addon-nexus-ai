# E2E Test 100% - Implementation Plan

**Goal:** Fix all 18 failures to achieve 338/338 tests passing
**Approach:** Full fix with real AI plugin, proper investigation, all tests running

---

## Track A: AI Plugin Installation (Fixes 3 + 7 = 10 failures)

### Current Problem

**File:** `src/main/mcp/modules/wp-connector/setup-ai.ts:191`

```typescript
const result = await localServices.wpCliRun(siteId, ['plugin', 'install', 'ai', '--activate']);
```

This tries to install `ai` plugin from WordPress.org, but:
- AI Experiments is a WP Engine internal plugin
- Not available on WordPress.org
- **We have it bundled in `wp-plugins/ai/`**

### Solution: Copy Bundled Plugin

Use the **same pattern** as Ollama provider (lines 343-377):

```typescript
// Step 2: Handle AI Experiments plugin ("ai")
let aiPlugin: SetupAIResult['aiPlugin'] = 'failed';
const existingAi = findPlugin(plugins, 'ai');

try {
  if (!existingAi) {
    // Not installed — copy from bundled source and activate
    const sitePluginsDir = await getSitePluginsDir(siteId, localServices);
    if (!sitePluginsDir) {
      throw new Error('Could not determine site plugins directory');
    }

    // Security: Validate plugin path
    const site = localServices.resolveSiteObject(siteId) as any;
    validatePluginPath(sitePluginsDir, site.paths.webRoot);

    const pluginDest = path.join(sitePluginsDir, 'ai');
    const pluginSource = path.join(WP_PLUGINS_ROOT, 'ai');

    if (!fs.existsSync(pluginSource)) {
      throw new Error(`AI Experiments plugin source not found at ${pluginSource}`);
    }

    logger.info(`${tag} Copying AI Experiments plugin to site ${siteId}`);
    fs.cpSync(pluginSource, pluginDest, { recursive: true });

    const result = await localServices.wpCliRun(siteId, ['plugin', 'activate', 'ai']);
    if (!result.success) {
      throw new Error(result.stdout ?? 'Failed to activate');
    }

    // Health check: verify the plugin doesn't crash WordPress
    const healthCheck = await localServices.wpCliRun(
      siteId,
      ['eval', "echo 'healthy';"],
      { skipPlugins: false },
    );

    if (!healthCheck.success || healthCheck.stdout?.trim() !== 'healthy') {
      logger.error(`${tag} AI plugin crashes WordPress — deactivating`);
      await localServices.wpCliRun(siteId, ['plugin', 'deactivate', 'ai']);
      throw new Error('AI plugin failed health check');
    }

    aiPlugin = 'installed';
  } else if (existingAi.status !== 'active') {
    // Installed but inactive — activate
    logger.info(`${tag} Activating AI Experiments plugin on site ${siteId}`);
    const result = await localServices.wpCliRun(siteId, ['plugin', 'activate', 'ai']);
    if (!result.success) {
      throw new Error(result.stdout ?? 'Unknown error');
    }
    aiPlugin = 'activated';
  } else {
    // Already active
    aiPlugin = 'already_active';
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`${tag} AI plugin step failed: ${msg}`);
  aiPlugin = 'failed';
}
```

### Changes Required

**File:** `src/main/mcp/modules/wp-connector/setup-ai.ts`

1. Replace lines 186-212 with the solution above
2. No other changes needed - rest of code works once plugin is installed

### Expected Results

**After this fix:**
- ✅ `15-setup-ai.e2e.test.ts` - 3 tests pass (AI plugin installs successfully)
- ✅ `16-event-processing.e2e.test.ts` - 1 test passes (webhooks configured)
- ✅ `18-wordpress-events.e2e.test.ts` - 3 tests pass (events flowing)
- ✅ `19-graph-deletion.e2e.test.ts` - 3 tests pass (content indexed)

**Total: 10 failures → 0 failures**

### Testing

```bash
# Test AI setup
npm run test:e2e -- tests/e2e/15-setup-ai.e2e.test.ts

# Test event processing (depends on AI setup)
npm run test:e2e -- tests/e2e/16-event-processing.e2e.test.ts
npm run test:e2e -- tests/e2e/18-wordpress-events.e2e.test.ts
npm run test:e2e -- tests/e2e/19-graph-deletion.e2e.test.ts
```

### Estimated Effort
**30-45 minutes**

---

## Track B: Event Processing

**Status:** Automatically fixed by Track A

No additional work required. Once AI plugin is installed:
1. Webhook endpoint gets registered
2. WordPress sends events to Local
3. Content pipeline processes events
4. Posts get indexed
5. All event/graph tests pass

---

## Track C: Site Halting Investigation

### Mystery to Solve

**Observation:** Site `nexus-e2e-test` starts running, then stops/halts after ~8-10 minutes of testing.

### Investigation Plan

#### Step 1: Add Site State Logging (15 minutes)

Create a test helper that monitors site state:

**File:** `tests/e2e/helpers/site-monitor.ts`

```typescript
import { getClient } from './environment';

export interface SiteStateLog {
  timestamp: number;
  siteName: string;
  state: 'running' | 'halted' | 'unknown';
  test: string;
}

const stateLog: SiteStateLog[] = [];

export function logSiteState(siteName: string, test: string) {
  const client = getClient();

  client.callTool('local_get_site', { site: siteName })
    .then((result) => {
      const state = result.content[0]?.text?.includes('running') ? 'running' : 'halted';
      stateLog.push({
        timestamp: Date.now(),
        siteName,
        state,
        test,
      });
    })
    .catch(() => {
      stateLog.push({
        timestamp: Date.now(),
        siteName,
        state: 'unknown',
        test,
      });
    });
}

export function getSiteStateLog(): SiteStateLog[] {
  return stateLog;
}

export function printSiteStateReport() {
  console.log('\n=== Site State Report ===');
  console.log(`Total checks: ${stateLog.length}`);

  const stateChanges = [];
  for (let i = 1; i < stateLog.length; i++) {
    if (stateLog[i].state !== stateLog[i-1].state) {
      stateChanges.push({
        from: stateLog[i-1],
        to: stateLog[i],
        elapsed: (stateLog[i].timestamp - stateLog[0].timestamp) / 1000,
      });
    }
  }

  if (stateChanges.length > 0) {
    console.log('\nState changes detected:');
    stateChanges.forEach((change, i) => {
      console.log(`  ${i+1}. At ${change.elapsed}s: ${change.from.state} → ${change.to.state}`);
      console.log(`     Test: ${change.to.test}`);
    });
  } else {
    console.log('\nNo state changes detected.');
  }

  console.log('========================\n');
}
```

#### Step 2: Add Monitoring to Tests (15 minutes)

**File:** `tests/e2e/26-cli-commands.e2e.test.ts`

```typescript
import { logSiteState, printSiteStateReport } from './helpers/site-monitor';

describe('CLI Commands - WordPress', () => {
  let siteName: string;

  beforeAll(() => {
    const env = deserializeEnvironment();
    siteName = env.testSiteName || getAnySite().name;
  });

  beforeEach(function() {
    // Log site state before each test
    logSiteState(siteName, this.currentTest?.title || 'unknown');
  });

  afterAll(() => {
    // Print report at end
    printSiteStateReport();
  });

  // ... existing tests
});
```

#### Step 3: Run Tests and Analyze (30 minutes)

```bash
npm run test:e2e -- tests/e2e/26-cli-commands.e2e.test.ts 2>&1 | tee /tmp/site-state-debug.txt
```

**Look for:**
- When does state change from running → halted?
- Which test was running when it happened?
- Is it consistent (same test each time)?
- How long into the test run does it happen?

#### Step 4: Check Local Logs

```bash
tail -f /tmp/local.log | grep -E "nexus-e2e-test|stop|halt|mysql"
```

**While tests run, watch for:**
- Site stop commands
- MySQL errors
- Resource limit messages
- Auto-stop triggers

#### Step 5: Hypothesis Testing (30 minutes)

Based on findings, test hypotheses:

**Hypothesis 1: Timeout/Idle**
- Local auto-stops sites after X minutes idle
- Test: Keep site active with periodic health checks

**Hypothesis 2: Resource Limits**
- Site hits memory/CPU limit
- Test: Monitor resource usage during tests

**Hypothesis 3: Test Side Effect**
- Specific test stops the site
- Test: Run tests in isolation to find culprit

**Hypothesis 4: MySQL Crash**
- MySQL crashes, triggers site halt
- Test: Check MySQL logs in site directory

### Solution Options (Based on Investigation)

#### Option C1: Keepalive (If Auto-Timeout)

**File:** `tests/e2e/helpers/keepalive.ts`

```typescript
export function startSiteKeepalive(siteName: string): () => void {
  const client = getClient();
  const interval = setInterval(async () => {
    try {
      // Periodic health check keeps site "active"
      await client.callTool('wp_core_version', { site: siteName });
    } catch {
      // Site may have stopped - try to restart
      console.log(`[Keepalive] Site ${siteName} unresponsive, restarting...`);
      try {
        await client.callTool('local_start_site', { site: siteName });
      } catch {
        console.error(`[Keepalive] Failed to restart ${siteName}`);
      }
    }
  }, 30000); // Every 30 seconds

  return () => clearInterval(interval);
}
```

**Use in setup:**

```typescript
// tests/e2e/setup.ts
import { startSiteKeepalive } from './helpers/keepalive';

module.exports = async function globalSetup() {
  // ... existing setup

  if (env.testSiteName) {
    const stopKeepalive = startSiteKeepalive(env.testSiteName);

    // Store cleanup function
    (global as any).__SITE_KEEPALIVE__ = stopKeepalive;
  }
};

// tests/e2e/teardown.ts
module.exports = async function globalTeardown() {
  // Stop keepalive
  const stopKeepalive = (global as any).__SITE_KEEPALIVE__;
  if (stopKeepalive) {
    stopKeepalive();
  }

  // ... existing teardown
};
```

#### Option C2: Verify Before Each Test (If Inconsistent)

```typescript
beforeEach(async () => {
  const env = deserializeEnvironment();

  // Ensure site is running
  if (env.runningSites.length === 0) {
    const testSite = env.testSiteName;
    if (testSite) {
      const client = getClient();
      await client.callTool('local_start_site', { site: testSite });

      // Wait for it to start
      await waitFor(async () => {
        const result = await client.callTool('local_get_site', { site: testSite });
        return result.content[0].text.includes('running');
      }, 30000);
    }
  }
});
```

#### Option C3: Fix Root Cause (If Specific Test)

If investigation reveals a specific test stops the site:
- Fix that test
- Or isolate it with site restart after

### Expected Results

**After investigation + fix:**
- ✅ Site stays running throughout test suite
- ✅ 5 CLI WP-CLI tests pass (site is running)

**Total: 5 failures → 0 failures**

### Estimated Effort
**1.5-2 hours** (investigation + fix)

---

## Track D: Local GraphQL Stability

### Mystery to Solve

**Observation:** After ~8-10 minutes of testing, Local's GraphQL server stops responding. CLI bootstrap times out.

### Investigation Plan

#### Step 1: Add GraphQL Query Logging (15 minutes)

**File:** `tests/e2e/helpers/graphql-monitor.ts`

```typescript
import { getClient } from './environment';

const originalCall = getClient().callTool;
const queryLog: Array<{timestamp: number, tool: string, duration: number}> = [];

export function enableGraphQLMonitoring() {
  const client = getClient();

  client.callTool = async function(tool: string, params?: any) {
    const start = Date.now();

    try {
      const result = await originalCall.call(this, tool, params);
      const duration = Date.now() - start;

      queryLog.push({ timestamp: start, tool, duration });

      if (duration > 5000) {
        console.warn(`[GraphQL] Slow query: ${tool} took ${duration}ms`);
      }

      return result;
    } catch (err) {
      const duration = Date.now() - start;
      queryLog.push({ timestamp: start, tool, duration });
      throw err;
    }
  };
}

export function getLastQueries(n = 20) {
  return queryLog.slice(-n);
}

export function printGraphQLReport() {
  console.log('\n=== GraphQL Query Report ===');
  console.log(`Total queries: ${queryLog.length}`);

  const slowQueries = queryLog.filter(q => q.duration > 1000);
  if (slowQueries.length > 0) {
    console.log(`\nSlow queries (>1s): ${slowQueries.length}`);
    slowQueries.forEach(q => {
      console.log(`  ${q.tool}: ${q.duration}ms`);
    });
  }

  console.log('\nLast 10 queries:');
  getLastQueries(10).forEach((q, i) => {
    console.log(`  ${i+1}. ${q.tool} (${q.duration}ms)`);
  });

  console.log('============================\n');
}
```

#### Step 2: Monitor During Tests

```typescript
// tests/e2e/setup.ts
import { enableGraphQLMonitoring } from './helpers/graphql-monitor';

module.exports = async function globalSetup() {
  enableGraphQLMonitoring();
  // ... rest of setup
};

// tests/e2e/teardown.ts
import { printGraphQLReport } from './helpers/graphql-monitor';

module.exports = async function globalTeardown() {
  printGraphQLReport();
  // ... rest of teardown
};
```

#### Step 3: Run and Analyze

```bash
npm run test:e2e 2>&1 | tee /tmp/graphql-debug.txt
```

**Look for:**
- Which was the last successful query before freeze?
- Were there any slow queries leading up to freeze?
- Any patterns in tools called?

#### Step 4: Check Local's GraphQL Server

**Monitor Local process:**

```bash
# In separate terminal while tests run
lsof -p $(pgrep -f "Local.app" | head -1) | grep -E "TCP|LISTEN"
```

**Check for:**
- Port 4000 still listening?
- Any stuck connections?
- Resource usage (CPU/memory)?

### Solution: Resilient CLI Bootstrap

**File:** `src/cli/bootstrap/index.ts`

```typescript
export async function bootstrap(options = {}) {
  const actions: string[] = [];
  const log = (msg: string) => {
    actions.push(msg);
    if (options.verbose) console.log(msg);
    if (options.onStatus) options.onStatus(msg);
  };

  // ... existing checks (Local installed, addon installed)

  // Check if Local is running
  const running = await isLocalRunning();

  if (needsRestart && running) {
    log('Restarting Local to activate addon...');
    await restartLocal();
  } else if (!running) {
    log('Starting Local...');
    await startLocal();
  }

  // Wait for GraphQL with retry and auto-recovery
  log('Waiting for GraphQL...');

  let attempts = 0;
  const maxAttempts = 3;
  let ready = false;

  while (attempts < maxAttempts && !ready) {
    attempts++;

    if (attempts > 1) {
      log(`Retrying GraphQL connection (attempt ${attempts}/${maxAttempts})...`);
    }

    ready = await waitForGraphQL(10000); // 10s per attempt

    if (!ready && attempts < maxAttempts) {
      // Wait before retry
      await delay(2000);
    }
  }

  if (!ready) {
    // Last resort: try to restart Local
    if (options.autoRestart !== false) {
      log('GraphQL unresponsive, attempting to restart Local...');

      try {
        await restartLocal();
        await delay(5000); // Give Local time to start

        ready = await waitForGraphQL(15000);

        if (ready) {
          log('GraphQL recovered after restart.');
        }
      } catch (err) {
        log(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!ready) {
      return {
        success: false,
        error: 'GraphQL server not responding. Local may need manual restart.',
        actions,
      };
    }
  }

  log('GraphQL server ready.');

  // ... rest of bootstrap
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Expected Results

**After this fix:**
- ✅ CLI commands don't timeout even if GraphQL is slow
- ✅ Auto-recovery from temporary GraphQL issues
- ✅ Better error messages when GraphQL truly down

**If GraphQL freeze still happens:**
- Tests fail with better error
- User gets clear message to restart Local
- Investigation data helps report issue to Local team

**Total: 3 failures → 0 failures (or clearer failures)**

### Estimated Effort
**1.5-2 hours** (investigation + fix)

---

## Implementation Order

### Phase 1: Quick Win - AI Plugin (45 min)
1. Fix AI plugin installation in `setup-ai.ts`
2. Test: `npm run test:e2e -- tests/e2e/15-setup-ai.e2e.test.ts`
3. Expected: 3 failures → 0 failures

**Checkpoint: 10 failures fixed (AI setup + event processing)**

### Phase 2: Site Halting Investigation (2 hours)
1. Add site state monitoring
2. Run tests with logging
3. Analyze findings
4. Implement appropriate fix (keepalive or verify-before-test)
5. Test: `npm run test:e2e -- tests/e2e/26-cli-commands.e2e.test.ts`
6. Expected: 5 failures → 0 failures

**Checkpoint: 15 failures fixed**

### Phase 3: GraphQL Stability (2 hours)
1. Add GraphQL query monitoring
2. Run full suite with logging
3. Analyze what triggers freeze
4. Implement resilient bootstrap
5. Test: Full E2E suite
6. Expected: 3 failures → 0 failures

**Checkpoint: All 18 failures fixed**

### Phase 4: Validation (30 min)
1. Run full E2E suite 3 times
2. Verify 338/338 passing consistently
3. Check logs for any warnings
4. Document any conditional skips (e.g., Ollama)

---

## Total Effort Estimate

- **Track A (AI Plugin):** 45 minutes
- **Track B (Event Processing):** 0 minutes (automatic)
- **Track C (Site Halting):** 2 hours
- **Track D (GraphQL Stability):** 2 hours
- **Validation:** 30 minutes

**Total: ~5.5 hours**

---

## Success Criteria

1. ✅ All 338 tests pass
2. ✅ Tests can run back-to-back without failures
3. ✅ Clear logging shows why any skips occur
4. ✅ Investigation findings documented
5. ✅ Solutions are robust, not workarounds

---

## Commit Strategy

**Commit 1:** Fix AI plugin installation
```
fix(setup-ai): use bundled AI Experiments plugin instead of WordPress.org

The AI Experiments plugin is WP Engine internal and not available on
WordPress.org. Copy from bundled wp-plugins/ai/ directory like we do
for Ollama provider plugin.

Fixes 10 E2E test failures (AI setup + event processing).
```

**Commit 2:** Add site state monitoring and fix halting
```
fix(e2e): prevent test site from halting during long test runs

Investigation showed [finding]. Added [solution: keepalive/verify/etc]
to ensure site stays running throughout test suite.

Fixes 5 E2E test failures (WP-CLI commands on halted site).
```

**Commit 3:** Make CLI bootstrap more resilient
```
fix(cli): make GraphQL bootstrap resilient to temporary unavailability

GraphQL server can become unresponsive during long test runs or under
load. Add retry logic and auto-recovery to handle transient issues.

Investigation findings documented in [file].

Fixes 3 E2E test failures (CLI timeouts).
```

**Commit 4:** Update documentation
```
docs: document E2E test 100% achievement and investigation findings
```

---

## Ready to Start?

Let me know and I'll begin with Phase 1 (AI Plugin fix) - the quick win that fixes 10 failures!
