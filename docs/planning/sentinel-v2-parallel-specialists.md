# Sentinel v2 — Parallel Specialist Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the security sentinel's Tier 2 investigation to fan out to five parallel specialist AI calls (Enumerator, Integrity, Pattern, Database, Behavioral) and synthesize their results with explicit temporal cluster detection and blind-spot disclosure.

**Architecture:** The sentinel `run()` function remains user-facing and unchanged at the top level. Inside `tier2Investigate`, after pulling the sandbox, five `ai.generateObject()` calls fire in `Promise.all` — each with `noTools: true` so they reason over data passed in the prompt, not by calling tools themselves. A sixth synthesis call receives all five structured results plus the filesystem data already collected, produces the final `RemediationPlan`, and explicitly enumerates what was not checked. The SDK gains a one-line `noTools` option to support this.

**Tech Stack:** CommonJS JavaScript (agent.js), `ai.generateObject()` (Task 3 from SDK v1), JSON Schema objects, TypeScript for the SDK change.

## Global Constraints

- `agent.js` stays CommonJS JavaScript — no TypeScript, no ESM
- All existing Tier 1 signals (ABS-01 through ABS-06, EXP-01/03, REL-01/03, LLM-USER-01) are preserved unchanged
- `tier2Investigate` still creates the sandbox and pulls from WPE first — the specialist calls run after the sandbox is ready
- The `RemediationPlan` type from SDK v1 is the output contract — this plan does not change it
- No new npm packages
- Existing tests must still pass: `npm test -- --no-coverage 2>&1 | tail -5`
- `npm run compile` must exit clean after every task

---

## File Map

**Modified:**
- `src/main/agent-runtime/AgentAIClient.ts` — add `noTools?: boolean` option to `generateObject`
- `src/main/agent-sdk/types.ts` — add `noTools?: boolean` to `AIClient.generateObject` signature
- `agents/security-sentinel/agent.js` — replace `llmSynthesis` with parallel specialist calls; add temporal cluster detection; add database scan; add behavioral scan; add explicit blind spots

**New:**
- `agents/security-sentinel/specialists/enumerator.js` — prompt + schema for filesystem enumeration
- `agents/security-sentinel/specialists/integrity.js` — prompt + schema for WP/plugin checksum verification
- `agents/security-sentinel/specialists/pattern.js` — prompt + schema for malicious code pattern analysis
- `agents/security-sentinel/specialists/database.js` — prompt + schema for DB content injection scan
- `agents/security-sentinel/specialists/behavioral.js` — prompt + schema for external HTTP behavioral test
- `agents/security-sentinel/specialists/synthesizer.js` — prompt + schema for cross-specialist correlation

**New test:**
- `tests/unit/agents/security-sentinel/specialists.test.js` — schema validation tests for each specialist output

---

## Task 1: SDK — `noTools` option on `generateObject`

**Files:**
- Modify: `src/main/agent-sdk/types.ts` (AIClient interface)
- Modify: `src/main/agent-runtime/AgentAIClient.ts` (implementation)
- Test: `tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts` (add one test)

**Interfaces:**
- Produces: `ai.generateObject({ prompt, schema, noTools: true })` injects only `__output__` tool, not the full tool list. Consumed by Task 4.

- [ ] **Step 1: Add `noTools` to the `AIClient` interface in `types.ts`**

Find the `generateObject` signature and add the option:

```typescript
generateObject<T>(opts: {
  prompt: string;
  system?: string;
  schema: Record<string, unknown>;
  schemaName?: string;
  noTools?: boolean;   // ← add this
}): Promise<T>;
```

- [ ] **Step 2: Implement in `AgentAIClient.ts`**

Find the line `const tools = [outputTool, ...this.toolProvider.getProviderToolDefinitions()];` and update it:

```typescript
const tools = opts.noTools
  ? [outputTool]
  : [outputTool, ...this.toolProvider.getProviderToolDefinitions()];
```

- [ ] **Step 3: Add a test**

In `tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts`, add:

```typescript
it('noTools: true only injects __output__ tool', async () => {
  const capturedTools: any[] = [];
  const mockProvider = {
    streamChat: jest.fn().mockImplementation(async function*(messages, tools) {
      capturedTools.push(...tools);
      yield { type: 'tool_call_end', name: '__output__', id: 'c1', arguments: { verdict: 'clean' } };
    }),
  } as any;
  const mockToolProvider = {
    getProviderToolDefinitions: jest.fn().mockReturnValue([{ name: 'fleet_sql', parameters: {} }]),
    invoke: jest.fn(),
  } as any;
  const client = new AgentAIClient(mockProvider, { model: 'claude-sonnet-5', apiKey: 'test' } as any, mockToolProvider);
  await client.generateObject({ prompt: 'test', schema: { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] }, noTools: true });
  expect(capturedTools.map(t => t.name)).toEqual(['__output__']);
  expect(mockToolProvider.getProviderToolDefinitions).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern=generateObject --no-coverage 2>&1 | tail -5
npm run compile 2>&1 | head -5
```

Expected: all tests pass, compile clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-sdk/types.ts src/main/agent-runtime/AgentAIClient.ts \
        tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts
git commit -m "feat(sdk): add noTools option to generateObject — specialist calls get only __output__ tool"
```

---

## Task 2: Specialist schemas and prompts

**Files:**
- Create: `agents/security-sentinel/specialists/enumerator.js`
- Create: `agents/security-sentinel/specialists/integrity.js`
- Create: `agents/security-sentinel/specialists/pattern.js`
- Create: `agents/security-sentinel/specialists/database.js`
- Create: `agents/security-sentinel/specialists/behavioral.js`
- Create: `agents/security-sentinel/specialists/synthesizer.js`
- Test: `tests/unit/agents/security-sentinel/specialists.test.js`

**Interfaces:**
- Each file exports `{ schema, buildPrompt(data) }`.
- `schema` — JSON Schema object the model must conform to.
- `buildPrompt(data)` — function that takes collected site data and returns the prompt string.
- Consumed by Task 3 (the parallel fan-out in `tier2Investigate`).

- [ ] **Step 1: Create `agents/security-sentinel/specialists/enumerator.js`**

```javascript
'use strict';

