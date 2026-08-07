// tests/unit/agents/security-sentinel/byte-scan.test.js
//
// Tier 1 now looks at the filesystem. Until this, it declared `filesystem: false` in its own
// coverage literal and meant it — a webshell was invisible unless something else escalated the
// site to Tier 2, and Tier 2 would then execute it on the way to finding it, because
// --skip-plugins filters `active_plugins` and does nothing about mu-plugins.

const fs = require('fs');
const path = require('path');
const agent = require('../../../../agents/security-sentinel/agent');
const { runByteScan } = agent._test;

const mkLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

/** A scan_site_files response in the shape the handler emits. */
function report({ unexpected = [], site = 'demo' } = {}) {
  const lines = [`## Byte scan — ${site}`, '', 'Web root: /x/app/public', 'Duration: 9 ms', ''];
  if (unexpected.length) {
    lines.push(`### Unexpected mu-plugins (${unexpected.length})`, '');
    lines.push('These load on every request and cannot be deactivated from wp-admin.', '');
    for (const u of unexpected) lines.push(`- \`${u.path}\` — ${u.bytes} bytes, modified 2026-07-14 07:40:14`);
    lines.push('');
  } else {
    lines.push('### mu-plugins', '', 'No unexpected files.', '');
  }
  lines.push('### Examined', '', '- mu-plugins — 4 PHP file(s) examined', '');
  lines.push('### NOT examined', '', '- database contents', '- core and plugin checksums');
  return lines.join('\n');
}

const mkTools = (text) => ({ invoke: jest.fn().mockResolvedValue(text) });

describe('runByteScan raises FS-01 from bytes', () => {
  it('parses an unexpected mu-plugin into a critical signal', async () => {
    // The real case that motivated this: 14,857 bytes of obfuscated PHP in mu-plugins/index.php
    // on a site in the fleet, invisible to Tier 1 before now.
    const tools = mkTools(report({ unexpected: [{ path: 'wp-content/mu-plugins/index.php', bytes: 14857 }] }));
    const res = await runByteScan({ name: 'theawfulpm-test', source: 'local' }, tools, mkLog());

    expect(res.available).toBe(true);
    expect(res.signals).toHaveLength(1);
    const sig = res.signals[0];
    expect(sig.id).toBe('FS-01');
    expect(sig.severity).toBe('critical');
    expect(sig.title).toContain('index.php');
    expect(sig.evidence).toEqual(['wp-content/mu-plugins/index.php']);
    expect(sig.detail).toMatch(/nothing was executed/);
  });

  it('parses several files', async () => {
    const tools = mkTools(report({ unexpected: [
      { path: 'wp-content/mu-plugins/a.php', bytes: 100 },
      { path: 'wp-content/mu-plugins/b.php', bytes: 200 },
    ] }));
    const res = await runByteScan({ name: 's', source: 'local' }, tools, mkLog());
    expect(res.signals[0].evidence).toEqual([
      'wp-content/mu-plugins/a.php', 'wp-content/mu-plugins/b.php',
    ]);
  });

  it('raises nothing on a clean site but still reports coverage', async () => {
    const tools = mkTools(report({ unexpected: [] }));
    const res = await runByteScan({ name: 's', source: 'local' }, tools, mkLog());
    expect(res.signals).toHaveLength(0);
    expect(res.available).toBe(true);   // looked and found nothing — distinct from did not look
  });
});

describe('Coverage is never overstated', () => {
  it('reports unavailable for a WPE install — there are no local bytes to read', async () => {
    const tools = mkTools(report({ unexpected: [] }));
    const res = await runByteScan({ name: 'prod', source: 'wpe' }, tools, mkLog());
    expect(res.available).toBe(false);
    expect(tools.invoke).not.toHaveBeenCalled();
  });

  it('reports unavailable when the site could not be scanned', async () => {
    const tools = mkTools('NOT SCANNED — s: not-wordpress (no wp-includes). This is not evidence the site is clean; nothing was examined.');
    const log = mkLog();
    const res = await runByteScan({ name: 's', source: 'local' }, tools, log);
    expect(res.available).toBe(false);
    expect(res.signals).toHaveLength(0);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('not scannable'));
  });

  it('reports unavailable — not clean — when the tool throws', async () => {
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('tool not registered')) };
    const res = await runByteScan({ name: 's', source: 'local' }, tools, mkLog());
    expect(res.available).toBe(false);
    expect(res.signals).toHaveLength(0);
  });

  it('reports unavailable on an empty response', async () => {
    const res = await runByteScan({ name: 's', source: 'local' }, mkTools(''), mkLog());
    expect(res.available).toBe(false);
  });

  it('handles the MCP content-array envelope as well as a bare string', async () => {
    const wrapped = { content: [{ type: 'text', text: report({ unexpected: [{ path: 'wp-content/mu-plugins/x.php', bytes: 5 }] }) }] };
    const res = await runByteScan({ name: 's', source: 'local' }, { invoke: jest.fn().mockResolvedValue(wrapped) }, mkLog());
    expect(res.signals).toHaveLength(1);
  });
});

