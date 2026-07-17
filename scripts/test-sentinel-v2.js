#!/usr/bin/env node
'use strict';

// Standalone sentinel Tier 1 test — no Local required.
// Tests detection logic against the compromised fixture.
// Uses the compromised variant so all Tier 1 signals fire.
// For Tier 2 testing see scripts/test-sentinel-tier2.js (requires Local).

const fixture = require('./fixtures/theawfulpmtest-compromised.json');

// ─── Markdown table serializer ─────────────────────────────────────────────────
// parseSqlResult() in agent.js expects pipe-delimited markdown table format.
// This converts fixture arrays to that format so the agent parses them correctly.
function toMarkdownTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const keys = Object.keys(rows[0]);
  const header = '| ' + keys.join(' | ') + ' |';
  const sep    = '| ' + keys.map(() => '---').join(' | ') + ' |';
  const body   = rows.map(row =>
    '| ' + keys.map(k => String(row[k] ?? '')).join(' | ') + ' |'
  ).join('\n');
  return [header, sep, body].join('\n');
}

// ─── Mock tool provider ────────────────────────────────────────────────────────
// Intercepts fleet_sql and returns fixture data in the markdown table format
// that parseSqlResult() expects.
//
// Tier 2 gate: local_wpe_pull returns an error string so tier2Investigate()
// exits immediately without entering the 20s-per-poll loop. This keeps the
// standalone runner completing in < 1s while still exercising all Tier 1 code.
const mockTools = {
  async invoke(toolName, args) {
    if (toolName === 'fleet_sql') {
      const q = (args.query || '').toLowerCase();
      if (q.includes('from sites')) {
        // Return only this install — scoped by name
        return toMarkdownTable([fixture.site]);
      }
      if (q.includes('from plugins')) {
        return toMarkdownTable(fixture.plugins);
      }
      if (q.includes('from users')) {
        return toMarkdownTable(fixture.users);
      }
      return '';
    }
    // Hard-stop Tier 2: the pull error string causes tier2Investigate() to
    // return null immediately rather than entering the 20s poll loop.
    if (toolName === 'local_wpe_pull') {
      console.log(`  [mock tool] ${toolName} — returning error to skip Tier 2 poll loop`);
      return 'error: Tier 2 skipped in standalone test mode (no Local required)';
    }
    // Other Tier 2 tools: log and return empty
    console.log(`  [mock tool] ${toolName}(${JSON.stringify(args).slice(0, 80)})`);
    return '[]';
  },
};

// ─── Mock logger ───────────────────────────────────────────────────────────────
const findings = [];
const mockLog = {
  info:       (m) => console.log(`  [INFO]    ${m}`),
  warn:       (m) => console.log(`  [WARN]    ${m}`),
  error:      (m) => console.error(`  [ERROR]   ${m}`),
  debug:      () => {},
  finding:    (f) => {
    findings.push(f);
    console.log(`  [FINDING] [${(f.severity || '?').toUpperCase()}] ${f.id}: ${f.title}`);
  },
  action:     (a) => console.log(`  [ACTION]  ${a.label} — ${a.result}`),
  phase:      (n, d) => console.log(`\n  ▶ Phase: ${n}${d ? ' — ' + d : ''}`),
  siteStatus: (s, status) => console.log(`  [STATUS]  ${s} → ${status}`),
};

// ─── Mock state (no cooldowns, no baselines) ───────────────────────────────────
// isCoolingDown() returns false so Tier 2 would be attempted — but local_create_site
// is a mock that returns [] so Tier 2 exits early. Safe for standalone testing.
const mockState = {
  _store: {},
  get: (k) => undefined,          // no baseline → relative checks skip cleanly
  set: (k, v) => {},
  delete: (k) => {},
  scratch: {},
  isCoolingDown: () => false,
  setCooldown: () => {},
};

// ─── Mock AI — skips LLM calls ────────────────────────────────────────────────
// generateObject returns schema-valid stubs so the agent doesn't throw.
// The specialist calls (Tier 2) will never reach the LLM in this test because
// local_create_site mock returns [] and the pull-result contains no error string,
// which means tier2 _does_ proceed. To prevent that, llmUserAudit and tier2
// are both guarded by tool results — but we still need stub returns here.
const mockAi = {
  async run(prompt) {
    console.log(`  [AI run] ${prompt.length} chars — returning CLEAN: (stub)`);
    return 'CLEAN: No suspicious usernames detected (stub).';
  },
  async generateObject(opts) {
    const name = opts.schemaName ?? 'unnamed';
    console.log(`  [AI generateObject] schema=${name}, noTools=${opts.noTools}`);
    // Return a stub that satisfies the schema required fields with safe defaults
    const schema = opts.schema || {};
    const stub = buildStub(schema);
    return stub;
  },
};

function buildStub(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (schema.type === 'array') return [];
  if (schema.type === 'string') return '';
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'object' || schema.properties) {
    const obj = {};
    for (const key of (schema.required || [])) {
      const propSchema = schema.properties?.[key] || {};
      obj[key] = buildStub(propSchema);
    }
    return obj;
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const agent = require('../agents/security-sentinel/agent');

  const pluginCount = fixture.plugins.filter(p => p.is_active).length;
  const userCount   = fixture.users.length;

  console.log('\n=== Sentinel v2 Tier 1 Test ===');
  console.log(`Fixture:  ${fixture.site.name} (${fixture.plugins.length} plugins, ${pluginCount} active, ${userCount} users)`);
  console.log(`Source:   scripts/fixtures/theawfulpmtest-compromised.json`);
  console.log(`Expected: ABS-01, ABS-02, ABS-03, ABS-04, ABS-05, EXP-01, EXP-03\n`);

  const event = {
    namespace: 'wpe',
    type: 'sync.completed',
    key: 'wpe:sync.completed',
    payload: { installName: fixture.site.name },
    createdAt: Date.now(),
  };

  let result;
  try {
    result = await agent.run({ event, tools: mockTools, ai: mockAi, log: mockLog, state: mockState });
  } catch (err) {
    console.error('\n[FATAL] agent.run() threw:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  console.log('\n=== Result ===');
  console.log('Verdict: ', result.verdict);
  console.log('Findings:', result.findings?.length ?? 0);

  if (result.findings?.length) {
    console.log('\nFindings detail:');
    for (const f of result.findings) {
      console.log(`  [${(f.severity || '?').toUpperCase()}] ${f.id}: ${f.title} (site: ${f.site})`);
    }
  }

  // ─── Assertions ──────────────────────────────────────────────────────────────
  console.log('\n=== Tier 1 Assertions ===');
  const EXPECTED_IDS = ['ABS-01', 'ABS-02', 'ABS-03', 'ABS-04', 'ABS-05', 'EXP-01', 'EXP-03'];
  const foundIds = new Set((result.findings || []).map(f => f.id));
  let passed = 0;
  let failed = 0;

  for (const id of EXPECTED_IDS) {
    if (foundIds.has(id)) {
      console.log(`  PASS  ${id} detected`);
      passed++;
    } else {
      console.log(`  FAIL  ${id} NOT detected`);
      failed++;
    }
  }

  console.log(`\n${passed}/${EXPECTED_IDS.length} assertions passed.`);
  if (failed > 0) {
    console.error(`${failed} missing signal(s) — eval failed.`);
    process.exit(1);
  }
  console.log('All Tier 1 signals detected correctly.');
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  console.error(err.stack);
  process.exit(1);
});
