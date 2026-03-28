/**
 * Unit tests for telemetry-config.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// mockFs must be declared before jest.mock() calls so that the factory closure
// captures it (hoisting means the factory runs before variable init otherwise).
// We work around hoisting by using a factory that returns a stable reference.

const mockFs = {
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
  renameSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  unlinkSync: jest.fn(),
};

jest.mock('fs', () => mockFs);

import * as fs from 'fs';
import {
  readConfig,
  writeConfig,
  isTelemetryEnabled,
  getAnalyticsEndpoint,
  generateInstallationId,
  generateSecretKey,
  TelemetryConfig,
} from '../../../src/main/telemetry/telemetry-config';

// ============================================================
// Helpers
// ============================================================

function makeValidConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    installationId: 'test-uuid-1234',
    secretKey: Buffer.from('test-secret-key-32-bytes-padding!').toString('base64'),
    telemetry: { enabled: true, promptedAt: null },
    ...overrides,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================
// Tests
// ============================================================

describe('telemetry-config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: directory does not exist, file does not exist
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.chmodSync.mockReturnValue(undefined);
    mockFs.renameSync.mockReturnValue(undefined);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.appendFileSync.mockReturnValue(undefined);
    mockFs.unlinkSync.mockReturnValue(undefined);

    // Reset env vars to avoid cross-test contamination
    delete process.env.NEXUS_TELEMETRY;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITLAB_CI;
    delete process.env.JENKINS_URL;
    delete process.env.TRAVIS;
    delete process.env.CIRCLECI;
    delete process.env.BUILDKITE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ============================================================
  // readConfig() — generates and persists on first call
  // ============================================================

  describe('readConfig() — first generation', () => {
    it('returns a config with installationId and secretKey when no file exists', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config = readConfig();

      expect(config.installationId).toBeTruthy();
      expect(config.secretKey).toBeTruthy();
      expect(typeof config.telemetry.enabled).toBe('boolean');
    });

    it('persists config to disk on first generation (calls writeFileSync or renameSync)', () => {
      mockFs.existsSync.mockReturnValue(false);

      readConfig();

      // writeConfig performs: writeFileSync → chmodSync → renameSync
      // At minimum, renameSync (atomic write) should have been called
      expect(mockFs.renameSync).toHaveBeenCalledTimes(1);
    });

    it('generates a valid UUID for installationId', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config = readConfig();

      expect(config.installationId).toMatch(UUID_RE);
    });

    it('generates a base64 secretKey', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config = readConfig();

      // Should be valid base64 (32 random bytes → 44-char base64 string)
      expect(typeof config.secretKey).toBe('string');
      expect(config.secretKey.length).toBeGreaterThan(0);
      expect(() => Buffer.from(config.secretKey, 'base64')).not.toThrow();
    });

    it('defaults telemetry.enabled to true (opt-out model)', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config = readConfig();

      expect(config.telemetry.enabled).toBe(true);
    });
  });

  // ============================================================
  // readConfig() — returns existing config from file
  // ============================================================

  describe('readConfig() — file exists', () => {
    it('returns config from file when it exists and is valid', () => {
      const valid = makeValidConfig();
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(valid));

      const config = readConfig();

      expect(config.installationId).toBe('test-uuid-1234');
      expect(config.telemetry.enabled).toBe(true);
    });

    it('returns the same installationId on repeated calls when file exists', () => {
      const valid = makeValidConfig();
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(valid));

      const config1 = readConfig();
      const config2 = readConfig();

      expect(config1.installationId).toBe(config2.installationId);
      expect(config1.installationId).toBe('test-uuid-1234');
    });

    it('does not call writeConfig when file is already complete', () => {
      const valid = makeValidConfig();
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(valid));

      readConfig();

      expect(mockFs.renameSync).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // readConfig() — handles corrupted/invalid config
  // ============================================================

  describe('readConfig() — corrupted config', () => {
    it('generates fresh config when file contains invalid JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not valid json {{{');

      const config = readConfig();

      expect(config.installationId).toBeTruthy();
      expect(config.installationId).toMatch(UUID_RE);
      expect(config.secretKey).toBeTruthy();
    });

    it('generates fresh config when readFileSync throws', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const config = readConfig();

      expect(config.installationId).toBeTruthy();
      expect(config.telemetry.enabled).toBe(true);
    });

    it('generates fresh config when file is missing telemetry.enabled', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ installationId: 'old-id', secretKey: 'some-key' }),
      );

      const config = readConfig();

      // Missing telemetry.enabled means the config is not recognised as valid
      expect(config.installationId).toBeTruthy();
      expect(config.telemetry.enabled).toBe(true);
    });

    it('adds missing installationId to existing valid config and persists it', () => {
      // Config has telemetry but no installationId — migration path
      const partial = {
        secretKey: Buffer.from('test-secret-key-32-bytes-padding!').toString('base64'),
        telemetry: { enabled: false, promptedAt: null },
      };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(partial));

      const config = readConfig();

      expect(config.installationId).toBeTruthy();
      // Should have persisted the updated config
      expect(mockFs.renameSync).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // writeConfig() — atomic write with 0600 permissions
  // ============================================================

  describe('writeConfig()', () => {
    it('calls chmodSync with 0o600 on the temp file', () => {
      mockFs.existsSync.mockReturnValue(true); // dir exists

      const config = makeValidConfig();
      writeConfig(config);

      expect(mockFs.chmodSync).toHaveBeenCalledTimes(1);
      expect(mockFs.chmodSync).toHaveBeenCalledWith(expect.any(String), 0o600);
    });

    it('calls renameSync for atomic write (temp → final path)', () => {
      mockFs.existsSync.mockReturnValue(true);

      const config = makeValidConfig();
      writeConfig(config);

      expect(mockFs.renameSync).toHaveBeenCalledTimes(1);
      const [tmpPath, finalPath] = mockFs.renameSync.mock.calls[0] as [string, string];
      expect(tmpPath).toContain('.tmp');
      expect(finalPath).not.toContain('.tmp');
      expect(finalPath).toContain('config.json');
    });

    it('writes valid JSON to the temp file', () => {
      mockFs.existsSync.mockReturnValue(true);

      const config = makeValidConfig();
      writeConfig(config);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const [, content] = mockFs.writeFileSync.mock.calls[0] as [string, string, string];
      const parsed = JSON.parse(content);
      expect(parsed.installationId).toBe('test-uuid-1234');
    });

    it('creates directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false); // dir missing

      const config = makeValidConfig();
      writeConfig(config);

      expect(mockFs.mkdirSync).toHaveBeenCalledTimes(1);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true }),
      );
    });
  });

  // ============================================================
  // isTelemetryEnabled() — env var and config-based control
  // ============================================================

  describe('isTelemetryEnabled()', () => {
    // NOTE: ENV_TELEMETRY is captured at module load time in the source file.
    // We test isTelemetryEnabled() with config-based values and CI env vars
    // (which are read dynamically via process.env[v]). The module-level
    // ENV_TELEMETRY constant will reflect whatever NEXUS_TELEMETRY was at
    // module import time (undefined in this test suite), so we test the
    // config-based and CI branches here.

    it('returns false when a CI env var is set (CI=true)', () => {
      process.env.CI = 'true';
      // Use a config with enabled: true to confirm CI takes precedence
      const valid = makeValidConfig({ telemetry: { enabled: true, promptedAt: null } });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(valid));

      expect(isTelemetryEnabled()).toBe(false);
    });

    it('returns false when GITHUB_ACTIONS is set', () => {
      process.env.GITHUB_ACTIONS = 'true';
      mockFs.existsSync.mockReturnValue(false);

      expect(isTelemetryEnabled()).toBe(false);
    });

    it('returns false when CIRCLECI is set', () => {
      process.env.CIRCLECI = 'true';
      mockFs.existsSync.mockReturnValue(false);

      expect(isTelemetryEnabled()).toBe(false);
    });

    it('returns true when config has enabled: true and no CI env', () => {
      const valid = makeValidConfig({ telemetry: { enabled: true, promptedAt: null } });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(valid));

      expect(isTelemetryEnabled()).toBe(true);
    });

    it('returns false when config has enabled: false and no CI env', () => {
      const valid = makeValidConfig({ telemetry: { enabled: false, promptedAt: null } });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(valid));

      expect(isTelemetryEnabled()).toBe(false);
    });

    it('returns true when no config exists and no CI env (opt-out default)', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(isTelemetryEnabled()).toBe(true);
    });
  });

  // ============================================================
  // getAnalyticsEndpoint()
  // ============================================================

  describe('getAnalyticsEndpoint()', () => {
    it('returns default endpoint when env var not set', () => {
      const endpoint = getAnalyticsEndpoint();
      expect(endpoint).toContain('analytics.elasticapi.io/v1/events');
    });

    it('does not return undefined/v1/events (regression)', () => {
      const endpoint = getAnalyticsEndpoint();
      expect(endpoint).not.toContain('undefined/v1/events');
      expect(endpoint).not.toContain('null/v1/events');
    });

    it('starts with https://', () => {
      const endpoint = getAnalyticsEndpoint();
      expect(endpoint).toMatch(/^https:\/\//);
    });
  });

  // ============================================================
  // generateInstallationId() and generateSecretKey()
  // ============================================================

  describe('generateInstallationId()', () => {
    it('generates a valid UUID v4', () => {
      const id = generateInstallationId();
      expect(id).toMatch(UUID_RE);
    });

    it('generates unique IDs on each call', () => {
      const id1 = generateInstallationId();
      const id2 = generateInstallationId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateSecretKey()', () => {
    it('generates a non-empty base64 string', () => {
      const key = generateSecretKey();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    it('generates 32 bytes of entropy (44 base64 chars)', () => {
      const key = generateSecretKey();
      const bytes = Buffer.from(key, 'base64');
      expect(bytes.length).toBe(32);
    });

    it('generates unique keys on each call', () => {
      const key1 = generateSecretKey();
      const key2 = generateSecretKey();
      expect(key1).not.toBe(key2);
    });
  });
});
