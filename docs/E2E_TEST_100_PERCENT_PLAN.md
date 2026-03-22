# E2E Test 100% Pass Rate - Detailed Plan

**Goal:** Fix 18 failing tests to achieve 338/338 passing (100%)
**Current:** 320/338 passing (94.7%)

---

## Strategy Overview

We have **4 independent fix tracks**:

1. **Track A:** AI Setup Infrastructure (fixes 3 failures)
2. **Track B:** Event Processing Pipeline (fixes 7 failures) - *Depends on Track A*
3. **Track C:** Site State Management (fixes 5 failures)
4. **Track D:** Local GraphQL Stability (fixes 3 failures)

**Estimated Total Effort:** 4-6 hours
**Recommended Order:** A → B (automatic) → C → D

---

## Track A: AI Setup Infrastructure
**Failures Fixed:** 3
**Effort:** 2-3 hours
**Priority:** HIGH (blocks Track B)

### Problem
Fresh WordPress sites don't have:
- AI Experiments plugin (WP Engine internal, not in WordPress.org)
- ACF PRO (requires license)
- Provider plugins configured

Tests expect `wp_setup_ai` to fully succeed, but it fails on fresh sites.

### Approach Options

#### Option A1: Mock AI Plugin Installation (RECOMMENDED)
**Effort:** 1-2 hours
**Pros:** Tests validate tool behavior, not external dependencies
**Cons:** Doesn't test real AI plugin installation

**Implementation:**
1. Create mock AI plugin in `tests/fixtures/ai-experiments-mock/`
2. Modify `wp_setup_ai` to accept `mock: true` parameter for tests
3. Mock plugin:
   - Registers `ai_experiments_enabled` option
   - Provides minimal webhook registration
   - Skips ACF PRO requirements

```typescript
// tests/e2e/15-setup-ai.e2e.test.ts
it('wp_setup_ai completes on the test site', async () => {
  const result = await client.callTool('wp_setup_ai', {
    site: testSite.name,
    mock: true  // Use test fixtures
  });
  expectSuccess(result);
});
```

#### Option A2: Skip AI Setup Tests When Dependencies Missing
**Effort:** 30 minutes
**Pros:** Quick, no code changes to product
**Cons:** Loses test coverage for AI setup

**Implementation:**
```typescript
beforeAll(async () => {
  // Check if AI plugin available
  const hasAiPlugin = await checkAiPluginAvailable();
  if (!hasAiPlugin) {
    console.warn('[SKIP] AI Experiments plugin not available');
  }
});

it('wp_setup_ai completes', async () => {
  if (!hasAiPlugin) return; // Skip
  // ... test
});
```

#### Option A3: Pre-install AI Plugin in Test Fixtures
**Effort:** 2-3 hours
**Pros:** Tests real plugin, full coverage
**Cons:** Requires bundling internal plugin, license management

**Implementation:**
1. Bundle AI Experiments plugin in `tests/fixtures/plugins/`
2. Bundle ACF PRO (requires license handling)
3. Pre-install via `wp plugin install <path>`
4. Configure during E2E setup

#### Option A4: Make wp_setup_ai More Resilient
**Effort:** 1 hour
**Pros:** Product improvement, better error handling
**Cons:** Still requires mocking or skipping for tests

**Implementation:**
```typescript
// src/main/helpers/setup-ai.ts
export async function setupSiteForAI(site: Site, options: SetupOptions = {}) {
  const results = {
    aiPlugin: 'pending',
    webhook: 'pending',
    // ...
  };

  // Try to install AI plugin
  try {
    await installAiPlugin(site);
    results.aiPlugin = 'success';
  } catch (err) {
    if (options.allowPartialSetup) {
      results.aiPlugin = 'skipped';
      console.warn('AI plugin unavailable, continuing with partial setup');
    } else {
      throw err;
    }
  }

  // Continue with what we can do...
  return results;
}
```

**Recommendation:** **Option A1** (Mock) + **Option A4** (Resilient)
- Mock for tests (fast, reliable)
- Resilient code for production (better UX)
- Combined effort: 2-3 hours

---

## Track B: Event Processing Pipeline
**Failures Fixed:** 7 (automatically after Track A)
**Effort:** 0 hours (dependent on Track A)
**Priority:** MEDIUM (blocked by Track A)