// Enumerator specialist: produce a complete inventory of what exists.
// No analysis — pure enumeration. Data is passed in; no tool calls needed.

const schema = {
  type: 'object',
  properties: {
    pluginDirectories: {
      type: 'array',
      description: 'All directories found under wp-content/plugins/',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          createdAt: { type: 'string', description: 'ISO timestamp or null if unknown' },
          fileCount: { type: 'number' },
        },
        required: ['name', 'createdAt', 'fileCount'],
      },
    },
    unexpectedFiles: {
      type: 'array',
      description: 'Files with non-standard extensions in PHP-executable directories, or symlinks',
      items: { type: 'object', properties: { path: { type: 'string' }, reason: { type: 'string' } }, required: ['path', 'reason'] },
    },
    htaccessFiles: {
      type: 'array',
      description: 'All .htaccess files found anywhere in the web root',
      items: { type: 'string' },
    },
    nonStandardTables: {
      type: 'array',
      description: 'WordPress database tables not in the standard WP table set',
      items: { type: 'string' },
    },
    autoloadedOptions: {
      type: 'array',
      description: 'option_name values for all autoloaded WordPress options',
      items: { type: 'string' },
    },
  },
  required: ['pluginDirectories', 'unexpectedFiles', 'htaccessFiles', 'nonStandardTables', 'autoloadedOptions'],
};

function buildPrompt(data) {
  return `You are a WordPress forensics inventory specialist. Produce a complete structured inventory of the following site data.
Do not analyze or flag — only enumerate what exists. Return raw facts.

SITE: ${data.installName}

## Plugin directories (from filesystem scan)
${data.pluginDirectoriesRaw}

## Files in web root with non-standard extensions or locations
${data.unexpectedFilesRaw}

## .htaccess file paths found
${data.htaccessPathsRaw}

## Database: non-standard tables
${data.nonStandardTablesRaw}

## Database: autoloaded wp_options (option_name only)
${data.autoloadedOptionsRaw}

Return exactly the fields in the schema. For createdAt, use the filesystem mtime if available, or null.`;
}

module.exports = { schema, buildPrompt };
```

- [ ] **Step 2: Create `agents/security-sentinel/specialists/integrity.js`**

```javascript
'use strict';

const schema = {
  type: 'object',
  properties: {
    coreVerification: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['passed', 'failed', 'unavailable'] },
        failures: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'failures'],
    },
    pluginVerification: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed', 'unverifiable'] },
          failures: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string', description: 'Why unverifiable if applicable' },
        },
        required: ['slug', 'status', 'failures'],
      },
    },
    configPhpModified: {
      type: 'boolean',
      description: 'Whether wp-config.php was modified after the site was last known clean',
    },
  },
  required: ['coreVerification', 'pluginVerification', 'configPhpModified'],
};

function buildPrompt(data) {
  return `You are a WordPress integrity verification specialist. Analyze the following checksum and modification data.

SITE: ${data.installName}

## WP core verify-checksums output
${data.coreChecksums}

## Plugin checksum results (wp plugin verify-checksums per slug)
${data.pluginChecksums}

## wp-config.php modification time vs. expected (site created: ${data.siteCreatedAt})
${data.configPhpMtime}

Return the integrity status for core, each plugin, and wp-config.php.
Mark plugins not on WordPress.org as 'unverifiable'. List every failed file.`;
}

module.exports = { schema, buildPrompt };
```

- [ ] **Step 3: Create `agents/security-sentinel/specialists/pattern.js`**

```javascript
'use strict';

const schema = {
  type: 'object',
  properties: {
    criticalFindings: {
      type: 'array',
      description: 'High-confidence malicious patterns',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          lineNumber: { type: 'number' },
          pattern: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
          snippet: { type: 'string', description: 'First 120 chars of the matched line' },
        },
        required: ['file', 'pattern', 'severity'],
      },
    },
    htaccessFindings: {
      type: 'array',
      description: 'Suspicious .htaccess rules',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, rule: { type: 'string' }, reason: { type: 'string' } },
        required: ['file', 'rule', 'reason'],
      },
    },
    temporalCluster: {
      type: 'object',
      description: 'Burst of file modifications in a short window — primary attack signal',
      properties: {
        detected: { type: 'boolean' },
        windowStart: { type: 'string' },
        windowEnd: { type: 'string' },
        itemCount: { type: 'number' },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['detected'],
    },
    filesScanned: { type: 'number' },
    filesClean: { type: 'number' },
  },
  required: ['criticalFindings', 'htaccessFindings', 'temporalCluster', 'filesScanned', 'filesClean'],
};

function buildPrompt(data) {
  return `You are a WordPress malware pattern scanner. Analyze the following file scan results.

SITE: ${data.installName}
COMPROMISE WINDOW ESTIMATE: ${data.compromiseWindowEstimate ?? 'unknown'}

## PHP files with potential malicious patterns (pre-scanned output)
${data.patternScanOutput}

## All .htaccess file contents
${data.htaccessContents}

## File modification times (files modified in last 30 days)
${data.recentlyModifiedFiles}

RULES:
- CRITICAL: eval( combined with base64_decode, gzinflate, str_rot13, or gzuncompress
- CRITICAL: ELF binary header in any file
- CRITICAL: PHP execution in image/SVG extension (.jpg, .png, .svg containing <?php)
- HIGH: base64_decode on a string >500 chars
- HIGH: .htaccess RewriteRule sending to external domain
- TEMPORAL CLUSTER: If more than 3 files share modification timestamps within a 10-minute window,
  flag the entire cluster — rapid bulk modification is not consistent with normal site management.
  This is the primary signal for detecting attacker-installed plugins when plugin names are unfamiliar.

Return every finding. For temporalCluster, identify the window even if individual files look benign.`;
}

module.exports = { schema, buildPrompt };
```

- [ ] **Step 4: Create `agents/security-sentinel/specialists/database.js`**

```javascript
'use strict';