describe('The scan is wired into the sweep and declared', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8');
  const yaml = fs.readFileSync(
    path.join(__dirname, '../../../../agents/security-sentinel/nexus.agent.yaml'), 'utf8');

  it('declares scan_site_files — NexusToolProvider throws on undeclared names', () => {
    expect(src).toContain("'scan_site_files'");
    expect(yaml).toContain('- scan_site_files');
  });

  it('sets coverage.filesystem from the result rather than leaving it false', () => {
    expect(src).toContain('coverage.filesystem = byteResult.available === true');
  });

  it('is registered as Tier 1, not the default Tier 2', () => {
    // getToolSafety falls back to TIER_OVERRIDES[name] ?? 2. At Tier 2 a read-only fleet sweep
    // would write a line per site per run to operation-audit.log.
    const safety = fs.readFileSync(
      path.join(__dirname, '../../../../src/main/mcp/safety.ts'), 'utf8');
    expect(safety).toMatch(/scan_site_files:\s*1,/);
  });

  it('is registered with the tool registry', () => {
    const index = fs.readFileSync(
      path.join(__dirname, '../../../../src/main/index.ts'), 'utf8');
    expect(index).toContain('registerSentinelScanTools(registry)');
  });

  it('does not start the site to scan it', () => {
    const handler = fs.readFileSync(
      path.join(__dirname, '../../../../src/main/mcp/modules/sentinel-scan/scan-files-handler.ts'), 'utf8');
    // Starting a possibly-compromised site to inspect it is the problem this avoids.
    // Check for the CALL, not the word — the handler documents in prose why it does not use it.
    expect(handler).not.toMatch(/withSiteRunning\s*\(/);
    expect(handler).not.toMatch(/^import .*withSiteRunning/m);
  });
});

describe('Tier 2 filesystem detection no longer executes the site', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const src2 = fs2.readFileSync(
    path2.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8');

  it('FS-01 through FS-06, ABS-08 and ABS-09 have no wp_eval block left', () => {
    // Each of these booted WordPress on a possibly-compromised clone to ask it about itself.
    // FS-05/ABS-08/ABS-09 joined this list once ported to the byte scanner (filesystem.ts /
    // directives.ts) and wired into runByteScan's deep-mode parser — they used to be the
    // reason Tier 2 still needed to start-and-clone at that point; they no longer are.
    for (const id of ['FS-01', 'FS-02', 'FS-03', 'FS-04', 'FS-05', 'FS-06', 'ABS-08', 'ABS-09']) {
      expect(src2).not.toMatch(new RegExp(`//\\s*${id}:`));
    }
  });

  it('the sandbox comment above tier2Investigate reflects the completed port, not the old gap', () => {
    // Pins against reintroducing the "FS-05/ABS-08/ABS-09 not ported yet" claim without also
    // reintroducing the wp_eval blocks it justified — a stale comment here is exactly the
    // overstated-coverage failure this work is about, just in the other direction.
    expect(src2).not.toMatch(/FS-05.*ABS-08.*ABS-09.*not ported/);
  });

  it('runs the byte scan BEFORE tier2Investigate, which is what creates the sandbox', () => {
    // Ordering is the whole point: local_clone_site starts the site and runs four
    // search-replace passes, so anything learnable from bytes must be learned first or it is
    // learned from a copy the act of copying has already changed.
    const preflight = src2.indexOf('Pre-flight byte scan of');
    const call = src2.indexOf('const plan = await tier2Investigate(');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(call);
  });

  it('passes the pre-flight findings into Tier 2 rather than rescanning', () => {
    expect(src2).toMatch(/tier2Investigate\([^)]*preflightSignals\)/);
    expect(src2).toContain('fsSignals.push(...preflightSignals)');
  });

  it('deep mode asks the tool for the deep scan', () => {
    expect(src2).toContain("tools.invoke('scan_site_files', { site: install.name, deep })");
  });
});