### Problem
Posts created via wp-cli don't trigger events because:
1. No webhook endpoint configured (needs AI plugin)
2. No event listener registered in WordPress

### Solution
**Automatic fix** - Once Track A completes:
1. AI plugin mock registers webhook endpoint
2. WordPress sends events to Local
3. Content pipeline processes events
4. Posts get indexed
5. Search works
6. Graph deletion tests find content to delete

**No additional work required** if Track A uses Option A1 (mock).

**Validation:**
After Track A is fixed, run:
```bash
npm run test:e2e -- tests/e2e/16-event-processing.e2e.test.ts
npm run test:e2e -- tests/e2e/18-wordpress-events.e2e.test.ts
npm run test:e2e -- tests/e2e/19-graph-deletion.e2e.test.ts
```

Should all pass automatically.

---

## Track C: Site State Management
**Failures Fixed:** 5
**Effort:** 1 hour
**Priority:** HIGH (independent of other tracks)

### Problem
WP-CLI tests fail because site becomes halted during the long test run.

### Root Cause Analysis
```
Test suite starts at T=0
    ↓
Site "nexus-e2e-test" created and started
    ↓
Tests run for ~10 minutes
    ↓
At T=~8min: Site stops (reason unknown)
    ↓
CLI WP tests run at T=~9min
    ↓
getAnySite() returns halted site
    ↓
WP-CLI fails: "Site is halted"
```

### Approach Options

#### Option C1: Verify Site Running Before Each WP Test (RECOMMENDED)
**Effort:** 30 minutes
**Pros:** Robust, handles any site state changes
**Cons:** Adds slight overhead

**Implementation:**
```typescript
// tests/e2e/26-cli-commands.e2e.test.ts

describe('CLI Commands - WordPress', () => {
  let siteName: string;

  beforeEach(async () => {
    // Ensure we have a running site before each test
    const env = deserializeEnvironment();

    if (env.runningSites.length === 0) {
      // No running sites - try to start the test site
      const testSite = env.testSiteName;
      if (testSite) {
        console.log(`[CLI Tests] Starting test site: ${testSite}`);
        const client = getClient();
        await client.callTool('local_start_site', { site: testSite });
        await waitFor(async () => {
          const sites = await client.callTool('local_list_sites');
          return sites.content[0].text.includes('### Running');
        }, 30000);

        // Update environment
        const newEnv = await discoverEnvironment();
        serializeEnvironment(newEnv);
      }
    }

    siteName = getAnySite().name;
  });

  // ... tests
});
```

#### Option C2: Pin to Fresh Test Site
**Effort:** 15 minutes
**Pros:** Simple, uses known-good site
**Cons:** Assumes test site stays running

**Implementation:**
```typescript
describe('CLI Commands - WordPress', () => {
  let siteName: string;

  beforeAll(() => {
    const env = deserializeEnvironment();
    // Always use the test site (freshly created)
    siteName = env.testSiteName || getAnySite().name;
  });
});
```

#### Option C3: Keep Site Running Throughout Tests
**Effort:** 1 hour
**Pros:** Prevents site from stopping
**Cons:** Doesn't address why it stops

**Implementation:**
```typescript
// tests/e2e/helpers/keep-alive.ts
export function startSiteKeepalive(siteName: string) {
  const interval = setInterval(async () => {
    const client = getClient();
    const result = await client.callTool('local_get_site', { site: siteName });

    if (result.content[0].text.includes('halted')) {
      console.log('[Keepalive] Site halted, restarting...');
      await client.callTool('local_start_site', { site: siteName });
    }
  }, 60000); // Check every minute

  return () => clearInterval(interval);
}

// tests/e2e/setup.ts
let stopKeepalive: (() => void) | null = null;

module.exports = async function globalSetup() {
  // ... existing setup

  if (env.testSiteName) {
    stopKeepalive = startSiteKeepalive(env.testSiteName);
    process.env.NEXUS_E2E_KEEPALIVE = 'true';
  }
};

// tests/e2e/teardown.ts
if (process.env.NEXUS_E2E_KEEPALIVE && stopKeepalive) {
  stopKeepalive();
}
```