const schema = {
  type: 'object',
  properties: {
    injectedContent: {
      type: 'array',
      description: 'Database rows containing injected scripts or code',
      items: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          column: { type: 'string' },
          id: { type: 'string' },
          snippet: { type: 'string', description: 'First 200 chars of injected content' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
        },
        required: ['table', 'severity'],
      },
    },
    suspiciousCronHooks: {
      type: 'array',
      description: 'Scheduled cron hooks that map to unknown or missing functions',
      items: { type: 'object', properties: { hook: { type: 'string' }, schedule: { type: 'string' } }, required: ['hook'] },
    },
    optionAnomalies: {
      type: 'array',
      description: 'wp_options entries with suspicious values',
      items: {
        type: 'object',
        properties: { optionName: { type: 'string' }, reason: { type: 'string' } },
        required: ['optionName', 'reason'],
      },
    },
    nonStandardTableContent: {
      type: 'array',
      description: 'Content found in non-standard database tables',
      items: { type: 'object', properties: { table: { type: 'string' }, rowCount: { type: 'number' }, sample: { type: 'string' } }, required: ['table'] },
    },
    samplingNote: { type: 'string', description: 'What was sampled and what was skipped due to size' },
  },
  required: ['injectedContent', 'suspiciousCronHooks', 'optionAnomalies', 'nonStandardTableContent', 'samplingNote'],
};

function buildPrompt(data) {
  return `You are a WordPress database forensics specialist. Scan the following database contents for injected malicious content.

SITE: ${data.installName}

## wp_posts (all statuses, post_title + post_content sample)
${data.postsContent}

## wp_options — autoloaded values
${data.autoloadedOptions}

## wp_options — siteurl, home, active_plugins, cron
${data.criticalOptions}

## wp_usermeta — admin user meta (serialized objects)
${data.adminUsermeta}

## wp_comments — 50 most recent approved (content only)
${data.recentComments}

## Non-standard tables
${data.nonStandardTableData}

WHAT TO LOOK FOR:
- <script, <iframe, javascript:, base64, eval( in post_content
- siteurl or home pointing to unexpected domain
- active_plugins listing a slug not present on disk
- cron hooks calling functions from unknown plugins
- Serialized PHP objects in usermeta (O: pattern with callable methods)
- SEO spam in comment_content or post titles
- Any non-standard table content

State sampling limits explicitly — what rows were skipped due to table size.`;
}

module.exports = { schema, buildPrompt };
```

- [ ] **Step 5: Create `agents/security-sentinel/specialists/behavioral.js`**

```javascript
'use strict';

const schema = {
  type: 'object',
  properties: {
    cloakingDetected: {
      type: 'boolean',
      description: 'Whether the site returns different content to Googlebot vs normal browsers',
    },
    cloakingDetails: { type: 'string' },
    loginPageStatus: { type: 'number', description: 'HTTP status of /wp-login.php' },
    xmlrpcEnabled: { type: 'boolean' },
    userEnumerationEnabled: { type: 'boolean', description: 'Whether /wp-json/wp/v2/users returns user data' },
    redirectsDetected: {
      type: 'array',
      description: 'Unexpected redirects from any URL tested',
      items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    },
    anomalies: { type: 'array', items: { type: 'string' } },
  },
  required: ['cloakingDetected', 'loginPageStatus', 'xmlrpcEnabled', 'userEnumerationEnabled', 'redirectsDetected', 'anomalies'],
};

function buildPrompt(data) {
  return `You are a WordPress behavioral security analyst. Analyze external HTTP responses for signs of server-side cloaking or compromise.

SITE: ${data.installName}
URL: ${data.siteUrl}

## HTTP responses by user agent

### Standard browser (Chrome)
Status: ${data.standardResponse.status}
Headers: ${data.standardResponse.headers}
Body preview: ${data.standardResponse.bodyPreview}

### Googlebot
Status: ${data.googlebotResponse.status}
Headers: ${data.googlebotResponse.headers}
Body preview: ${data.googlebotResponse.bodyPreview}

### Google referrer
Status: ${data.googleReferrerResponse.status}
Body preview: ${data.googleReferrerResponse.bodyPreview}

### /wp-login.php
Status: ${data.loginPageStatus}

### /xmlrpc.php
Status: ${data.xmlrpcStatus}

### /wp-json/wp/v2/users
Status: ${data.usersApiStatus}
Body preview: ${data.usersApiBody}

## 5 random post URLs
${data.randomPostStatuses}

WHAT TO FLAG:
- Different response body or status code between standard browser and Googlebot: CRITICAL (cloaking)
- Location header on any response sending to external domain: CRITICAL
- /wp-json/wp/v2/users returning user login names: HIGH (user enumeration enabled)
- /xmlrpc.php returning 200 with XML: MEDIUM (attack surface)
- Any non-200 on random post URLs: MEDIUM

State cloakingDetected: true if and only if Googlebot response differs meaningfully from standard.`;
}

module.exports = { schema, buildPrompt };
```

- [ ] **Step 6: Create `agents/security-sentinel/specialists/synthesizer.js`**

```javascript
'use strict';

const schema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['active-compromise', 'high-risk', 'misconfiguration', 'clean'] },
    attackSummary: { type: 'string', description: 'Two-paragraph narrative of what happened and how' },
    entryPoint: { type: 'string', description: 'How the attacker likely gained initial access' },
    temporalNarrative: {
      type: 'string',
      description: 'Timeline of the attack: what happened when, in what order',
    },
    attackerItems: {
      type: 'array',
      description: 'Items confirmed or probable as attacker-introduced',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['plugin', 'user', 'file', 'database', 'option'] },
          name: { type: 'string' },
          confidence: { type: 'string', enum: ['confirmed', 'probable', 'possible'] },
          reasoning: { type: 'string' },
          action: { type: 'string', description: 'Recommended remediation action' },
        },
        required: ['type', 'name', 'confidence', 'reasoning', 'action'],
      },
    },
    legitimateItems: {
      type: 'array',
      description: 'Items confirmed pre-existing and legitimate',
      items: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' } }, required: ['type', 'name'] },
    },
    blindSpots: {
      type: 'array',
      description: 'Things that were NOT checked — explicit disclosure of coverage limits',
      items: { type: 'string' },
    },
    remediationSteps: {
      type: 'array',
      description: 'Ordered list of remediation steps, most critical first',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'number' },
          label: { type: 'string' },
          command: { type: 'string', description: 'Exact WP-CLI or shell command, or empty if manual' },
          tier: { type: 'number', enum: [1, 2, 3] },
          requiresApproval: { type: 'boolean' },
        },
        required: ['priority', 'label', 'tier', 'requiresApproval'],
      },
    },
  },
  required: ['verdict', 'attackSummary', 'entryPoint', 'temporalNarrative', 'attackerItems', 'legitimateItems', 'blindSpots', 'remediationSteps'],
};

