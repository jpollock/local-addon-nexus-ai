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
