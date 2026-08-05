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
  scanFilesystem(new LocalFileSource(pub), { contentDir: 'wp-content', knownRootPhp: KNOWN_ROOT_PHP });

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsscan-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('FS-02 obfuscation', () => {
  it.each([
    ['eval(base64_decode',           '<?php eval(base64_decode("x"));'],
    ['eval(str_rot13',               '<?php eval(str_rot13("x"));'],
    ['eval($',                       '<?php eval($x);'],
    ['create_function(',             '<?php create_function("", "");'],
    ['assert($',                     '<?php assert($x);'],
  ])('matches %s', async (label, body) => {
    const { pub } = site({ 'wp-content/plugins/p/a.php': body });
    const r = await run(pub);
    expect(r.obfuscation).toHaveLength(1);
    expect(r.obfuscation[0].pattern).toBe(label);
  });

  it('matches base64_decode twice across NEWLINES — the dotAll pattern', async () => {
    // PHP's /s. In JS a bare `.` does not cross newlines, so this needs [\s\S] — getting it
    // wrong silently loses the pattern that produces 317 of the 581 fleet hits.
    const { pub } = site({ 'wp-content/plugins/p/a.php': '<?php\n$a = base64_decode("x");\n$b = base64_decode("y");\n' });
    const r = await run(pub);
    expect(r.obfuscation[0].pattern).toBe('base64_decode..base64_decode');
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
    const { pub } = site({ 'wp-content/plugins/p/a.php': '<?php eval(base64_decode("x")); eval($y); assert($z);' });
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
    expect(r.knownIssues.join(' ')).toMatch(/581 hits across 33 clean sites/);
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
      contentDir: 'wp-content', knownRootPhp: KNOWN_ROOT_PHP, limit: 5,
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
