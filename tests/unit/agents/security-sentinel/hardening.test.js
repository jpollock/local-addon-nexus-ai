'use strict';

// Batch 2 hardening — tightened versions of three flagged items:
//   (A) network-indicator domain trust: host-suffix match, infra-only
//   (B) protected-admin allowlist sourced off the scanned site
//   (C) fleet_sql parser drops malformed rows *with a warning*, not silently
const agent = require('../../../../agents/security-sentinel/agent');
const { buildRemediationChecklist, parseSqlResult } = agent._test;

describe('Hardening (A) — network-indicator domain trust', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8'
  );

  it('uses host-suffix matching in PHP, not substring strpos', () => {
    // the old substring filter is gone; the new one parses a host and checks suffix
    expect(src).toContain('parse_url($u, PHP_URL_HOST)');
    expect(src).not.toMatch(/foreach \(\$trusted as \$d\) \{ if \(strpos\(\$u, \$d\)/);
  });

  it('feeds only infra domains (not plugin-vendor domains) to the scan', () => {
    // the network-indicator scan trusts the infra list
    expect(src).toContain('JSON.stringify(TRUSTED_INFRA_DOMAINS)');
    // file-manager vendor domains are segregated out of that trust set
    expect(src).toContain('PLUGIN_VENDOR_DOMAINS');
    const infraBlock = src.slice(src.indexOf('const TRUSTED_INFRA_DOMAINS'), src.indexOf('const PLUGIN_VENDOR_DOMAINS'));
    expect(infraBlock).not.toContain('filemanagerpro.io');
  });
});

describe('Hardening (B) — protected-admin allowlist off the scanned site', () => {
  const step2 = (protectedEmails) => {
    const cl = buildRemediationChecklist(
      { protectedEmails }, [{ id: 'REL-03', severity: 'critical', title: 'x' }], 'sbx',
      { protectedEmails }
    );
    return cl.find(s => s.step === 2);
  };

  it('never reads admin_email from the scanned database', () => {
    const code = step2(['owner@wpe.com']).toolArgs.code;
    expect(code).not.toContain("get_option('admin_email')");
  });

  it('injects the agent-supplied allowlist as a literal (lowercased)', () => {
    const code = step2(['Owner@WPE.com']).toolArgs.code;
    expect(code).toContain('owner@wpe.com');
  });

  it('empty/omitted allowlist yields an empty protected set (safe default)', () => {
    const code = step2([]).toolArgs.code;
    expect(code).toContain('$protected = array_map(\'strtolower\', [])');
  });
});

describe('Hardening (C) — parser drops malformed rows with a warning', () => {
  const table = (rows) => ['| slug | name |', '| --- | --- |', ...rows].join('\n');

  it('drops a row whose value contains a pipe (column mismatch)', () => {
    const parsed = parseSqlResult(table(['| good | Fine |', '| ev|il | Bad |']));
    expect(parsed.length).toBe(1);
    expect(parsed[0].slug).toBe('good');
  });

  it('reports each dropped row via the onDrop callback', () => {
    const dropped = [];
    parseSqlResult(table(['| good | Fine |', '| ev|il | Bad |']), (line, want, got) => dropped.push({ line, want, got }));
    expect(dropped.length).toBe(1);
    expect(dropped[0].want).toBe(2);
    expect(dropped[0].got).toBe(3);
  });

  it('still works with no callback (backward compatible)', () => {
    const parsed = parseSqlResult(table(['| a | B |']));
    expect(parsed).toEqual([{ slug: 'a', name: 'B' }]);
  });
});