function buildPrompt(data) {
  return `You are a senior WordPress security analyst synthesizing findings from five specialist agents.
Your job: correlate, elevate, and produce a remediation plan. You must also explicitly disclose blind spots.

SITE: ${data.installName} (${data.environment}, ${data.postCount} posts, created: ${data.siteCreatedAt})
LAST WPE SSH SYNC: ${data.lastSyncAt}

## Tier 1 signals (static analysis)
${data.tier1Signals}

## Enumerator findings
${JSON.stringify(data.enumeratorResult, null, 2)}

## Integrity findings
${JSON.stringify(data.integrityResult, null, 2)}

## Pattern scanner findings (includes temporal cluster analysis)
${JSON.stringify(data.patternResult, null, 2)}

## Database findings
${JSON.stringify(data.databaseResult, null, 2)}

## Behavioral findings
${JSON.stringify(data.behavioralResult, null, 2)}

SYNTHESIS RULES:
1. CRITICAL from any specialist leads the report — do not bury it.
2. Temporal cluster from the pattern scanner IS the attack session boundary. All items within the 
   cluster window are suspect regardless of whether their name matches a known-bad list.
3. Cross-agent correlation: a file flagged by pattern scanner AND in the temporal cluster window 
   becomes CONFIRMED. A file flagged by only one agent is PROBABLE.
4. Always name the entry point — how did the attacker first get in? This is the most important 
   question for preventing recurrence.
5. Remediation steps must be ordered: stop active exfiltration first, then remove persistence, 
   then close entry point, then verify clean.
6. BLIND SPOTS — always include these unless the specialist explicitly covered them:
   - Premium plugins (no checksums available from WordPress.org)
   - Runtime-assembled payloads (encrypted DB fragments assembled in memory at request time)
   - Time-triggered or IP-conditional code
   - Image EXIF data
   - Binary files (detected but not decompiled)
   - Any network-fetched payload (code that downloads its payload at runtime leaves no local trace)
   - wp_comments table if >10k rows (sampled only)
   Add any other gaps specific to this site that the specialists flagged.`;
}

module.exports = { schema, buildPrompt };
```

- [ ] **Step 7: Write tests for specialist schemas**

```javascript
// tests/unit/agents/security-sentinel/specialists.test.js
'use strict';

const enumerator   = require('../../../../agents/security-sentinel/specialists/enumerator');
const integrity    = require('../../../../agents/security-sentinel/specialists/integrity');
const pattern      = require('../../../../agents/security-sentinel/specialists/pattern');
const database     = require('../../../../agents/security-sentinel/specialists/database');
const behavioral   = require('../../../../agents/security-sentinel/specialists/behavioral');
const synthesizer  = require('../../../../agents/security-sentinel/specialists/synthesizer');

