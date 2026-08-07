// tests/unit/sentinel/filesystem-scan.test.ts
//
// Slice 2: FS-02, FS-03, FS-04 and FS-06 over ONE walk, in Node, against a stopped site.
//
// Detection is reproduced EXACTLY, quirks included. Verified against a golden baseline captured
// from the current wp_eval semantics across 33 real installs and 82,068 PHP files: 33 of 33
// sites match on all four checks. These tests pin the quirks so a later, deliberate fix to the
// pattern set is distinguishable from a port bug.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalFileSource } from '../../../src/main/sentinel/scanner/LocalFileSource';
import { scanFilesystem, _internals } from '../../../src/main/sentinel/scanner/checks/filesystem';
import { KNOWN_ROOT_PHP, scanLocalSite } from '../../../src/main/sentinel/scanner';

let tmp: string;

function site(files: Record<string, string | Buffer>) {
  const sitePath = path.join(tmp, 'site-' + Math.random().toString(36).slice(2));
  const pub = path.join(sitePath, 'app', 'public');
  fs.mkdirSync(path.join(pub, 'wp-includes'), { recursive: true });
  fs.writeFileSync(path.join(pub, 'wp-includes', 'version.php'), "<?php $wp_version = '6.9.4';");
  fs.writeFileSync(path.join(pub, 'wp-config.php'), "<?php $table_prefix = 'wp_';");
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(pub, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body as any);
  }
  return { rec: { id: 'x', name: 'x', path: sitePath }, pub };
}

