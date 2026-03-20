/**
 * Bootstrap System Tests
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock child_process before importing modules
jest.mock('child_process');
const mockExec = jest.fn();
const mockExecSync = jest.fn();
jest.requireMock('child_process').exec = mockExec;
jest.requireMock('child_process').execSync = mockExecSync;

import { getLocalPaths } from '../../../src/cli/bootstrap/paths';
import { isLocalInstalled, isLocalRunning } from '../../../src/cli/bootstrap/process';
import { readConnectionInfo } from '../../../src/cli/bootstrap/graphql';
import { isAddonInstalled, isAddonActivated } from '../../../src/cli/bootstrap/addon';

describe('Bootstrap System', () => {
  describe('getLocalPaths', () => {
    it('should return paths for macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const paths = getLocalPaths();

      expect(paths.dataDir).toContain('Library/Application Support/Local');
      expect(paths.appExecutable).toBe('/Applications/Local.app');
      expect(paths.appName).toBe('Local');
      expect(paths.addonsDir).toContain('addons');
      expect(paths.enabledAddonsFile).toContain('enabled-addons.json');
      expect(paths.graphqlConnectionInfoFile).toContain('graphql-connection-info.json');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return paths for Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const paths = getLocalPaths();

      expect(paths.dataDir).toMatch(/AppData.*Local/);
      expect(paths.appExecutable).toMatch(/Local\.exe$/);
      expect(paths.appName).toBe('Local.exe');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return paths for Linux', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const paths = getLocalPaths();

      expect(paths.dataDir).toContain('.config/Local');
      expect(paths.appName).toBe('local');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('isLocalInstalled', () => {
    it('should return true if Local.app exists on macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const result = isLocalInstalled();
      expect(result).toBe(true);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return false if Local.app does not exist', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

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

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should read connection info from file', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockConnectionInfo));

      const result = readConnectionInfo();

      expect(result).toEqual(mockConnectionInfo);
    });

    it('should return null if file does not exist', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = readConnectionInfo();

      expect(result).toBeNull();
    });

    it('should return null if file is invalid JSON', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('invalid json');

      const result = readConnectionInfo();

      expect(result).toBeNull();
    });
  });

  describe('isAddonInstalled', () => {
    it('should return true if addon directory exists', () => {
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      } as any);

      const result = isAddonInstalled();

      expect(result).toBe(true);
    });

    it('should return true if addon symlink exists', () => {
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isDirectory: () => false,
        isSymbolicLink: () => true,
      } as any);

      const result = isAddonInstalled();

      expect(result).toBe(true);
    });

    it('should return false if addon does not exist', () => {
      jest.spyOn(fs, 'lstatSync').mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = isAddonInstalled();

      expect(result).toBe(false);
    });
  });

  describe('isAddonActivated', () => {
    const mockEnabledAddons = {
      '@local/nexus-ai': true,
      'other-addon': false,
    };

    it('should return true if addon is enabled', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockEnabledAddons));

      const result = isAddonActivated();

      expect(result).toBe(true);
    });

    it('should return false if addon is not in enabled-addons.json', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ 'other-addon': true }));

      const result = isAddonActivated();

      expect(result).toBe(false);
    });

    it('should return false if enabled-addons.json does not exist', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = isAddonActivated();

      expect(result).toBe(false);
    });

    it('should return false if enabled-addons.json is invalid', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('invalid json');

      const result = isAddonActivated();

      expect(result).toBe(false);
    });
  });
});