describe('runByteScan deep mode parses ABS-08/ABS-09/FS-05 from the real handler output', () => {
  // End-to-end, not hand-built markdown: a real temp WordPress-shaped tree, the real
  // scanSiteFilesHandler rendering it, and runByteScan's regex parser reading that real text.
  // Hand-writing the markdown risked pinning my own assumption about the format rather than
  // the format the handler actually produces.
  const os = require('os');
  let scanSiteFilesHandler;
  let tmp;

  beforeAll(() => {
    ({ scanSiteFilesHandler } = require('../../../../src/main/mcp/modules/sentinel-scan/scan-files-handler'));
  });

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-byte-scan-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function makeSite() {
    const sitePath = tmp;
    const pub = path.join(sitePath, 'app', 'public');
    fs.mkdirSync(path.join(pub, 'wp-includes'), { recursive: true });
    fs.writeFileSync(path.join(pub, 'wp-includes', 'version.php'), "<?php $wp_version = '6.9.4';");
    fs.writeFileSync(path.join(pub, 'wp-config.php'), "<?php $table_prefix = 'wp_';");

    // ABS-09: suspicious filename under plugins/.
    fs.mkdirSync(path.join(pub, 'wp-content/plugins/ranktool'), { recursive: true });
    fs.writeFileSync(path.join(pub, 'wp-content/plugins/ranktool/check_file.php'), '<?php echo 1;');

    // ABS-08: touch() + scandir in the same plugin PHP file.
    fs.mkdirSync(path.join(pub, 'wp-content/plugins/fileorganizer'), { recursive: true });
    fs.writeFileSync(
      path.join(pub, 'wp-content/plugins/fileorganizer/backdate.php'),
      '<?php function f($d,$t){foreach(scandir($d) as $x) touch($d."/".$x,$t);}',
    );

    // FS-05: .user.ini re-enabling execution before every request.
    fs.writeFileSync(path.join(pub, '.user.ini'), 'auto_prepend_file = evil.php\n');

    // DB-01: a spam post in a fresh, complete dump — no site process involved at all.
    const sqlDir = path.join(sitePath, 'app', 'sql');
    fs.mkdirSync(sqlDir, { recursive: true });
    fs.writeFileSync(
      path.join(sqlDir, 'local.sql'),
      "INSERT INTO `wp_posts` VALUES (1,1,'2026-01-01 00:00:00','2026-01-01 00:00:00'," +
        "'Best online casino bonuses','Spam',''," +
        "'publish','open','open','','slug-1','','','2026-01-01 00:00:00','2026-01-01 00:00:00','',0," +
        "'http://x/?p=1',0,'post','',0);\n" +
        '-- Dump completed on 2026-08-06 12:00:00\n',
    );

    return { id: 'x', name: 'abs-fixture', path: sitePath };
  }

  it('surfaces ABS-08, ABS-09, FS-05 and DB-01 as Tier 1 signals with nothing executed', async () => {
    const site = makeSite();

    const result = await scanSiteFilesHandler.execute({ site: 'abs-fixture', deep: true }, {
      siteData: { getSite: (id) => (id === 'x' ? site : null), getSites: () => ({ x: site }) },
    });
    const text = result.content[0].text;

    expect(text).toContain('Suspicious filenames in plugins (ABS-09)');
    expect(text).toContain('check_file.php');
    expect(text).toContain('Anti-forensics timestamp manipulation (ABS-08)');
    expect(text).toContain('backdate.php');
    expect(text).toContain('.user.ini');
    expect(text).toContain('Suspicious post content (DB-01)');
    expect(text).toContain('casino/gambling spam');

    const tools = mkTools(text);
    const res = await runByteScan({ name: 'abs-fixture', source: 'local' }, tools, mkLog(), { deep: true });

    expect(res.available).toBe(true);
    const byId = Object.fromEntries(res.signals.map((s) => [s.id, s]));
    expect(byId['ABS-09']).toBeDefined();
    expect(byId['ABS-09'].evidence.some((e) => e.includes('check_file.php'))).toBe(true);
    expect(byId['ABS-08']).toBeDefined();
    expect(byId['ABS-08'].evidence.some((e) => e.includes('backdate.php'))).toBe(true);
    expect(byId['FS-05']).toBeDefined();
    expect(byId['FS-05'].evidence.some((e) => e.includes('.user.ini'))).toBe(true);
    expect(byId['DB-01']).toBeDefined();
    expect(byId['DB-01'].severity).toBe('high');
    // Regression: buildRemediationChecklist's Step 5d extracts post IDs to delete via
    // /ID:(\d+)/ against this exact evidence array. An earlier render used `post ${id}`
    // instead — the regex found nothing, Step 5d silently dropped out of every checklist,
    // and the flagged spam posts were never actually deleted even on a READY TO PUSH verdict
    // (DB-01 is 'high', not 'critical', so its absence never blocked the gate).
    expect(byId['DB-01'].evidence.some((e) => /ID:\d+/.test(e))).toBe(true);

    for (const s of res.signals) {
      expect(s.detail).toMatch(/nothing was executed/);
    }
  });

  it('reports a "not examined" reason instead of silence when the site is running', async () => {
    const site = makeSite();
    // Simulate a running site: a socket file under the default run/ directory for this site id.
    const runDir = path.join(
      require('os').homedir(), 'Library', 'Application Support', 'Local', 'run', site.id, 'mysql',
    );
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'mysqld.sock'), '');
    try {
      const result = await scanSiteFilesHandler.execute({ site: 'abs-fixture', deep: true }, {
        siteData: { getSite: (id) => (id === 'x' ? site : null), getSites: () => ({ x: site }) },
      });
      const text = result.content[0].text;
      expect(text).toContain('Database — NOT EXAMINED');
      expect(text).toContain('site-running');

      const res = await runByteScan({ name: 'abs-fixture', source: 'local' }, mkTools(text), mkLog(), { deep: true });
      expect(res.signals.some((s) => s.id === 'DB-01')).toBe(false);
    } finally {
      fs.rmSync(path.dirname(runDir), { recursive: true, force: true });
    }
  });
});
