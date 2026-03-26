/**
 * Addon installation and version management tests
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getAddonPath,
  isAddonInstalled,
  getInstalledAddonVersion,
  isDevAddon,
  isAddonActivated,
  activateAddon
} from '../../../src/cli/bootstrap/addon';

// Mock paths to use temp directory
jest.mock('../../../src/cli/bootstrap/paths', () => ({
  getLocalPaths: () => ({
    addonsDir: path.join(os.tmpdir(), 'nexus-test-addons'),
    enabledAddonsFile: path.join(os.tmpdir(), 'nexus-test-enabled-addons.json')
  }),
  ADDON_PACKAGE_NAME: 'local-addon-nexus-ai',
  ADDON_DIR_NAME: 'local-addon-nexus-ai'
}));

describe('Addon Installation', () => {
  const testAddonsDir = path.join(os.tmpdir(), 'nexus-test-addons');
  const testAddonPath = path.join(testAddonsDir, 'local-addon-nexus-ai');
  const testEnabledAddonsFile = path.join(os.tmpdir(), 'nexus-test-enabled-addons.json');

  beforeEach(() => {
    // Clean up test directories
    if (fs.existsSync(testAddonsDir)) {
      fs.rmSync(testAddonsDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testEnabledAddonsFile)) {
      fs.unlinkSync(testEnabledAddonsFile);
    }
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testAddonsDir)) {
      fs.rmSync(testAddonsDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testEnabledAddonsFile)) {
      fs.unlinkSync(testEnabledAddonsFile);
    }
  });

  describe('isAddonInstalled', () => {
    it('returns false when addon not installed', () => {
      expect(isAddonInstalled()).toBe(false);
    });

    it('returns true when addon directory exists', () => {
      fs.mkdirSync(testAddonPath, { recursive: true });
      expect(isAddonInstalled()).toBe(true);
    });

    it('returns true when addon is symlink', () => {
      fs.mkdirSync(testAddonsDir, { recursive: true });
      const targetDir = path.join(os.tmpdir(), 'nexus-dev-addon');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.symlinkSync(targetDir, testAddonPath);

      expect(isAddonInstalled()).toBe(true);

      // Cleanup
      fs.rmSync(targetDir, { recursive: true, force: true });
    });
  });

  describe('getInstalledAddonVersion', () => {
    it('returns null when addon not installed', () => {
      expect(getInstalledAddonVersion()).toBe(null);
    });

    it('returns null when package.json missing', () => {
      fs.mkdirSync(testAddonPath, { recursive: true });
      expect(getInstalledAddonVersion()).toBe(null);
    });

    it('returns version from package.json', () => {
      fs.mkdirSync(testAddonPath, { recursive: true });
      fs.writeFileSync(
        path.join(testAddonPath, 'package.json'),
        JSON.stringify({ version: '0.1.0' })
      );

      expect(getInstalledAddonVersion()).toBe('0.1.0');
    });

    it('returns null when package.json invalid', () => {
      fs.mkdirSync(testAddonPath, { recursive: true });
      fs.writeFileSync(
        path.join(testAddonPath, 'package.json'),
        'invalid json'
      );

      expect(getInstalledAddonVersion()).toBe(null);
    });
  });

  describe('isDevAddon', () => {
    it('returns false when addon not installed', () => {
      expect(isDevAddon()).toBe(false);
    });

    it('returns false when addon is directory', () => {
      fs.mkdirSync(testAddonPath, { recursive: true });
      expect(isDevAddon()).toBe(false);
    });

    it('returns true when addon is symlink', () => {
      fs.mkdirSync(testAddonsDir, { recursive: true });
      const targetDir = path.join(os.tmpdir(), 'nexus-dev-addon');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.symlinkSync(targetDir, testAddonPath);

      expect(isDevAddon()).toBe(true);

      // Cleanup
      fs.rmSync(targetDir, { recursive: true, force: true });
    });
  });

  describe('isAddonActivated', () => {
    it('returns false when enabled-addons.json missing', () => {
      expect(isAddonActivated()).toBe(false);
    });

    it('returns false when addon not in enabled-addons.json', () => {
      fs.writeFileSync(testEnabledAddonsFile, JSON.stringify({}));
      expect(isAddonActivated()).toBe(false);
    });

    it('returns false when addon disabled', () => {
      fs.writeFileSync(
        testEnabledAddonsFile,
        JSON.stringify({ 'local-addon-nexus-ai': false })
      );
      expect(isAddonActivated()).toBe(false);
    });

    it('returns true when addon enabled', () => {
      fs.writeFileSync(
        testEnabledAddonsFile,
        JSON.stringify({ 'local-addon-nexus-ai': true })
      );
      expect(isAddonActivated()).toBe(true);
    });
  });

  describe('activateAddon', () => {
    it('creates enabled-addons.json if missing', () => {
      const result = activateAddon();

      expect(result).toBe(true); // Restart needed
      expect(fs.existsSync(testEnabledAddonsFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(testEnabledAddonsFile, 'utf-8'));
      expect(content['local-addon-nexus-ai']).toBe(true);
    });

    it('adds addon to existing enabled-addons.json', () => {
      fs.writeFileSync(
        testEnabledAddonsFile,
        JSON.stringify({ 'some-other-addon': true })
      );

      const result = activateAddon();

      expect(result).toBe(true); // Restart needed
      const content = JSON.parse(fs.readFileSync(testEnabledAddonsFile, 'utf-8'));
      expect(content['local-addon-nexus-ai']).toBe(true);
      expect(content['some-other-addon']).toBe(true);
    });

    it('returns false when already activated', () => {
      fs.writeFileSync(
        testEnabledAddonsFile,
        JSON.stringify({ 'local-addon-nexus-ai': true })
      );

      const result = activateAddon();

      expect(result).toBe(false); // No restart needed
    });
  });
});
