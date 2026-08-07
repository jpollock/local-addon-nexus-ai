// tests/unit/sentinel/scanner.test.ts
//
// Slice 1 of the byte-level scanner: FileSource, root resolution, and FS-01 read as bytes.
//
// The reason this exists rather than another wp_eval: FS-01 today runs with skip_plugins:true,
// which WP-CLI implements as four filters on `active_plugins` — mu-plugins are included by
// wp-settings.php from the filesystem and gated by none of them. So the check that looks for a
// mu-plugin webshell executes it first, and anything running at mu-plugin time can rewrite the
// answer on its way out.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalFileSource } from '../../../src/main/sentinel/scanner/LocalFileSource';
import { resolveScanRoot } from '../../../src/main/sentinel/scanner/resolveScanRoot';
import { checkMuPlugins } from '../../../src/main/sentinel/scanner/checks/muPlugins';
import { KNOWN_MU_PLUGINS, scanLocalSite } from '../../../src/main/sentinel/scanner';

let tmp: string;

/** Build a throwaway site tree. Returns the site record shape resolveScanRoot expects. */
function makeSite(name: string, opts: {
  wordpress?: boolean;
  muPlugins?: Record<string, string>;
  wpConfig?: string;
} = {}) {
  const sitePath = path.join(tmp, name);
  const pub = path.join(sitePath, 'app', 'public');
  fs.mkdirSync(pub, { recursive: true });

  if (opts.wordpress !== false) {
    fs.mkdirSync(path.join(pub, 'wp-includes'), { recursive: true });
    fs.writeFileSync(path.join(pub, 'wp-includes', 'version.php'), "<?php $wp_version = '6.9.4';");
  }
  fs.writeFileSync(path.join(pub, 'wp-config.php'),
    opts.wpConfig ?? "<?php $table_prefix = 'wp_';\nrequire_once ABSPATH . 'wp-settings.php';");

  if (opts.muPlugins) {
    const mu = path.join(pub, 'wp-content', 'mu-plugins');
    fs.mkdirSync(mu, { recursive: true });
    for (const [file, body] of Object.entries(opts.muPlugins)) {
      fs.mkdirSync(path.dirname(path.join(mu, file)), { recursive: true });
      fs.writeFileSync(path.join(mu, file), body);
    }
  }
  return { id: name, name, path: sitePath };
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-scan-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('resolveScanRoot refuses rather than failing open', () => {
  it('resolves a real install', () => {
    const r = resolveScanRoot(makeSite('good', { muPlugins: {} }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.muPluginDir).toBe('wp-content/mu-plugins');
    expect(r.tablePrefix).toBe('wp_');
    expect(r.wpVersion).toBe('6.9.4');
  });

  it('refuses a directory that is not WordPress', () => {
    // Two of 35 sites on the reference machine are empty shells with an app/public. Scanning
    // one would produce a confident clean verdict about nothing.
    const r = resolveScanRoot(makeSite('shell', { wordpress: false }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-wordpress');
  });

  it('refuses a site whose web root is missing', () => {
    const r = resolveScanRoot({ id: 'x', name: 'x', path: path.join(tmp, 'nope') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no-web-root');
  });

  it('refuses a record with no path at all', () => {
    expect(resolveScanRoot(null).ok).toBe(false);
    expect(resolveScanRoot({}).ok).toBe(false);
  });

  it('honours a relocated WP_CONTENT_DIR', () => {
    // sunrise.php loads before the constants block, so a drop-in can move this. Assuming
    // wp-content means scanning a directory that may not be the one WordPress uses.
    const site = makeSite('moved');
    const pub = path.join(site.path, 'app', 'public');
    fs.writeFileSync(path.join(pub, 'wp-config.php'),
      `<?php define('WP_CONTENT_DIR', '${pub}/custom-content'); $table_prefix = 'xk9_';`);
    const r = resolveScanRoot(site);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contentDir).toBe('custom-content');
    expect(r.muPluginDir).toBe('custom-content/mu-plugins');
    expect(r.tablePrefix).toBe('xk9_');
  });

  it('does not let a WP_CONTENT_DIR outside the root escape the scan', () => {
    const site = makeSite('escape');
    const pub = path.join(site.path, 'app', 'public');
    fs.writeFileSync(path.join(pub, 'wp-config.php'),
      `<?php define('WP_CONTENT_DIR', '/etc'); $table_prefix = 'wp_';`);
    const r = resolveScanRoot(site);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contentDir).toBe('wp-content');   // falls back, never scans /etc
  });
});

describe('LocalFileSource cannot be walked out of its root', () => {
  it('rejects a traversal path', async () => {
    const site = makeSite('trav', { muPlugins: {} });
    const src = new LocalFileSource(path.join(site.path, 'app', 'public'));
    await expect(src.readdir('../../..')).rejects.toThrow(/escapes scan root/);
    expect(await src.readFile('../../../etc/hosts')).toBeNull();
    expect(await src.exists('../..')).toBe(false);
  });

  it('rejects a NUL byte', async () => {
    const site = makeSite('nul', { muPlugins: {} });
    const src = new LocalFileSource(path.join(site.path, 'app', 'public'));
    expect(await src.readFile('wp-config.php\0.txt')).toBeNull();
  });

  it('reports symlinks without following them', async () => {
    const site = makeSite('sym', { muPlugins: { 'a.php': '<?php' } });
    const pub = path.join(site.path, 'app', 'public');
    const mu = path.join(pub, 'wp-content', 'mu-plugins');
    fs.symlinkSync(os.tmpdir(), path.join(mu, 'escape'));

    const src = new LocalFileSource(pub);
    const walked = await src.walk('wp-content/mu-plugins');
    const link = walked.entries.find((e) => e.name === 'escape');
    expect(link?.isSymbolicLink).toBe(true);
    // The symlink target's contents must not appear in the walk.
    expect(walked.entries.every((e) => !e.path.includes('escape/'))).toBe(true);
    // And it is reported as a link rather than a directory — this is what actually stops the
    // traversal, since Dirent describes the link and not its target. An SSH FileSource parsing
    // `find -type d` would NOT get this for free and needs the explicit guard.
    expect(link?.isDirectory).toBe(false);
  });

  it('reports truncation rather than silently stopping', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`f${i}.php`] = '<?php';
    const site = makeSite('many', { muPlugins: files });
    const src = new LocalFileSource(path.join(site.path, 'app', 'public'));

    const capped = await src.walk('wp-content/mu-plugins', { limit: 5 });
    expect(capped.truncated).toBe(true);
    const full = await src.walk('wp-content/mu-plugins');
    expect(full.truncated).toBe(false);
  });

  it('records unreadable directories instead of dropping them', async () => {
    const site = makeSite('perm', { muPlugins: { 'a.php': '<?php' } });
    const pub = path.join(site.path, 'app', 'public');
    const locked = path.join(pub, 'wp-content', 'locked');
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o000);

    const src = new LocalFileSource(pub);
    const walked = await src.walk('wp-content');
    fs.chmodSync(locked, 0o755);   // restore so cleanup works

    // Either it was unreadable and recorded, or the OS let us read it (root/CI). Both are fine;
    // silently vanishing is not.
    const sawIt = walked.unreadable.some((u) => u.path.includes('locked'))
      || walked.entries.some((e) => e.name === 'locked');
    expect(sawIt).toBe(true);
  });

  it('readHead reads only the requested prefix', async () => {
    const site = makeSite('head', { muPlugins: { 'big.php': 'ABCDEFGHIJ'.repeat(100) } });
    const src = new LocalFileSource(path.join(site.path, 'app', 'public'));
    const head = await src.readHead('wp-content/mu-plugins/big.php', 4);
    expect(head?.length).toBe(4);
    expect(head?.toString()).toBe('ABCD');
  });
});

describe('FS-01 over bytes', () => {
  const scan = (site: any) => {
    const r = resolveScanRoot(site);
    if (!r.ok) throw new Error('unresolvable');
    return checkMuPlugins(new LocalFileSource(r.webRoot), r.muPluginDir, KNOWN_MU_PLUGINS);
  };

  it('flags an unexpected mu-plugin', async () => {
    const res = await scan(makeSite('hit', { muPlugins: { 'evil.php': '<?php eval($_POST[1]);' } }));
    expect(res.ok).toBe(true);
    expect(res.unexpected.map((u) => u.name)).toEqual(['evil.php']);
    expect(res.unexpected[0].sizeBytes).toBeGreaterThan(0);
  });

  it('does not flag files this addon and the host install', async () => {
    // The allowlist omitting our own nexus-hub-bridge.php produced a CRITICAL on 15 of 15 sites.
    const res = await scan(makeSite('clean', {
      muPlugins: {
        'nexus-hub-bridge.php': '<?php',
        'nexus-ai-connector-config.php': '<?php',
        'site-compat-layer.php': '<?php',
        'wpe-cache-plugin.php': '<?php',
      },
    }));
    expect(res.unexpected).toHaveLength(0);
    expect(res.examined).toBe(4);
  });

  it('treats an absent mu-plugins directory as absent, not as clean', async () => {
    const res = await scan(makeSite('nomu'));
    expect(res.ok).toBe(true);
    expect(res.absent).toBe(true);
  });

  it('ignores non-PHP files, matching the original glob', async () => {
    const res = await scan(makeSite('mixed', { muPlugins: { 'readme.txt': 'x', 'a.php': '<?php' } }));
    expect(res.examined).toBe(1);
    expect(res.unexpected.map((u) => u.name)).toEqual(['a.php']);
  });

  it('declares its own blind spots rather than implying full coverage', async () => {
    const res = await scan(makeSite('gaps', { muPlugins: { 'a.php': '<?php' } }));
    expect(res.knownGaps.join(' ')).toMatch(/non-recursive/);
    expect(res.knownGaps.join(' ')).toMatch(/only \*\.php/);
  });

  it('does NOT yet see a payload in a subdirectory — pinned, not accidental', async () => {
    // Reproduces the current wp_eval behaviour exactly so a port bug is distinguishable from a
    // detection change. Widening this is a separate, labelled commit.
    const res = await scan(makeSite('nested', { muPlugins: { 'sub/payload.php': '<?php eval(1);' } }));
    expect(res.unexpected).toHaveLength(0);
  });
});

describe('scanLocalSite reports coverage, never bare silence', () => {
  it('names what it checked and what it did not', async () => {
    const report = await scanLocalSite(makeSite('rep', { muPlugins: { 'a.php': '<?php' } }));
    expect(report.checks.muPlugins?.unexpected).toHaveLength(1);
    expect(report.coverage.join(' ')).toMatch(/mu-plugins/);
    expect(report.notChecked.join(' ')).toMatch(/database contents/);
    expect(report.notChecked.join(' ')).toMatch(/checksums/);
  });

  it('marks an unresolvable site unscannable instead of clean', async () => {
    const report = await scanLocalSite(makeSite('shell2', { wordpress: false }));
    expect(report.unscannable?.reason).toBe('not-wordpress');
    expect(report.checks.muPlugins).toBeUndefined();
    expect(report.notChecked.join(' ')).toMatch(/everything/);
  });

  it('needs no running site and executes nothing', async () => {
    // The whole point: today Tier 2 starts the compromised site and clones it (which runs
    // wp search-replace four times) before inspecting anything.
    const report = await scanLocalSite(makeSite('fast', { muPlugins: { 'a.php': '<?php' } }));
    expect(report.durationMs).toBeLessThan(2000);
    expect(report.webRoot).toContain('app/public');
  });
});

describe('The two allowlists agree', () => {
  it('matches the agent bundle, which cannot import from src/', () => {
    const agent = require('../../../agents/security-sentinel/agent');
    const fromAgent: string[] = agent._test.KNOWN_MU_PLUGINS;
    expect([...KNOWN_MU_PLUGINS].sort()).toEqual([...fromAgent].sort());
  });
});
