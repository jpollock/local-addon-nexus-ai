/**
 * CLI E2E Tests - Basic Commands
 *
 * Tests the Nexus CLI against production Local.
 * Requires: Production Local running with Nexus AI addon enabled.
 */

import { describe, it, expect } from '@jest/globals';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Path to CLI binary
const CLI_BIN = path.resolve(__dirname, '..', '..', 'bin', 'nexus.js');

/**
 * Execute a CLI command and return stdout, stderr, and exit code
 */
async function runCli(
  command: string,
  stdin?: string,
  timeout: number = 60000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const args = command.split(' ');
    const child = spawn(CLI_BIN, args, {
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // If stdin provided, write it and close
    if (stdin !== undefined) {
      child.stdin.write(stdin + '\n');
      child.stdin.end();
    }

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    child.on('error', (error) => {
      reject(error);
    });

    // Timeout
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI command timed out after ${timeout}ms`));
    }, timeout);

    child.on('exit', () => {
      clearTimeout(timer);
    });
  });
}

describe('CLI Basic Commands', () => {
  describe('nexus sites list', () => {
    it('should list all sites with status', async () => {
      const result = await runCli('sites list');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Sites');

      // Should show at least one site or "No sites found"
      const hasContent = result.stdout.length > 20;
      expect(hasContent).toBe(true);

      // Should show status indicators (running or halted)
      const hasStatus = result.stdout.match(/running|halted|●|⚫/i);
      expect(hasStatus).toBeTruthy();
    });

    it('should support JSON output', async () => {
      const result = await runCli('sites list --json');

      expect(result.exitCode).toBe(0);

      // Should be valid JSON
      const sites = JSON.parse(result.stdout);
      expect(sites).toHaveProperty('local');
      expect(Array.isArray(sites.local)).toBe(true);

      // If there are local sites, validate structure
      if (sites.local.length > 0) {
        const firstSite = sites.local[0];
        expect(firstSite).toHaveProperty('name');
        expect(firstSite).toHaveProperty('status');
      }
    });

    it('should show domain information', async () => {
      const result = await runCli('sites list');

      expect(result.exitCode).toBe(0);

      // Output should contain useful information
      expect(result.stdout.length).toBeGreaterThan(0);

      // Should show either sites or appropriate message
      const hasValidOutput =
        result.stdout.includes('.local') ||
        result.stdout.includes('No sites') ||
        result.stdout.includes('Sites:');
      expect(hasValidOutput).toBe(true);
    });
  });

  describe('nexus --help', () => {
    it('should show help output', async () => {
      const result = await runCli('--help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('Commands:');
    });
  });

  describe('nexus --version', () => {
    it('should show version number', async () => {
      const result = await runCli('--version');

      expect(result.exitCode).toBe(0);

      // Should contain a version number
      const hasVersion = result.stdout.match(/\d+\.\d+\.\d+/);
      expect(hasVersion).toBeTruthy();
    });
  });
});

describe('CLI WordPress Commands', () => {
  // These tests will only run if there's a running site available

  describe('nexus wp plugin list', () => {
    it('should list plugins or show appropriate error', async () => {
      // Try to run against any available site
      const listResult = await runCli('sites list --json');

      if (listResult.exitCode !== 0) {
        console.log('      [SKIP] Could not get site list');
        return;
      }

      const sites = JSON.parse(listResult.stdout);
      const runningSite = sites.local?.find((s: any) => s.status === 'running');

      if (!runningSite) {
        console.log('      [SKIP] No running sites available for WP-CLI tests');
        return;
      }

      const result = await runCli(`wp plugin list ${runningSite.name}@local`);

      // Should complete (success or failure depends on site state)
      expect([0, 1]).toContain(result.exitCode);

      const output = result.stdout + result.stderr;
      expect(output.length).toBeGreaterThan(0);

      // Should show plugins or error message
      const hasValidOutput =
        output.includes('Plugin') ||
        output.includes('plugin') ||
        output.includes('error') ||
        output.includes('Error');
      expect(hasValidOutput).toBe(true);
    });
  });

  describe('nexus wp core version', () => {
    it('should show WordPress version or error', async () => {
      // Get a running site
      const listResult = await runCli('sites list --json');

      if (listResult.exitCode !== 0) {
        console.log('      [SKIP] Could not get site list');
        return;
      }

      const sites = JSON.parse(listResult.stdout);
      const runningSite = sites.local?.find((s: any) => s.status === 'running');

      if (!runningSite) {
        console.log('      [SKIP] No running sites available');
        return;
      }

      const result = await runCli(`wp core version ${runningSite.name}@local`);

      // Should complete
      expect([0, 1]).toContain(result.exitCode);

      if (result.exitCode === 0) {
        // Should show a version number
        expect(result.stdout).toMatch(/\d+\.\d+/);
      } else {
        // Should show an error message
        const output = result.stdout + result.stderr;
        expect(output.toLowerCase()).toMatch(/error|failed|not found/);
      }
    });
  });
});

describe('CLI Error Handling', () => {
  it('should show error for invalid command', async () => {
    const result = await runCli('invalid-command-xyz');

    expect(result.exitCode).toBe(1);

    const output = result.stdout + result.stderr;
    expect(output.toLowerCase()).toMatch(/unknown|invalid|error/);
  });

  it('should show error for invalid site', async () => {
    const result = await runCli('sites start nonexistent-site-xyz-123');

    expect(result.exitCode).toBe(1);

    const output = result.stdout + result.stderr;
    const hasError = output.toLowerCase().includes('not found') ||
                    output.toLowerCase().includes('error') ||
                    output.toLowerCase().includes('invalid');
    expect(hasError).toBe(true);
  });
});
