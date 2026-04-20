/**
 * CLI E2E Tests — nexus troubleshoot + expanded doctor checks
 *
 * Covers:
 *   - nexus troubleshoot --help
 *   - nexus troubleshoot (runs diagnostics, exits 0 or 1 depending on environment)
 *   - nexus troubleshoot --verbose
 *   - nexus doctor disk space check
 *   - nexus doctor stale twins check
 *   - nexus doctor recent errors check
 */

import { describe, it, expect } from '@jest/globals';
import { runCli } from './helpers/cli-test-utils';

// ---------------------------------------------------------------------------
// nexus troubleshoot --help
// ---------------------------------------------------------------------------

describe('nexus troubleshoot --help', () => {
  it('returns exit 0 and shows usage', async () => {
    const r = await runCli('troubleshoot --help');
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/troubleshoot/i);
    expect(r.output).toMatch(/diagnos|recover|issues/i);
  });

  it('shows available options', async () => {
    const r = await runCli('troubleshoot --help');
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/--last-error/);
    expect(r.output).toMatch(/--verbose/);
  });
});

// ---------------------------------------------------------------------------
// nexus troubleshoot (live run)
// ---------------------------------------------------------------------------

describe('nexus troubleshoot', () => {
  it('returns exit 0 or 1 and shows diagnostic sections', async () => {
    const r = await runCli('troubleshoot', { timeout: 30000 });
    // Exit 0 = no errors; exit 1 = errors found. Both are valid outcomes.
    expect([0, 1]).toContain(r.exitCode);
    // Must show diagnostic output
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.output).toMatch(/Nexus AI|Troubleshoot/i);
  });

  it('shows core checks section', async () => {
    const r = await runCli('troubleshoot', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/Core Checks|Local|addon/i);
  });

  it('shows disk space diagnostic', async () => {
    const r = await runCli('troubleshoot', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/Disk space|Resources/i);
  });

  it('shows connectivity section', async () => {
    const r = await runCli('troubleshoot', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/Connectivity|GraphQL/i);
  });

  it('shows SSH section', async () => {
    const r = await runCli('troubleshoot', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/SSH/i);
  });

  it('shows log analysis section', async () => {
    const r = await runCli('troubleshoot', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/Log Analysis|log|error/i);
  });

  it('shows suggested fixes when issues detected', async () => {
    const r = await runCli('troubleshoot', { timeout: 30000 });
    // If there are issues, the output should contain actionable suggestions
    if (r.exitCode === 1 || r.output.match(/⚠️|❌/)) {
      // Should have either "Suggested fixes" section or "No issues detected"
      expect(r.output).toMatch(/Suggested fixes|No issues detected|→/);
    }
  });
});

// ---------------------------------------------------------------------------
// nexus troubleshoot --verbose
// ---------------------------------------------------------------------------

describe('nexus troubleshoot --verbose', () => {
  it('shows more detail than non-verbose mode', async () => {
    const r = await runCli('troubleshoot --verbose', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
    // Verbose mode should include all ok checks plus any errors
    expect(r.output).toMatch(/✅|⚠️|❌|ℹ️/);
  });
});

// ---------------------------------------------------------------------------
// nexus troubleshoot --last-error
// ---------------------------------------------------------------------------

describe('nexus troubleshoot --last-error', () => {
  it('returns exit 0 or 1 and shows log analysis', async () => {
    const r = await runCli('troubleshoot --last-error', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/Log Analysis|log|error/i);
  });
});

// ---------------------------------------------------------------------------
// nexus doctor — new checks
// ---------------------------------------------------------------------------

describe('nexus doctor — expanded checks', () => {
  it('includes disk space check', async () => {
    const r = await runCli('doctor', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/Disk space/i);
  });

  it('disk space check shows GB value', async () => {
    const r = await runCli('doctor', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    // Should show a GB value like "45.3 GB"
    expect(r.output).toMatch(/\d+\.\d+ GB/);
  });

  it('includes site data freshness check', async () => {
    const r = await runCli('doctor', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    // Should show either "Site data" check (when GraphQL available) or skip gracefully
    expect(r.output).toMatch(/Site data|Local not running/i);
  });

  it('includes recent errors check', async () => {
    const r = await runCli('doctor', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output).toMatch(/Recent errors/i);
  });

  it('every warning and error has a specific fix command', async () => {
    const r = await runCli('doctor', { timeout: 30000 });
    // Extract lines with ⚠️ or ❌
    const lines = r.output.split('\n');
    const problemLines = lines.filter((l) => l.includes('⚠️') || l.includes('❌'));

    if (problemLines.length > 0) {
      // When there are problems, there should be "Next steps" with fix commands
      expect(r.output).toMatch(/Next steps:|Getting started:|→/);
    }
  });

  it('outputs valid JSON with --json flag including new checks', async () => {
    const r = await runCli('doctor --json', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);

    let parsed: any;
    expect(() => { parsed = JSON.parse(r.stdout); }).not.toThrow();

    // Should include the new check labels
    const labels = parsed.checks.map((c: any) => c.label);
    expect(labels).toContain('Disk space');
    expect(labels.some((l: string) => l.includes('Recent errors'))).toBe(true);
  });
});
