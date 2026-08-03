// tests/unit/agents/security-sentinel/log-evidence.test.js
'use strict';

const agent = require('../../../../agents/security-sentinel/agent');
const { runLogChecks } = agent._test;

const mkLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

/**
 * Build a get_log_aggregates payload. Defaults produce a quiet site with no signals;
 * override to push a specific check over its threshold.
 */
function aggregates({ loginPosts = 0, xmlrpcPosts = 0, probes = {}, userRestApi = 0, authorScan = 0, distinctIps = 0 } = {}) {
  return {
    siteId: 'testsite',
    aggregates: {
      '2026-08-01': {
        attack: {
          authAttack: { '00': { loginPosts: { 401: loginPosts }, xmlrpcPosts: { 403: xmlrpcPosts } } },
          probes: Object.fromEntries(Object.entries(probes).map(([p, hits]) => [p, { hits }])),
          enumeration: { userRestApi: { '00': userRestApi }, authorScan: { '00': authorScan } },
          ipCardinality: { distinct: distinctIps },
        },
      },
    },
  };
}

/** A tools mock whose fetch_log_window responds per-phase. */
function mkTools(aggPayload, { estimate = '0.2 GB estimated', window = 'line one\nline two\nline three' } = {}) {
  const invoke = jest.fn(async (tool, params) => {
    if (tool === 'get_log_aggregates') return aggPayload;
    if (tool === 'fetch_log_window') return params.confirm ? window : estimate;
    return '';
  });
  return { invoke };
}

describe('Log evidence follows the findings, not a second threshold', () => {
  it('does not fetch raw lines when no log check fired', async () => {
    const tools = mkTools(aggregates());
    const res = await runLogChecks('testsite', tools, mkLog());

    expect(res.signals).toHaveLength(0);
    const fetches = tools.invoke.mock.calls.filter(([t]) => t === 'fetch_log_window');
    expect(fetches).toHaveLength(0);
  });

  it('fetches and attaches raw lines for a finding well below the old critical threshold', async () => {
    // 150 auth POSTs clears LOG-AUTH (>100) but is far under the old >500 fetch gate, so this
    // finding previously shipped with no supporting lines at all.
    const tools = mkTools(aggregates({ loginPosts: 150 }));
    const res = await runLogChecks('testsite', tools, mkLog());

    const auth = res.signals.find(s => s.id === 'LOG-AUTH');
    expect(auth).toBeDefined();
    expect(auth.evidence.sampleLines).toEqual(['line one', 'line two', 'line three']);
    expect(auth.evidence.totalMatched).toBe(3);
    expect(auth.evidence.truncated).toBe(false);
    expect(auth.evidence.filter).toEqual({ pathContains: '/wp-login.php' });
  });

  it('honours the two-phase contract: estimate first, then confirm', async () => {
    const tools = mkTools(aggregates({ loginPosts: 150 }));
    await runLogChecks('testsite', tools, mkLog());

    const fetches = tools.invoke.mock.calls.filter(([t]) => t === 'fetch_log_window');
    expect(fetches).toHaveLength(2);
    expect(fetches[0][1].confirm).toBeUndefined();  // phase 1 must not confirm
    expect(fetches[1][1].confirm).toBe(true);
  });

  it('declines to stream a window whose estimate exceeds the cap', async () => {
    const tools = mkTools(aggregates({ loginPosts: 150 }), { estimate: '42.5 GB estimated' });
    const log = mkLog();
    const res = await runLogChecks('testsite', tools, log);

    const confirmed = tools.invoke.mock.calls.filter(([t, p]) => t === 'fetch_log_window' && p.confirm);
    expect(confirmed).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('42.5 GB'));
    // The finding must survive the refusal to corroborate it.
    expect(res.signals.find(s => s.id === 'LOG-AUTH')).toBeDefined();
  });

  it('keeps the signal when the forensic fetch throws', async () => {
    const tools = {
      invoke: jest.fn(async (tool) => {
        if (tool === 'get_log_aggregates') return aggregates({ loginPosts: 150 });
        throw new Error('S3 unreachable');
      }),
    };
    const res = await runLogChecks('testsite', tools, mkLog());

    const auth = res.signals.find(s => s.id === 'LOG-AUTH');
    expect(auth).toBeDefined();
    expect(auth.evidence).toBeUndefined();
    expect(res.attackSummary).toContain('No raw log lines could be retrieved');
  });

  it('caps the sample and reports truncation', async () => {
    const many = Array.from({ length: 500 }, (_, i) => `req ${i}`).join('\n');
    const tools = mkTools(aggregates({ loginPosts: 150 }), { window: many });
    const res = await runLogChecks('testsite', tools, mkLog());

    const auth = res.signals.find(s => s.id === 'LOG-AUTH');
    expect(auth.evidence.sampleLines).toHaveLength(40);
    expect(auth.evidence.totalMatched).toBe(500);
    expect(auth.evidence.truncated).toBe(true);
  });

  it('leaves the window unfiltered for LOG-DIST, whose finding is about IP spread', async () => {
    const tools = mkTools(aggregates({ distinctIps: 120 }));
    const res = await runLogChecks('testsite', tools, mkLog());

    expect(res.signals.find(s => s.id === 'LOG-DIST')).toBeDefined();
    const [, params] = tools.invoke.mock.calls.find(([t, p]) => t === 'fetch_log_window' && p.confirm);
    expect(params.pathContains).toBeUndefined();
  });

  it('scopes the window to the busiest probe path for LOG-PROBE', async () => {
    const tools = mkTools(aggregates({ probes: { '/wp-content/uploads/x.php': 800, '/.env': 60 } }));
    const res = await runLogChecks('testsite', tools, mkLog());

    expect(res.signals.find(s => s.id === 'LOG-PROBE')).toBeDefined();
    const [, params] = tools.invoke.mock.calls.find(([t, p]) => t === 'fetch_log_window' && p.confirm);
    expect(params.pathContains).toBe('/wp-content/uploads/x.php');
  });

  it('puts the raw sample into the summary the Tier 2 synthesizer reads', async () => {
    const tools = mkTools(aggregates({ loginPosts: 150 }));
    const res = await runLogChecks('testsite', tools, mkLog());

    expect(res.attackSummary).toContain('Raw sample (3 of 3 matching lines)');
    expect(res.attackSummary).toContain('line one');
  });
});

describe('Log availability is reported, not assumed', () => {
  it('reports available:false when the aggregates tool is unavailable', async () => {
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('log-processor not connected')) };
    const res = await runLogChecks('testsite', tools, mkLog());

    expect(res.available).toBe(false);
    expect(res.signals).toHaveLength(0);
  });

  it('reports available:false when the site has no log data', async () => {
    const tools = mkTools({ siteId: 'testsite', aggregates: {} });
    const res = await runLogChecks('testsite', tools, mkLog());

    expect(res.available).toBe(false);
  });

  it('reports available:true for a quiet site that genuinely has logs', async () => {
    // available:true with zero signals is the meaningful case — it distinguishes
    // "we looked at the logs and saw nothing" from "we never saw the logs".
    const res = await runLogChecks('testsite', mkTools(aggregates()), mkLog());
    expect(res.available).toBe(true);
    expect(res.signals).toHaveLength(0);
  });
});
