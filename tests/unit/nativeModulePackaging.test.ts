import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: { rebuild?: string };
};
const packageAddon = fs.readFileSync(path.join(repoRoot, 'scripts/package-addon.js'), 'utf8');
const autoInstall = fs.readFileSync(path.join(repoRoot, 'scripts/test-auto-install.sh'), 'utf8');

describe('native module packaging targets', () => {
  it('keeps every Local packaging path on Electron 42.2.0 / ABI 146', () => {
    expect(packageJson.scripts.rebuild).toContain('42.2.0');
    expect(packageAddon).toContain("const ELECTRON_VERSION = '42.2.0';");
    expect(packageAddon).toContain("'-v', ELECTRON_VERSION");
    expect(packageAddon).not.toContain('37.8.0');
    expect(autoInstall).toContain('electron-rebuild -v 42.2.0');
    expect(autoInstall).toContain('MODULE_VERSION 146');
    expect(autoInstall).not.toContain('37.8.0');
    expect(autoInstall).not.toContain('MODULE_VERSION 136');
  });
});