#### Option C4: Investigate Why Site Stops
**Effort:** 2-3 hours
**Pros:** Fixes root cause
**Cons:** May be Local issue, not our code

**Investigation Steps:**
1. Add logging to track site state changes
2. Check Local logs for stop triggers
3. Monitor resource usage during tests
4. Check if specific tests stop the site

**Recommendation:** **Option C1** (Verify Before Each Test)
- Most robust
- Handles all edge cases
- Low effort, high reliability

---

## Track D: Local GraphQL Stability
**Failures Fixed:** 3
**Effort:** 1-2 hours
**Priority:** MEDIUM (workaround available)

### Problem
After ~8-10 minutes of testing, Local's GraphQL server stops responding. CLI bootstrap times out waiting for GraphQL.

### Root Cause Hypothesis
```
Long test run (10 minutes)
    ↓
Many GraphQL queries (hundreds)
    ↓
Some operation deadlocks Local's GraphQL server
    ↓
Server listening but not responding
    ↓
CLI bootstrap waits for response
    ↓
Timeout after 30 seconds
```

### Approach Options

#### Option D1: Reduce CLI Bootstrap Timeout (QUICK FIX)
**Effort:** 5 minutes
**Pros:** Tests fail faster, more obvious
**Cons:** Doesn't fix root cause

**Implementation:**
```typescript
// src/cli/bootstrap/graphql.ts
export async function waitForGraphQL(
  timeoutMs: number = 10000,  // Reduced from 30000
  pollIntervalMs: number = 500
): Promise<boolean>
```

Tests fail at 10s instead of 30s, but still fail.

#### Option D2: Restart Local Between Test Suites (WORKAROUND)
**Effort:** 1 hour
**Pros:** Prevents freeze, keeps tests passing
**Cons:** Slower test runs, doesn't fix root cause

**Implementation:**
```typescript
// tests/e2e/jest.e2e.config.js
module.exports = {
  // ... existing config
  maxWorkers: 1,  // Run sequentially
  testTimeout: 120000,

  // Restart Local every N test suites
  globalSetup: './tests/e2e/setup-with-restart.ts',
};

// tests/e2e/setup-with-restart.ts
let testsRun = 0;
const RESTART_INTERVAL = 5; // Restart every 5 suites

export function shouldRestartLocal(): boolean {
  testsRun++;
  return testsRun % RESTART_INTERVAL === 0;
}
```

#### Option D3: Identify and Fix Deadlock Trigger (ROOT CAUSE)
**Effort:** 3-4 hours
**Pros:** Permanent fix
**Cons:** May be Local bug, not fixable by us

**Investigation:**
1. Add GraphQL query logging to identify last successful query
2. Monitor Local's GraphQL server internals
3. Check if specific mutation causes freeze
4. Bisect test suite to find triggering test

**Suspect Operations:**
- `local_start_site` (seen to cause freezes with broken MySQL)
- Concurrent GraphQL mutations
- Large result sets

#### Option D4: Make CLI Bootstrap More Resilient (BEST)
**Effort:** 1 hour
**Pros:** Tests continue even with slow GraphQL
**Cons:** Masks the freeze issue

**Implementation:**
```typescript
// src/cli/bootstrap/index.ts
export async function bootstrap(options = {}) {
  // ... existing code

  // Try multiple connection attempts with backoff
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;

    log(`Waiting for GraphQL (attempt ${attempts}/${maxAttempts})...`);
    const ready = await waitForGraphQL(10000); // 10s per attempt

    if (ready) {
      break;
    }

    if (attempts < maxAttempts) {
      log('GraphQL not ready, retrying...');
      await delay(2000);
    }
  }

  if (!ready) {
    // Try to restart Local as last resort
    if (options.autoRestart !== false) {
      log('GraphQL unresponsive, restarting Local...');
      await restartLocal();
      await delay(5000);

      const finalAttempt = await waitForGraphQL(15000);
      if (!finalAttempt) {
        return {
          success: false,
          error: 'GraphQL server unresponsive even after restart',
          actions,
        };
      }
    }
  }

  // ... rest of bootstrap
}
```

**Recommendation:** **Option D4** (Resilient Bootstrap)
- Makes CLI more robust
- Auto-recovers from GraphQL issues
- Better user experience in production

---

