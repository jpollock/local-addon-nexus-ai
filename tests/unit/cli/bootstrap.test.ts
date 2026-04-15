/**
 * Bootstrap System Tests
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock fs module
jest.mock('fs');
jest.mock('child_process');

import * as fs from 'fs';
import { getLocalPaths } from '../../../src/cli/bootstrap/paths';
import { isLocalInstalled } from '../../../src/cli/bootstrap/process';
import { readConnectionInfo } from '../../../src/cli/bootstrap/graphql';
import { isAddonInstalled, isAddonActivated } from '../../../src/cli/bootstrap/addon';

describe('Bootstrap System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLocalPaths', () => {
    it('should return paths for macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const paths = getLocalPaths();

      expect(paths.dataDir).toContain('Library/Application Support/Local');
      expect(paths.appExecutable).toBe('/Applications/Local.app');
      expect(paths.appName).toBe('Local');
      expect(paths.addonsDir).toContain('addons');
      expect(paths.enabledAddonsFile).toContain('enabled-addons.json');
      expect(paths.graphqlConnectionInfoFile).toContain('graphql-connection-info.json');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('should return paths for Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const paths = getLocalPaths();

      expect(paths.dataDir).toMatch(/AppData.*Local/);
      expect(paths.appExecutable).toMatch(/Local\.exe$/);
      expect(paths.appName).toBe('Local.exe');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('should return paths for Linux', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const paths = getLocalPaths();

      expect(paths.dataDir).toContain('.config/Local');
      expect(paths.appName).toBe('local');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('isLocalInstalled', () => {
    it('should return true if Local.app exists on macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = isLocalInstalled();
      expect(result).toBe(true);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('should return false if Local.app does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = isLocalInstalled();
      expect(result).toBe(false);
    });
  });

  describe('readConnectionInfo', () => {
    const mockConnectionInfo = {
      url: 'http://127.0.0.1:50001/graphql',
      subscriptionUrl: 'ws://127.0.0.1:50001/graphql',
      port: 50001,
      authToken: 'test-token-123',
    };

    it('should read connection info from file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConnectionInfo));

      const result = readConnectionInfo();

      expect(result).toEqual(mockConnectionInfo);
    });

    it('should return null if file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = readConnectionInfo();

      expect(result).toBeNull();
    });

    it('should return null if file is invalid JSON', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const result = readConnectionInfo();

      expect(result).toBeNull();
    });
  });

  describe('isAddonInstalled', () => {
    it('should return true if addon directory exists', () => {
      (fs.lstatSync as jest.Mock).mockReturnValue({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      });

      const result = isAddonInstalled();

      expect(result).toBe(true);
    });

    it('should return true if addon symlink exists', () => {
      (fs.lstatSync as jest.Mock).mockReturnValue({
        isDirectory: () => false,
        isSymbolicLink: () => true,
      });

      const result = isAddonInstalled();

      expect(result).toBe(true);
    });

    it('should return false if addon does not exist', () => {
      (fs.lstatSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = isAddonInstalled();

      expect(result).toBe(false);
    });
  });

  describe('isAddonActivated', () => {
    const mockEnabledAddons = {
      '@local-labs-jpollock/local-addon-nexus-ai': true,
      'other-addon': false,
    };

    it('should return true if addon is enabled', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockEnabledAddons));

      const result = isAddonActivated();

      expect(result).toBe(true);
    });

    it('should return false if addon is not in enabled-addons.json', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ 'other-addon': true }));

      const result = isAddonActivated();

      expect(result).toBe(false);
    });

    it('should return false if enabled-addons.json does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = isAddonActivated();

      expect(result).toBe(false);
    });

    it('should return false if enabled-addons.json is invalid', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const result = isAddonActivated();

      expect(result).toBe(false);
    });
  });
});