const run = (pub: string) =>
  scanFilesystem(new LocalFileSource(pub), { contentDir: 'wp-content', pluginDir: 'wp-content/plugins', knownRootPhp: KNOWN_ROOT_PHP });

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsscan-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('FS-02 obfuscation', () => {
  // MUST CATCH — the malicious shapes. Measured: every one of these fires, and the set as a
  // whole produces 20 hits across 82,068 real PHP files (was 581).
  it.each([
    ['eval(base64_decode',                 '<?php eval(base64_decode("ZWNobyAxOw=="));'],
    ['eval(gzinflate(base64_decode',       '<?php eval(gzinflate(base64_decode("x")));'],
    ['eval(str_rot13',                     '<?php eval(str_rot13("rpub 1;"));'],
    ['eval($',                             '<?php $c="system"; eval($payload);'],
    ['nested decode',                      '<?php $x = base64_decode(base64_decode("dGVzdA=="));'],
    ['nested decode',                      '<?php echo base64_decode(str_rot13("x"));'],
    ['decoded value into execution sink',  '<?php assert(base64_decode("ZWNobyAx"));'],
    ['decoded value into execution sink',  '<?php system(base64_decode($_GET["c"]));'],
  ])('catches %s', async (label, body) => {
    const { pub } = site({ 'wp-content/plugins/p/a.php': body });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(1);
    expect(r.obfuscation[0].pattern).toBe(label);
  });

  // MUST NOT CATCH — the shapes that produced 250 of the 581 findings on clean sites.
  it.each([
    ['an ordinary type assertion',   '<?php assert($i != $numValues - 1);'],
    ['a type assertion with a message', "<?php assert($t instanceof HasFieldsType, 'ensured by validation');"],
    ['an ordinary preg_replace',     "<?php preg_replace('/-template$/', '', $vars['dir']);"],
    ['create_function in legacy code', "<?php create_function('', 'return 1;');"],
    ['a single base64_decode',       '<?php $v = base64_decode($input);'],
    ['base64_decode named in a comment', '<?php // phpcs:ignore ... base64_decode\n$v = base64_decode($x);'],
  ])('does not fire on %s', async (_label, body) => {
    const { pub } = site({ 'wp-content/plugins/p/a.php': body });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(0);
  });

  it('DEAD VECTORS are gone — they caught 0 of 9 malicious shapes and cost 250 findings', () => {
    const labels = _internals.OBFUSCATION_PATTERNS.map((p: any) => p.label);
    // assert()-as-eval needs a string argument, removed in PHP 8; create_function removed in
    // PHP 8; the preg_replace /e modifier removed in PHP 7. None can execute on any PHP this
    // tool targets, and each matched only legitimate code.
    expect(labels).not.toContain('assert($');
    expect(labels).not.toContain('create_function(');
    expect(labels).not.toContain('preg_replace(/e');
  });

  it('KNOWN GAP: two independent adjacent base64_decode calls are no longer matched', async () => {
    // Accepted deliberately. A proximity window that catches this costs 18 false positives at
    // 40 characters and 216 at 100. The malicious form nearly always feeds an execution sink,
    // which the sink pattern catches.
    const { pub } = site({ 'wp-content/plugins/p/a.php': '<?php $a=base64_decode("x");$b=base64_decode("y");' });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(0);
  });

  it('matches inside a file containing invalid UTF-8 bytes', async () => {
    // Honest scope: this passes under latin1 AND utf8 — the patterns are pure ASCII and utf8
    // decoding leaves ASCII bytes alone. Mutation testing proved the encoding choice changes no
    // current result. Kept because a file with binary padding is a realistic shape and the
    // scanner must not throw or skip it; NOT kept as evidence that latin1 is required.
    const body = Buffer.concat([
      Buffer.from('<?php eval(base64_decode("'),
      Buffer.from([0xff, 0xfe, 0x80, 0x81]),
      Buffer.from('"));'),
    ]);
    const { pub } = site({ 'wp-content/plugins/p/a.php': body });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(1);
  });

  it('reports only the first matching pattern per file, as the original does', async () => {
    const { pub } = site({ 'wp-content/plugins/p/a.php': '<?php eval(base64_decode("x")); eval($y);' });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(1);
  });

  it('scans plugins, mu-plugins and themes — and nothing else', async () => {
    const { pub } = site({
      'wp-content/plugins/p/a.php':    '<?php eval($x);',
      'wp-content/mu-plugins/b.php':   '<?php eval($x);',
      'wp-content/themes/t/c.php':     '<?php eval($x);',
      'wp-content/uploads/d.php':      '<?php eval($x);',   // FS-04's territory, not FS-02's
    });
    const r = await run(pub);
    expect(r.obfuscation.map((h) => h.file).sort()).toEqual([
      'wp-content/mu-plugins/b.php', 'wp-content/plugins/p/a.php', 'wp-content/themes/t/c.php',
    ]);
  });

  it('skips files over 5 MB, as the original does', async () => {
    const big = Buffer.concat([Buffer.from('<?php eval($x);'), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const { pub } = site({ 'wp-content/plugins/p/big.php': big });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(0);
    expect(r.phpFilesScanned).toBe(0);
  });

  it('QUIRK PINNED: extension matching is case-sensitive, so evil.PHP is missed', async () => {
    // Reproduced deliberately. FS-06 lowercases and these do not — the original is inconsistent
    // with itself. Fixing it is a labelled follow-up, not a silent change.
    const { pub } = site({ 'wp-content/plugins/p/evil.PHP': '<?php eval($x);' });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(0);
  });
});

describe('FS-03 web root and content', () => {
  it('flags unexpected root PHP but not the known files', async () => {
    const { pub } = site({ 'shell.php': '<?php', 'wp-load.php': '<?php', 'local-xdebuginfo.php': '<?php' });
    const r = await run(pub);
    expect(r.rootAndContent.map((h) => h.path)).toEqual(['shell.php']);
  });

  it('flags obfuscation under languages/ and uploads/', async () => {
    const { pub } = site({
      'wp-content/languages/x.php': '<?php eval(base64_decode("a"));',
      'wp-content/uploads/y.php':   '<?php eval(gzinflate("a"));',
    });
    const r = await run(pub);
    expect(r.rootAndContent.filter((h) => h.reason === 'obfuscated code')).toHaveLength(2);
  });

  it('is not fooled by a root PHP file in a subdirectory', async () => {
    const { pub } = site({ 'wp-admin/thing.php': '<?php' });
    const r = await run(pub);
    expect(r.rootAndContent).toHaveLength(0);
  });
});

describe('FS-04 PHP under uploads', () => {
  it('flags any PHP regardless of content', async () => {
    const { pub } = site({
      'wp-content/uploads/2026/01/x.php': '<?php // entirely innocuous',
      'wp-content/uploads/readme.txt':    'not php',
    });
    const r = await run(pub);
    expect(r.uploadsPhp).toEqual(['wp-content/uploads/2026/01/x.php']);
  });
});

describe('ABS-09 suspicious filenames', () => {
  it('flags a known attacker-tool filename under plugins/', async () => {
    const { pub } = site({ 'wp-content/plugins/ranktool/check_file.php': '<?php echo 1;' });
    const r = await run(pub);
    expect(r.suspiciousFilenames).toEqual(['wp-content/plugins/ranktool/check_file.php']);
  });

  it('is case-insensitive, unlike FS-02/03/04 — the original compares strtolower on both sides', async () => {
    const { pub } = site({ 'wp-content/plugins/x/Check_File.PHP': '<?php echo 1;' });
    const r = await run(pub);
    expect(r.suspiciousFilenames).toEqual(['wp-content/plugins/x/Check_File.PHP']);
  });

  it('does not flag the same filename outside plugins/', async () => {
    const { pub } = site({ 'wp-content/mu-plugins/check_file.php': '<?php echo 1;' });
    const r = await run(pub);
    expect(r.suspiciousFilenames).toHaveLength(0);
  });

  it('does not flag an ordinary plugin filename', async () => {
    const { pub } = site({ 'wp-content/plugins/x/index.php': '<?php echo 1;' });
    const r = await run(pub);
    expect(r.suspiciousFilenames).toHaveLength(0);
  });
});

describe('ABS-08 anti-forensics timestamp manipulation', () => {
  it('flags touch() combined with directory enumeration in one plugin file', async () => {
    const { pub } = site({
      'wp-content/plugins/fileorganizer/backdate.php':
        '<?php function f($d,$t){foreach(scandir($d) as $x) touch($d."/".$x,$t);}',
    });
    const r = await run(pub);
    expect(r.antiForensics).toHaveLength(1);
    expect(r.antiForensics[0].path).toBe('wp-content/plugins/fileorganizer/backdate.php');
  });

  it('does not flag touch() alone', async () => {
    const { pub } = site({ 'wp-content/plugins/x/a.php': '<?php touch($f);' });
    const r = await run(pub);
    expect(r.antiForensics).toHaveLength(0);
  });

  it('does not flag directory enumeration alone', async () => {
    const { pub } = site({ 'wp-content/plugins/x/a.php': '<?php foreach (glob("*") as $f) echo $f;' });
    const r = await run(pub);
    expect(r.antiForensics).toHaveLength(0);
  });

  it('matches on glob() and RecursiveIterator as well as scandir()', async () => {
    const { pub } = site({
      'wp-content/plugins/x/a.php': '<?php touch($f); glob("*");',
      'wp-content/plugins/x/b.php': '<?php touch($f); new RecursiveIterator($d);',
    });
    const r = await run(pub);
    expect(r.antiForensics.map((h) => h.path).sort()).toEqual([
      'wp-content/plugins/x/a.php', 'wp-content/plugins/x/b.php',
    ]);
  });

  it('does not flag the same code outside plugins/', async () => {
    const { pub } = site({
      'wp-content/themes/x/a.php': '<?php touch($f); scandir($d);',
    });
    const r = await run(pub);
    expect(r.antiForensics).toHaveLength(0);
  });
});

describe('FS-06 ELF binaries', () => {
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]);

  it('detects the magic bytes', async () => {
    const { pub } = site({ 'wp-content/uploads/miner': elf });
    const r = await run(pub);
    expect(r.elf).toHaveLength(1);
    expect(r.elf[0].path).toBe('wp-content/uploads/miner');
  });

  it('QUIRK PINNED: an ELF named miner.png is skipped by the extension list', async () => {
    // This is the hole that lets a binary hide behind an image extension. Reproduced on
    // purpose; widening it is a labelled follow-up. All 55 real fleet hits were
    // ewww-image-optimizer's bundled cwebp/gifsicle, so widening also needs a FP story.
    const { pub } = site({ 'wp-content/uploads/miner.png': elf });
    const r = await run(pub);
    expect(r.elf).toHaveLength(0);
  });

  it('lowercases the extension for the skip list, unlike FS-02', async () => {
    const { pub } = site({ 'wp-content/uploads/x.PNG': elf });
    const r = await run(pub);
    expect(r.elf).toHaveLength(0);
  });

  it('does not flag a file that merely starts with ELF text', async () => {
    const { pub } = site({ 'wp-content/uploads/notelf': Buffer.from('ELF but not magic') });
    const r = await run(pub);
    expect(r.elf).toHaveLength(0);
  });
});

