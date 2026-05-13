import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectAtlasSearch, shouldAutoInstallAtlasSearch } from '../../../src/main/content/lifecycle-hooks';

describe('detectAtlasSearch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-atlas-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when atlas-search.php exists', () => {
    const pluginDir = path.join(
      tmpDir, 'app', 'public', 'wp-content', 'plugins', 'atlas-search',
    );
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'atlas-search.php'), '<?php // stub');

    expect(detectAtlasSearch(tmpDir)).toBe(true);
  });

  it('returns false when plugin directory is absent', () => {
    expect(detectAtlasSearch(tmpDir)).toBe(false);
  });

  it('returns false when plugin directory exists but atlas-search.php is missing', () => {
    const pluginDir = path.join(
      tmpDir, 'app', 'public', 'wp-content', 'plugins', 'atlas-search',
    );
    fs.mkdirSync(pluginDir, { recursive: true });

    expect(detectAtlasSearch(tmpDir)).toBe(false);
  });

  it('returns false for a different plugin in the directory', () => {
    const pluginDir = path.join(
      tmpDir, 'app', 'public', 'wp-content', 'plugins', 'some-other-plugin',
    );
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'some-other-plugin.php'), '<?php // stub');

    expect(detectAtlasSearch(tmpDir)).toBe(false);
  });
});

describe('shouldAutoInstallAtlasSearch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-autoinstall-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when site has AI config and atlas-search is absent', () => {
    expect(shouldAutoInstallAtlasSearch(tmpDir, 'site1', { site1: { provider: 'anthropic' } })).toBe(true);
  });

  it('returns false when atlas-search is already installed', () => {
    const pluginDir = path.join(tmpDir, 'app', 'public', 'wp-content', 'plugins', 'atlas-search');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'atlas-search.php'), '<?php // stub');

    expect(shouldAutoInstallAtlasSearch(tmpDir, 'site1', { site1: { provider: 'anthropic' } })).toBe(false);
  });

  it('returns false when site has no AI config', () => {
    expect(shouldAutoInstallAtlasSearch(tmpDir, 'site1', {})).toBe(false);
  });

  it('returns false when AI config exists for a different site', () => {
    expect(shouldAutoInstallAtlasSearch(tmpDir, 'site1', { site2: { provider: 'anthropic' } })).toBe(false);
  });
});
