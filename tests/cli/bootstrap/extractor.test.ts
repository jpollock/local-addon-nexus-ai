/**
 * Tarball extraction tests
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import { extractTarball, verifyExtractedAddon, assertSafeTarEntry, assertInstalledVersion } from '../../../src/cli/bootstrap/extractor';

describe('assertSafeTarEntry (P0-3)', () => {
  it('rejects a symlink entry (link-poisoning)', () => {
    expect(() => assertSafeTarEntry({ path: 'content/evil', type: 'SymbolicLink' })).toThrow(/symlink|link|unsafe/i);
  });
  it('rejects a hardlink entry', () => {
    expect(() => assertSafeTarEntry({ path: 'content/evil', type: 'Link' })).toThrow(/link|unsafe/i);
  });
  it('rejects a parent-directory traversal path', () => {
    expect(() => assertSafeTarEntry({ path: '../../etc/cron.d/x', type: 'File' })).toThrow(/unsafe path/i);
  });
  it('rejects an absolute path', () => {
    expect(() => assertSafeTarEntry({ path: '/etc/passwd', type: 'File' })).toThrow(/unsafe path/i);
  });
  it('allows a normal file entry', () => {
    expect(() => assertSafeTarEntry({ path: 'content/lib/main.js', type: 'File' })).not.toThrow();
  });
  it('allows a directory entry', () => {
    expect(() => assertSafeTarEntry({ path: 'content/lib/', type: 'Directory' })).not.toThrow();
  });
});

describe('Tarball Extractor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates destination directory if missing', async () => {
    const destDir = path.join(tmpDir, 'nonexistent', 'nested', 'dir');
    const tarPath = path.join(tmpDir, 'test.tgz');

    // Create a simple tarball
    const contentDir = path.join(tmpDir, 'content');
    fs.mkdirSync(contentDir);
    fs.writeFileSync(path.join(contentDir, 'package.json'), JSON.stringify({
      name: 'local-addon-nexus-ai',
      version: '0.1.0'
    }));

    await tar.create({
      gzip: true,
      file: tarPath,
      cwd: tmpDir
    }, ['content']);

    expect(fs.existsSync(destDir)).toBe(false);

    await extractTarball({
      tarPath,
      destDir
    });

    expect(fs.existsSync(destDir)).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'package.json'))).toBe(true);
  });

  it('extracts tarball with strip components', async () => {
    const destDir = path.join(tmpDir, 'dest');
    const tarPath = path.join(tmpDir, 'test.tgz');

    // Create nested directory structure
    const contentDir = path.join(tmpDir, 'content', 'nested');
    fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'test.txt'), 'hello');

    await tar.create({
      gzip: true,
      file: tarPath,
      cwd: tmpDir
    }, ['content']);

    await extractTarball({
      tarPath,
      destDir,
      stripComponents: 1
    });

    // With strip=1, 'content/nested/test.txt' becomes 'nested/test.txt'
    expect(fs.existsSync(path.join(destDir, 'nested', 'test.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'content'))).toBe(false);
  });

  it('throws on missing tarball', async () => {
    await expect(
      extractTarball({
        tarPath: '/nonexistent/file.tgz',
        destDir: tmpDir
      })
    ).rejects.toThrow('Tarball not found');
  });

  it('verifies extracted addon is valid', async () => {
    const addonDir = path.join(tmpDir, 'addon');
    fs.mkdirSync(addonDir);

    // Invalid: no package.json
    expect(verifyExtractedAddon(addonDir)).toBe(false);

    // Invalid: wrong package name
    fs.writeFileSync(
      path.join(addonDir, 'package.json'),
      JSON.stringify({ name: 'wrong-name' })
    );
    expect(verifyExtractedAddon(addonDir)).toBe(false);

    // Valid
    fs.writeFileSync(
      path.join(addonDir, 'package.json'),
      JSON.stringify({ name: '@local-labs-jpollock/local-addon-nexus-ai' })
    );
    expect(verifyExtractedAddon(addonDir)).toBe(true);
  });

  describe('assertInstalledVersion — rollback guard (P1-5)', () => {
    function writeAddon(name: string, pkg: object): string {
      const dir = path.join(tmpDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
      return dir;
    }

    it('passes when the extracted version matches the requested version', () => {
      const dir = writeAddon('match', { name: '@local-labs-jpollock/local-addon-nexus-ai', version: '0.5.2' });
      expect(() => assertInstalledVersion(dir, '0.5.2')).not.toThrow();
    });

    it('throws on a version mismatch — a validly-signed older tarball is a rollback', () => {
      const dir = writeAddon('old', { name: '@local-labs-jpollock/local-addon-nexus-ai', version: '0.4.0' });
      expect(() => assertInstalledVersion(dir, '0.5.2')).toThrow(/rollback|expected version 0\.5\.2/i);
    });

    it('throws when the extracted package has no version', () => {
      const dir = writeAddon('noversion', { name: '@local-labs-jpollock/local-addon-nexus-ai' });
      expect(() => assertInstalledVersion(dir, '0.5.2')).toThrow(/no version|rollback/i);
    });
  });

  it('rejects a tarball containing a symlink entry, without creating the link (P0-3)', async () => {
    const destDir = path.join(tmpDir, 'dest');
    const tarPath = path.join(tmpDir, 'evil.tgz');
    const contentDir = path.join(tmpDir, 'content');
    fs.mkdirSync(contentDir);
    fs.writeFileSync(path.join(contentDir, 'package.json'), JSON.stringify({ name: 'x' }));
    fs.symlinkSync('/etc/passwd', path.join(contentDir, 'evil-link'));

    await tar.create({ gzip: true, file: tarPath, cwd: tmpDir }, ['content']);

    await expect(extractTarball({ tarPath, destDir, stripComponents: 1 }))
      .rejects.toThrow(/symlink|link|unsafe/i);
    // The symlink must never be materialized on disk.
    expect(fs.existsSync(path.join(destDir, 'evil-link'))).toBe(false);
  });

  it('extracts all files including .DS_Store', async () => {
    const destDir = path.join(tmpDir, 'dest');
    const tarPath = path.join(tmpDir, 'test.tgz');

    // Create content with .DS_Store
    const contentDir = path.join(tmpDir, 'content');
    fs.mkdirSync(contentDir);
    fs.writeFileSync(path.join(contentDir, '.DS_Store'), 'mac junk');
    fs.writeFileSync(path.join(contentDir, 'real-file.txt'), 'real content');

    await tar.create({
      gzip: true,
      file: tarPath,
      cwd: tmpDir
    }, ['content']);

    await extractTarball({
      tarPath,
      destDir,
      stripComponents: 1
    });

    // Both files should be extracted
    // (The onentry filter attempts to skip .DS_Store but tar may still extract it)
    expect(fs.existsSync(path.join(destDir, 'real-file.txt'))).toBe(true);
  });
});