## Implementation Plan

### Phase 1: Quick Wins (1-2 hours)
**Goal:** Fix 8 independent failures

1. **Track C** (Site State) - 30 min
   - Implement Option C1 (verify site running before tests)
   - Run: `npm run test:e2e -- tests/e2e/26-cli-commands.e2e.test.ts`
   - Expected: 5 failures → 0 failures

2. **Track D** (GraphQL Stability) - 1 hour
   - Implement Option D4 (resilient bootstrap)
   - Run: `npm run test:e2e -- tests/e2e/26-cli-commands.e2e.test.ts`
   - Expected: 3 failures → 0 failures

**Checkpoint:** 8 failures fixed, 10 remaining

### Phase 2: AI Infrastructure (2-3 hours)
**Goal:** Fix AI setup and enable event processing

3. **Track A** (AI Setup) - 2-3 hours
   - Implement Option A1 (mock AI plugin) + A4 (resilient setup)
   - Create `tests/fixtures/ai-experiments-mock/`
   - Modify `wp_setup_ai` to accept mock mode
   - Run: `npm run test:e2e -- tests/e2e/15-setup-ai.e2e.test.ts`
   - Expected: 3 failures → 0 failures

4. **Track B** (Event Processing) - 0 hours
   - Automatic fix from Track A
   - Run: `npm run test:e2e -- tests/e2e/16-event-processing.e2e.test.ts tests/e2e/18-wordpress-events.e2e.test.ts tests/e2e/19-graph-deletion.e2e.test.ts`
   - Expected: 7 failures → 0 failures

**Checkpoint:** All 18 failures fixed

### Phase 3: Validation (30 min)
**Goal:** Verify 100% pass rate

5. **Full E2E Suite**
   - Run: `npm run test:e2e`
   - Expected: 338/338 passing (100%)

6. **Repeat to Verify Stability**
   - Run again to ensure no flakes
   - Expected: 338/338 passing (100%)

**Total Effort:** 4-6 hours

---

## Risk Assessment

| Track | Risk | Mitigation |
|-------|------|------------|
| A - AI Setup | Mock doesn't match real plugin behavior | Keep mock minimal, focus on webhook registration |
| B - Event Processing | Tests pass with mock, fail with real plugin | Document real plugin requirements separately |
| C - Site State | Site still stops for unknown reason | Keepalive as backup (Option C3) |
| D - GraphQL Freeze | Root cause in Local, not fixable | Resilient bootstrap handles it gracefully |

---

## Alternative: "Fast Track" Approach

If we want to get to 100% **quickly** (< 2 hours):

1. **Skip AI Setup Tests** (Option A2) - 15 min
2. **Skip Event Processing Tests** (conditional skip) - 15 min
3. **Fix Site State** (Option C1) - 30 min
4. **Fix GraphQL Stability** (Option D4) - 1 hour

**Result:** 338/338 tests (some skipped, but 100% of run tests passing)

**Trade-off:** Lose coverage for AI setup and event processing

---

## Recommended Approach

**Full Fix (Preferred):**
- Phase 1 → Phase 2 → Phase 3
- All 338 tests run and pass
- Full coverage maintained
- 4-6 hours total effort

**Fast Track (If time-constrained):**
- Skip AI/events, fix site state and stability
- 100% pass rate for run tests
- < 2 hours effort
- Lower coverage

---

## Discussion Points

1. **AI Plugin Mocking:** Are you comfortable with mocking the AI plugin for tests, or do you want to test against the real plugin?

2. **Site State Mystery:** Should we investigate why the site stops, or is the robust recovery approach (Option C1) sufficient?

3. **Local GraphQL Freeze:** Should we report this to Local team, or just work around it with resilient bootstrap?

4. **Test Coverage:** Is 100% of tests passing more important than 100% of tests running? (i.e., is strategic skipping acceptable?)

5. **Time Budget:** What's the time budget for getting to 100%? This determines whether we do full fix or fast track.

---

## Next Steps

Please review and let me know:
1. Which approach you prefer (Full Fix vs Fast Track)
2. Your thoughts on the AI plugin mocking strategy
3. Any concerns or alternative ideas
4. Whether you want to discuss any specific track in detail

I'm ready to implement once we align on the approach.