describe('Sentinel specialist modules', () => {
  const specialists = [enumerator, integrity, pattern, database, behavioral, synthesizer];
  specialists.forEach((mod, i) => {
    it(`specialist ${i + 1}: exports schema and buildPrompt`, () => {
      expect(typeof mod.schema).toBe('object');
      expect(typeof mod.schema.type).toBe('string');
      expect(Array.isArray(mod.schema.required)).toBe(true);
      expect(mod.schema.required.length).toBeGreaterThan(0);
      expect(typeof mod.buildPrompt).toBe('function');
    });
  });

  it('enumerator.buildPrompt includes installName', () => {
    const prompt = enumerator.buildPrompt({ installName: 'testsite', pluginDirectoriesRaw: '', unexpectedFilesRaw: '', htaccessPathsRaw: '', nonStandardTablesRaw: '', autoloadedOptionsRaw: '' });
    expect(prompt).toContain('testsite');
  });

  it('pattern schema requires temporalCluster field', () => {
    expect(pattern.schema.required).toContain('temporalCluster');
    expect(pattern.schema.properties.temporalCluster.properties.detected.type).toBe('boolean');
  });

  it('synthesizer schema requires blindSpots and entryPoint', () => {
    expect(synthesizer.schema.required).toContain('blindSpots');
    expect(synthesizer.schema.required).toContain('entryPoint');
    expect(synthesizer.schema.required).toContain('temporalNarrative');
  });
});
```

- [ ] **Step 8: Run tests**

```bash
npm test -- --testPathPattern=specialists --no-coverage 2>&1 | tail -8
```

Expected: 6/6 PASS.

- [ ] **Step 9: Commit**

```bash
git add agents/security-sentinel/specialists/ tests/unit/agents/security-sentinel/specialists.test.js
git commit -m "feat(sentinel-v2): specialist prompt/schema modules — enumerator, integrity, pattern, database, behavioral, synthesizer"
```

---

## Task 3: Data collection for specialists (sandbox tool calls)

**Files:**
- Modify: `agents/security-sentinel/agent.js` — add `collectSpecialistData(sandboxName, tools)` function

**Interfaces:**
- Produces: `collectSpecialistData(sandboxName, siteUrl, tools)` → `SpecialistData` object with raw strings for each specialist prompt. Consumed by Task 4.

This task extracts data from the sandbox via `wp_eval` and HTTP calls. It is the "Enumerator" phase of the original design — but here it's data collection code, not an AI call. The AI enumerator specialist then reasons over this raw data.

- [ ] **Step 1: Write a test for the data collector shape**

Add to `tests/unit/agents/security-sentinel/specialists.test.js`:

```javascript
// Stub the data shape — integration tested by running against real sandbox
it('collectSpecialistData returns all required keys', async () => {
  // The function is exported for testing — mock tools to return empty JSON
  const agent = require('../../../../agents/security-sentinel/agent');
  const mockTools = {
    invoke: jest.fn().mockResolvedValue('[]'),
  };
  // stub fetch for behavioral
  const origFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ status: 200, headers: new Map(), text: async () => '' });
  const data = await agent._test.collectSpecialistData('test-sandbox', 'https://test.wpengine.com', mockTools);
  global.fetch = origFetch;
  expect(data).toHaveProperty('pluginDirectoriesRaw');
  expect(data).toHaveProperty('patternScanOutput');
  expect(data).toHaveProperty('postsContent');
  expect(data).toHaveProperty('standardResponse');
});
```

- [ ] **Step 2: Implement `collectSpecialistData` in `agent.js`**

Add this function before `tier2Investigate`:

```javascript
// Collect raw data from sandbox for specialist AI calls.
// Returns strings suitable for embedding in specialist prompts.
async function collectSpecialistData(sandboxName, siteUrl, tools) {
  const results = await Promise.allSettled([

    // Plugin directory listing with mtimes
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $dir = WP_PLUGIN_DIR;
        $out = [];
        foreach (glob("$dir/*", GLOB_ONLYDIR) ?: [] as $d) {
          $mtime = @filemtime($d);
          $files = iterator_count(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)));
          $out[] = ['name' => basename($d), 'mtime' => $mtime ? date('c', $mtime) : null, 'fileCount' => $files];
        }
        echo json_encode($out);
      `,
    }),

    // Files recently modified (last 30 days) outside wp-admin and wp-includes
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $cutoff = time() - 30 * 86400;
        $root = ABSPATH;
        $found = [];
        $skip = ['wp-admin', 'wp-includes'];
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
          if (!$f->isFile()) continue;
          foreach ($skip as $s) { if (strpos($f->getPathname(), "/$s/") !== false) continue 2; }
          if ($f->getMTime() > $cutoff) {
            $found[] = ['path' => str_replace($root, '', $f->getPathname()), 'mtime' => date('c', $f->getMTime()), 'ext' => $f->getExtension()];
          }
          if (count($found) >= 500) break; // cap output
        }
        echo json_encode($found);
      `,
    }),

    // .htaccess files
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $root = ABSPATH;
        $files = [];
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f) {
          if ($f->getFilename() === '.htaccess') {
            $files[$f->getPathname()] = @file_get_contents($f->getPathname());
          }
        }
        echo json_encode($files);
      `,
    }),

    // Obfuscation pattern scan (pre-existing FS-02 code — reuse result)
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $dirs = [WP_CONTENT_DIR . '/plugins', WP_CONTENT_DIR . '/mu-plugins', WP_CONTENT_DIR . '/themes'];
        $patterns = ['/eval\\s*\\(\\s*base64_decode/','/eval\\s*\\(\\s*gzinflate\\s*\\(\\s*base64_decode/','/eval\\s*\\(\\s*str_rot13/','/assert\\s*\\(\\s*\\$/','/create_function\\s*\\(/'];
        $found = []; $total = 0;
        foreach ($dirs as $dir) {
          if (!is_dir($dir)) continue;
          foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() !== 'php' || $file->getSize() > 5*1024*1024) continue;
            $total++;
            $content = @file_get_contents($file->getPathname());
            foreach ($patterns as $p) {
              if (preg_match($p, $content, $m)) {
                $found[] = ['file' => str_replace(ABSPATH, '', $file->getPathname()), 'pattern' => $p, 'snippet' => substr($content, max(0, strpos($content, $m[0]) - 20), 120)];
                break;
              }
            }
          }
        }
        echo json_encode(['matches' => $found, 'scanned' => $total]);
      `,
    }),

    // Database: wp_posts content sample
    tools.invoke('wp_eval', {
      site: sandboxName,
      code: `
        global $wpdb;
        $posts = $wpdb->get_results("SELECT ID, post_title, LEFT(post_content, 500) AS content_preview, post_status, post_type FROM {$wpdb->posts} LIMIT 200", ARRAY_A);
        echo json_encode($posts);
      `,
    }),

    // Database: autoloaded options + critical options
    tools.invoke('wp_eval', {
      site: sandboxName,
      code: `
        global $wpdb;
        $auto = $wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE autoload='yes'");
        $critical = $wpdb->get_results("SELECT option_name, LEFT(option_value, 300) as option_value FROM {$wpdb->options} WHERE option_name IN ('siteurl','home','active_plugins','cron') LIMIT 10", ARRAY_A);
        $tables = $wpdb->get_col('SHOW TABLES');
        $std = ['posts','postmeta','comments','commentmeta','terms','termmeta','term_taxonomy','term_relationships','users','usermeta','options','links'];
        $prefixed = array_map(fn($t) => $wpdb->prefix . $t, $std);
        $extra = array_diff($tables, $prefixed);
        echo json_encode(['autoloaded' => $auto, 'critical' => $critical, 'nonStandardTables' => array_values($extra)]);
      `,
    }),

    // WP core checksums
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `echo shell_exec('wp --skip-plugins --skip-themes core verify-checksums 2>&1');`,
    }),

    // Behavioral: external HTTP checks
    (async () => {
      const UA_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36';
      const UA_GBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
      const headers = (ua, referer) => ({ 'User-Agent': ua, ...(referer ? { Referer: referer } : {}) });
      const fetchSafe = async (url, opts) => {
        try {
          const r = await fetch(url, { ...opts, redirect: 'manual', signal: AbortSignal.timeout(10000) });
          const text = await r.text().catch(() => '');
          return { status: r.status, headers: Object.fromEntries(r.headers.entries()), bodyPreview: text.slice(0, 500) };
        } catch (e) { return { status: 0, headers: {}, bodyPreview: e.message }; }
      };
      return {
        standard:      await fetchSafe(siteUrl, { headers: headers(UA_CHROME) }),
        googlebot:     await fetchSafe(siteUrl, { headers: headers(UA_GBOT) }),
        googleReferer: await fetchSafe(siteUrl, { headers: headers(UA_CHROME, 'https://www.google.com/') }),
        loginPage:     await fetchSafe(`${siteUrl}/wp-login.php`, { headers: headers(UA_CHROME) }),
        xmlrpc:        await fetchSafe(`${siteUrl}/xmlrpc.php`, { headers: headers(UA_CHROME) }),
        usersApi:      await fetchSafe(`${siteUrl}/wp-json/wp/v2/users`, { headers: headers(UA_CHROME) }),
      };
    })(),
  ]);

  const get = (i) => results[i].status === 'fulfilled' ? results[i].value : '(collection failed)';
  const parseJson = (v, fallback = '[]') => { try { return JSON.parse(typeof v === 'string' ? v : JSON.stringify(v)); } catch { return JSON.parse(fallback); } };

  const pluginDirs  = parseJson(get(0));
  const recentFiles = parseJson(get(1));
  const htaccess    = parseJson(get(2), '{}');
  const scanResult  = parseJson(get(3), '{"matches":[],"scanned":0}');
  const posts       = parseJson(get(4));
  const dbData      = parseJson(get(5), '{"autoloaded":[],"critical":[],"nonStandardTables":[]}');
  const coreChecks  = typeof get(6) === 'string' ? get(6) : JSON.stringify(get(6));
  const behavioral  = typeof get(7) === 'object' && get(7) !== null ? get(7) : {};

  return {
    // For enumerator
    pluginDirectoriesRaw:   JSON.stringify(pluginDirs, null, 2),
    unexpectedFilesRaw:     JSON.stringify(recentFiles.filter(f => !['php','js','css','html','txt','md','json','png','jpg','gif','woff','woff2','svg','mo','po'].includes(f.ext)), null, 2),
    htaccessPathsRaw:       Object.keys(htaccess).join('\n') || '(none found)',
    nonStandardTablesRaw:   (dbData.nonStandardTables || []).join('\n') || '(none)',
    autoloadedOptionsRaw:   (dbData.autoloaded || []).join('\n'),

    // For integrity
    coreChecksums:          coreChecks,
    pluginChecksums:        '(wp plugin verify-checksums not run — add in Task 4)',
    configPhpMtime:         '(captured via filesystem scan above)',

    // For pattern
    patternScanOutput:      JSON.stringify(scanResult, null, 2),
    htaccessContents:       JSON.stringify(htaccess, null, 2),
    recentlyModifiedFiles:  JSON.stringify(recentFiles, null, 2),

    // For database
    postsContent:           JSON.stringify(posts.slice(0, 50), null, 2),
    autoloadedOptions:      JSON.stringify(dbData.autoloaded, null, 2),
    criticalOptions:        JSON.stringify(dbData.critical, null, 2),
    adminUsermeta:          '(not yet collected — add wp_usermeta query in Task 4)',
    recentComments:         '(not yet collected — add wp_comments query in Task 4)',
    nonStandardTableData:   JSON.stringify(dbData.nonStandardTables, null, 2),

    // For behavioral
    standardResponse:       behavioral.standard ?? { status: 0, headers: {}, bodyPreview: '' },
    googlebotResponse:      behavioral.googlebot ?? { status: 0, headers: {}, bodyPreview: '' },
    googleReferrerResponse: behavioral.googleReferer ?? { status: 0, headers: {}, bodyPreview: '' },
    loginPageStatus:        behavioral.loginPage?.status ?? 0,
    xmlrpcStatus:           behavioral.xmlrpc?.status ?? 0,
    usersApiStatus:         behavioral.usersApi?.status ?? 0,
    usersApiBody:           behavioral.usersApi?.bodyPreview ?? '',
    randomPostStatuses:     '(not yet collected)',
  };
}
```

- [ ] **Step 3: Export for testing**

Find `_test: {` in `module.exports` and add `collectSpecialistData`:

```javascript
_test: { parseSqlResult, getScanScope, runAbsoluteChecks, llmUserAudit, runExposureChecks,
         loadBaseline, storeBaseline, runRelativeChecks, runFleetCorrelation,
         tier2Investigate, llmSynthesis, tier3Remediate, buildRemediationChecklist,
         executeChecklist, collectSpecialistData },
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern=specialists --no-coverage 2>&1 | tail -8
npm run compile 2>&1 | head -5
```

Expected: all pass, compile clean.

- [ ] **Step 5: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/specialists.test.js
git commit -m "feat(sentinel-v2): collectSpecialistData — parallel data collection for all five specialist prompts"
```

---

## Task 4: Wire parallel specialists into `tier2Investigate`

**Files:**
- Modify: `agents/security-sentinel/agent.js` — replace `llmSynthesis` call in `tier2Investigate` with parallel `generateObject` calls + synthesis

**Interfaces:**
- Consumes: `collectSpecialistData()` (Task 3), all six specialist modules (Task 2), `ai.generateObject({ noTools: true })` (Task 1)
- Produces: `tier2Investigate` returns a `RemediationPlan` built from the synthesizer's `remediationSteps`

- [ ] **Step 1: Add specialist requires at top of `agent.js`**

After `'use strict';` at the top of `agent.js`:

```javascript
const enumeratorSpec  = require('./specialists/enumerator');
const integritySpec   = require('./specialists/integrity');
const patternSpec     = require('./specialists/pattern');
const databaseSpec    = require('./specialists/database');
const behavioralSpec  = require('./specialists/behavioral');
const synthesizerSpec = require('./specialists/synthesizer');
```

- [ ] **Step 2: Replace `llmSynthesis` call in `tier2Investigate`**

Find the line near the end of `tier2Investigate`:
```javascript
const plan = await llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName);
```

Replace it with:

```javascript
  // Collect raw data for all specialists in parallel
  log.phase('Data collection', `Gathering filesystem, DB and behavioral data for ${install.name}`);
  const siteUrl = `https://${install.name}.wpengine.com`;
  const specialistData = await collectSpecialistData(sandboxName, siteUrl, tools);

  // Fan out to five parallel specialist AI calls — each is pure reasoning over provided data
  log.phase('Specialist analysis', `Running 5 parallel specialist checks on ${install.name}`);
  const [enumeratorResult, integrityResult, patternResult, databaseResult, behavioralResult] =
    await Promise.all([
      ai.generateObject({
        schema: enumeratorSpec.schema,
        prompt: enumeratorSpec.buildPrompt({ ...specialistData, installName: install.name }),
        schemaName: 'EnumeratorResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Enumerator failed: ${err.message}`); return { pluginDirectories: [], unexpectedFiles: [], htaccessFiles: [], nonStandardTables: [], autoloadedOptions: [] }; }),

      ai.generateObject({
        schema: integritySpec.schema,
        prompt: integritySpec.buildPrompt({ ...specialistData, installName: install.name, siteCreatedAt: install.sshLastSyncAt ?? 'unknown' }),
        schemaName: 'IntegrityResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Integrity failed: ${err.message}`); return { coreVerification: { status: 'unavailable', failures: [] }, pluginVerification: [], configPhpModified: false }; }),

      ai.generateObject({
        schema: patternSpec.schema,
        prompt: patternSpec.buildPrompt({ ...specialistData, installName: install.name, compromiseWindowEstimate: null }),
        schemaName: 'PatternResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Pattern failed: ${err.message}`); return { criticalFindings: [], htaccessFindings: [], temporalCluster: { detected: false }, filesScanned: 0, filesClean: 0 }; }),

      ai.generateObject({
        schema: databaseSpec.schema,
        prompt: databaseSpec.buildPrompt({ ...specialistData, installName: install.name }),
        schemaName: 'DatabaseResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Database failed: ${err.message}`); return { injectedContent: [], suspiciousCronHooks: [], optionAnomalies: [], nonStandardTableContent: [], samplingNote: 'Collection failed' }; }),

      ai.generateObject({
        schema: behavioralSpec.schema,
        prompt: behavioralSpec.buildPrompt({ ...specialistData, installName: install.name, siteUrl }),
        schemaName: 'BehavioralResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Behavioral failed: ${err.message}`); return { cloakingDetected: false, loginPageStatus: 0, xmlrpcEnabled: false, userEnumerationEnabled: false, redirectsDetected: [], anomalies: [] }; }),
    ]);

  // Elevation: if temporal cluster detected, add to signals
  if (patternResult.temporalCluster?.detected) {
    const cluster = patternResult.temporalCluster;
    log.finding({
      id: 'TC-01', severity: 'critical', site: install.name,
      title: `Temporal cluster: ${cluster.itemCount ?? 'multiple'} items within ${cluster.windowStart}–${cluster.windowEnd}`,
      description: `Rapid bulk activity within a short window is the primary signal of an automated attack. Items: ${(cluster.items ?? []).join(', ')}`,
    });
  }

  // Synthesis: correlate all five specialist results
  log.phase('Synthesis', `Correlating findings for ${install.name}`);
  let synthesis;
  try {
    synthesis = await ai.generateObject({
      schema: synthesizerSpec.schema,
      prompt: synthesizerSpec.buildPrompt({
        installName: install.name,
        environment: install.environment,
        postCount: install.postCount,
        siteCreatedAt: install.sshLastSyncAt ?? 'unknown',
        lastSyncAt: install.sshLastSyncAt ?? 'unknown',
        tier1Signals: tier1Signals.map(s => `[${s.severity.toUpperCase()}] ${s.id}: ${s.title}`).join('\n'),
        enumeratorResult,
        integrityResult,
        patternResult,
        databaseResult,
        behavioralResult,
      }),
      schemaName: 'SynthesizerResult',
      noTools: true,
    });
    log.warn(`[Tier 2 Synthesis] ${install.name}: ${synthesis.verdict} — ${synthesis.attackSummary.slice(0, 120)}...`);
  } catch (err) {
    log.warn(`[Tier 2 Synthesis] LLM call failed for ${install.name}: ${err.message} — defaulting to escalate`);
    synthesis = { verdict: 'active-compromise', attackSummary: '(synthesis unavailable)', entryPoint: 'unknown', temporalNarrative: '', attackerItems: [], legitimateItems: [], blindSpots: ['Synthesis failed'], remediationSteps: [] };
  }

  // Build RemediationPlan from synthesizer output
  if (synthesis.remediationSteps.length === 0) {
    log.warn(`[Tier 2] No remediation steps in synthesis — falling back to checklist builder`);
    const plan = await tier3Remediate(install, synthesis.attackSummary, tier1Signals.concat(fsSignals), sandboxName, tools, log);
    return plan;
  }

  log.phase('Tier 3', `Preparing remediation plan for ${install.name}`);
  const plan = await tier3Remediate(install, synthesis.attackSummary, tier1Signals.concat(fsSignals), sandboxName, tools, log);
  if (plan) {
    // Enrich plan with synthesizer's attacker items and blind spots
    plan.summary = synthesis.attackSummary;
    plan.entryPoint = synthesis.entryPoint;
    plan.blindSpots = synthesis.blindSpots;
    plan.attackerItems = synthesis.attackerItems;
  }
  return plan;
```

- [ ] **Step 2: Add `entryPoint`, `blindSpots`, `attackerItems` fields to `RemediationPlan` type**

In `src/main/agent-sdk/types.ts`, add optional fields to `RemediationPlan`:

```typescript
export interface RemediationPlan {
  site: string;
  sandbox?: string;
  verified: boolean;
  verdict: 'ready' | 'blocked';
  summary?: string;
  entryPoint?: string;           // ← new
  blindSpots?: string[];         // ← new
  attackerItems?: Array<{        // ← new
    type: string; name: string; confidence: string; reasoning: string; action: string;
  }>;
  steps: RemediationStep[];
}
```

- [ ] **Step 3: Compile and build**

```bash
npm run compile 2>&1 | head -5
npm run build 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 4: Manual smoke test**

Rebuild Local, clear the Tier 2 cooldown, run the sentinel against `theawfulpmtest`. In the RunDrawer log, verify you see:

```
[phase] Data collection: Gathering filesystem, DB and behavioral data...
[phase] Specialist analysis: Running 5 parallel specialist checks...
[phase] Synthesis: Correlating findings...
```

- [ ] **Step 5: Commit**

```bash
git add agents/security-sentinel/agent.js src/main/agent-sdk/types.ts
git commit -m "feat(sentinel-v2): parallel specialist analysis — 5 concurrent generateObject calls, temporal cluster elevation, synthesizer"
```

---

## Task 5: Eval harness — theawfulpmtest fixture + sentinel cases

**Files:**
- Create: `scripts/fixtures/theawfulpmtest-compromised.json` — snapshot of graph.db + known attack artifacts
- Create: `scripts/test-sentinel-v2.js` — standalone runner for Tier 1 + specialist data validation
- Create: `tests/evals/cases/sentinel-theawfulpmtest.yaml` — eval case with ground truth

**Interfaces:**
- Produces: `node scripts/test-sentinel-v2.js` runs without Local, shows Tier 1 signals + what the specialists would receive

- [ ] **Step 1: Extract fixture from current graph.db**

```bash
node -e "
const { execSync } = require('child_process');
const out = execSync(\`sqlite3 \"\$HOME/Library/Application Support/Local/nexus-ai/graph.db\" \".mode json\" \"SELECT s.id, s.name, s.environment, s.wp_version, s.php_version, s.post_count, s.user_count, s.settings_json, s.ssh_last_sync_at FROM sites s WHERE s.name='theawfulpmtest';\"\`, {encoding:'utf8'});
const site = JSON.parse(out)[0];

const plugins = JSON.parse(execSync(\`sqlite3 \"\$HOME/Library/Application Support/Local/nexus-ai/graph.db\" \".mode json\" \"SELECT slug, name, version, is_active FROM plugins WHERE site_id='\${site.id}';\"\`, {encoding:'utf8'}));
const users = JSON.parse(execSync(\`sqlite3 \"\$HOME/Library/Application Support/Local/nexus-ai/graph.db\" \".mode json\" \"SELECT username, email, roles, created_at FROM users WHERE site_id='\${site.id}';\"\`, {encoding:'utf8'}));

const fs = require('fs');
fs.mkdirSync('scripts/fixtures', { recursive: true });
fs.writeFileSync('scripts/fixtures/theawfulpmtest-current.json', JSON.stringify({ site, plugins, users }, null, 2));
console.log('Written scripts/fixtures/theawfulpmtest-current.json');
" 2>&1
```

Run the script: `node scripts/extract-fixture.js` (save the inline code above as `scripts/extract-fixture.js` first).

- [ ] **Step 2: Create `scripts/test-sentinel-v2.js`**

```javascript
#!/usr/bin/env node
'use strict';

// Standalone sentinel Tier 1 test — no Local required.
// Tests detection logic against fixture data.
// For Tier 2 testing, see scripts/test-sentinel-tier2.js (requires Local).

const fixture = require('./fixtures/theawfulpmtest-current.json');

// Mock tool provider — returns fixture data for fleet_sql queries
const mockTools = {
  async invoke(toolName, args) {
    if (toolName === 'fleet_sql') {
      // Return sites and plugins from fixture
      const q = (args.query || '').toLowerCase();
      if (q.includes('from sites')) return JSON.stringify([fixture.site]);
      if (q.includes('from plugins')) return JSON.stringify(fixture.plugins);
      if (q.includes('from users')) return JSON.stringify(fixture.users);
      return '[]';
    }
    console.log(`  [mock] ${toolName}`, JSON.stringify(args).slice(0, 80));
    return '[]';
  }
};

const mockLog = {
  info:       (m) => console.log(`  [INFO] ${m}`),
  warn:       (m) => console.log(`  [WARN] ${m}`),
  error:      (m) => console.error(`  [ERROR] ${m}`),
  debug:      () => {},
  finding:    (f) => console.log(`  [FINDING] [${f.severity.toUpperCase()}] ${f.id}: ${f.title}`),
  action:     (a) => console.log(`  [ACTION] ${a.label} — ${a.result}`),
  phase:      (n, d) => console.log(`\n  ▶ ${n}${d ? ': ' + d : ''}`),
  siteStatus: (s, status) => console.log(`  [STATUS] ${s} → ${status}`),
};

const mockState = {
  get: (k) => undefined,
  set: () => {},
  delete: () => {},
  scratch: {},
  isCoolingDown: () => false,
  setCooldown: () => {},
};

// Minimal AI that skips LLM calls — just logs what would be sent
const mockAi = {
  async run(prompt) {
    console.log(`  [AI] run() called (${prompt.length} chars)`);
    return '{}';
  },
  async generateObject(opts) {
    console.log(`  [AI] generateObject(${opts.schemaName ?? 'unnamed'}, noTools=${opts.noTools})`);
    // Return schema-valid stub
    const stub = {};
    for (const key of (opts.schema.required || [])) stub[key] = null;
    return stub;
  },
};

async function main() {
  const agent = require('../agents/security-sentinel/agent');

  console.log('\n=== Sentinel v2 Tier 1 Test ===');
  console.log(`Fixture: ${fixture.site.name} (${fixture.plugins.length} plugins, ${fixture.users.length} users)\n`);

  const event = {
    namespace: 'wpe', type: 'sync.completed', key: 'wpe:sync.completed',
    payload: { installName: fixture.site.name },
    createdAt: Date.now(),
  };

  const result = await agent.run({ event, tools: mockTools, ai: mockAi, log: mockLog, state: mockState });

  console.log('\n=== Result ===');
  console.log('Verdict:', result.verdict);
  console.log('Findings:', result.findings?.length ?? 0);
  if (result.findings?.length) {
    result.findings.forEach(f => console.log(`  [${f.severity}] ${f.id}: ${f.title}`));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Create eval case**

```yaml
# tests/evals/cases/sentinel-theawfulpmtest.yaml
id: sentinel-theawfulpmtest
description: Security sentinel detects attack artifacts on theawfulpmtest (ground truth from incident)
agent: security-sentinel
site: theawfulpmtest

ground_truth:
  must_detect:
    - id: ABS-05
      description: Known backdoor plugin wp-compat
    - id: FS-01
      description: PHP webshell in mu-plugins
    - id: FS-02
      description: Obfuscated eval+base64 code
    - id: TC-01
      description: Temporal cluster — multiple files created within 10-minute window
  entry_point_keywords:
    - admin
    - example.com
    - brute

  must_recommend:
    - rm wp-content/mu-plugins/index.php
    - wp plugin delete

  blind_spots_must_mention:
    - runtime
    - premium
```

- [ ] **Step 4: Test the standalone runner**

```bash
node scripts/test-sentinel-v2.js 2>&1 | head -40
```

Expected: Shows Tier 1 signals for theawfulpmtest without Local running.

- [ ] **Step 5: Commit**

```bash
git add scripts/ tests/evals/cases/sentinel-theawfulpmtest.yaml
git commit -m "feat(sentinel-v2): eval harness — theawfulpmtest fixture, standalone Tier 1 runner, eval case"
```
