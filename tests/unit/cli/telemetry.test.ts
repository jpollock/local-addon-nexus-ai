/**
 * Unit tests for CLI telemetry utility
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock fs before importing any module that uses it
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue(
    JSON.stringify({
      installationId: 'test-installation-id',
      secretKey: Buffer.from('test-secret-key-32-bytes-padding!').toString('base64'),
      registeredAt: '2026-01-01T00:00:00.000Z',
      telemetry: { enabled: true, promptedAt: null },
    }),
  ),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
  renameSync: jest.fn(),
}));

import * as fs from 'fs';
import { deriveCommandName, startTracking, finishTracking } from '../../../src/cli/utils/telemetry';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Install global fetch mock
(global as any).fetch = mockFetch;

// Helper to reset module-level tracking state between tests
async function resetTrackingState() {
  // finishTracking resets _startTime and _commandName when called
  // We just need to clear any leftover state by not starting a new tracking session
}

describe('CLI Telemetry', () => {
  const originalEnv = { ...process.env };
  const originalArgv = process.argv;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-install fetch mock since clearAllMocks resets the implementation
    mockFetch.mockResolvedValue(
      new Response('{"success":true}', { status: 200 }),
    );
    (global as any).fetch = mockFetch;

    // Reset env to clean state (no telemetry override, no CI)
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
    // Restore env
    process.env = { ...originalEnv };
    Object.defineProperty(process, 'argv', { value: originalArgv, configurable: true });
  });

  // ============================================================
  // deriveCommandName()
  // ============================================================

  describe('deriveCommandName()', () => {
    it('derives "ai.config" from ai config subcommand', () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'nexus', 'ai', 'config', '--gateway', 'on'],
        configurable: true,
      });
      expect(deriveCommandName()).toBe('ai.config');
    });

    it('derives "sites.list" from sites list subcommand', () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'nexus', 'sites', 'list'],
        configurable: true,
      });
      expect(deriveCommandName()).toBe('sites.list');
    });

    it('derives "ai" from single-word command', () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'nexus', 'ai'],
        configurable: true,
      });
      expect(deriveCommandName()).toBe('ai');
    });

    it('returns "unknown" when only the binary is present', () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'nexus'],
        configurable: true,
      });
      expect(deriveCommandName()).toBe('unknown');
    });

    it('ignores flags and returns "unknown" when only flag args are present', () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'nexus', '--version'],
        configurable: true,
      });
      expect(deriveCommandName()).toBe('unknown');
    });

    it('ignores flags mixed with subcommands', () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'nexus', '--verbose', 'sites', '--json', 'list'],
        configurable: true,
      });
      // After filtering flags: ['sites', 'list'] → first two → 'sites.list'
      expect(deriveCommandName()).toBe('sites.list');
    });

    it('uses only first two non-flag args', () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'nexus', 'one', 'two', 'three'],
        configurable: true,
      });
      expect(deriveCommandName()).toBe('one.two');
    });
  });

  // ============================================================
  // finishTracking() — disabled when NEXUS_TELEMETRY=0
  // ============================================================

  describe('finishTracking() — telemetry disabled', () => {
    it('does not call fetch when NEXUS_TELEMETRY=0', async () => {
      process.env.NEXUS_TELEMETRY = '0';
      startTracking('test.command');
      await finishTracking(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not call fetch when CI=1', async () => {
      process.env.CI = '1';
      startTracking('test.command');
      await finishTracking(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not call fetch when GITHUB_ACTIONS is set', async () => {
      process.env.GITHUB_ACTIONS = 'true';
      startTracking('test.command');
      await finishTracking(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not call fetch when startTracking was never called', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      // Drain any leftover state from a previous test that was interrupted
      // by an env check (CI/disabled) before finishTracking could clear _commandName
      await finishTracking(true); // first call: clears any leftover state OR is a no-op
      mockFetch.mockClear();

      // Now there is definitely no tracking state — calling finishTracking should not fire fetch
      await finishTracking(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // finishTracking() — enabled
  // ============================================================

  describe('finishTracking() — telemetry enabled', () => {
    it('calls fetch when NEXUS_TELEMETRY=1 and config is valid', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('sites.list');
      await finishTracking(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('sends correct headers — X-Installation-Id and X-Signature', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('sites.list');
      await finishTracking(true);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['X-Installation-Id']).toBe('test-installation-id');
      expect(headers['X-Signature']).toBeTruthy();
      expect(typeof headers['X-Signature']).toBe('string');
      expect(headers['X-Signature'].length).toBeGreaterThan(0);
    });

    it('sends access_method: "cli" in request body', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('ai.config');
      await finishTracking(true);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body.access_method).toBe('cli');
    });

    it('sends tool_name matching what was passed to startTracking', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('fleet.search');
      await finishTracking(true);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body.tool_name).toBe('fleet.search');
    });

    it('sends correct success flag in body', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('test.cmd');
      await finishTracking(false);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.success).toBe(false);
    });

    it('includes error_category in body when provided', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('test.cmd');
      await finishTracking(false, 'network_error');

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.error_category).toBe('network_error');
    });

    it('omits error_category from body when not provided', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('test.cmd');
      await finishTracking(true);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.error_category).toBeUndefined();
    });
  });

  // ============================================================
  // Endpoint URL correctness (regression: undefined/v1/events bug)
  // ============================================================

  describe('Endpoint URL correctness', () => {
    it('sends request to correct endpoint URL (not undefined/v1/events)', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('sites.list');
      await finishTracking(true);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];

      expect(url).toContain('analytics.elasticapi.io/v1/events');
      expect(url).not.toContain('undefined/v1/events');
      expect(url).not.toContain('null/v1/events');
    });

    it('endpoint starts with https://', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('sites.list');
      await finishTracking(true);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/^https:\/\//);
    });
  });

  // ============================================================
  // Config reading — installationId from config file
  // ============================================================

  describe('Config reading', () => {
    it('passes installationId from config file in X-Installation-Id header', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      startTracking('test.cmd');
      await finishTracking(true);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Installation-Id']).toBe('test-installation-id');
    });

    it('does not call fetch when config has no installationId', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      (fs.readFileSync as jest.Mock).mockReturnValueOnce(
        JSON.stringify({ telemetry: { enabled: true } }),
      );
      startTracking('test.cmd');
      await finishTracking(true);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not call fetch when config file does not exist', async () => {
      process.env.NEXUS_TELEMETRY = '1';
      (fs.existsSync as jest.Mock).mockReturnValueOnce(false);
      startTracking('test.cmd');
      await finishTracking(true);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