describe('Coverage and cost', () => {
  it('declares its own known issues rather than implying full coverage', async () => {
    const { pub } = site({ 'wp-content/plugins/p/a.php': '<?php' });
    const r = await run(pub);
    expect(r.knownIssues.join(' ')).toMatch(/case-sensitively/);
    expect(r.knownIssues.join(' ')).toMatch(/miner\.png/);
    expect(r.knownIssues.join(' ')).toMatch(/adjacent base64_decode/);
  });

  it('the deep walk is OFF by default — 25x the cost of the shallow check', async () => {
    const { rec } = site({ 'wp-content/plugins/p/a.php': '<?php eval($x);' });
    const shallow = await scanLocalSite(rec);
    expect(shallow.checks.filesystem).toBeUndefined();
    expect(shallow.notChecked.join(' ')).toMatch(/deep scan not requested/);

    const deep = await scanLocalSite(rec, { deep: true });
    expect(deep.checks.filesystem?.obfuscation).toHaveLength(1);
  });

  it('reports truncation rather than presenting a partial walk as complete', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`wp-content/plugins/p/f${i}.php`] = '<?php';
    const { pub } = site(files);
    const r = await scanFilesystem(new LocalFileSource(pub), {
      contentDir: 'wp-content', pluginDir: 'wp-content/plugins', knownRootPhp: KNOWN_ROOT_PHP, limit: 5,
    });
    expect(r.truncated).toBe(true);
  });
});

describe('extensionOf matches PHP getExtension()', () => {
  it.each([
    ['a.php', 'php'], ['a.PHP', 'PHP'], ['a.tar.gz', 'gz'], ['noext', ''],
    ['.htaccess', 'htaccess'], ['dir/a.php', 'php'],
  ])('%s -> %s', (input, expected) => {
    expect(_internals.extensionOf(input)).toBe(expected);
  });
});
