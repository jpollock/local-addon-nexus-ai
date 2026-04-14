/**
 * CLI E2E Tests — WPE Destructive Commands (Argument Validation Only)
 *
 * IMPORTANT: These commands are NOT executed against real WPE infrastructure.
 * Tests validate ONLY: argument parsing, required flag enforcement, and
 * error messages for invalid/missing inputs.
 *
 * Commands covered:
 *   nexus wpe delete-install  — requires installId + --confirm
 *   nexus wpe domain-remove   — requires installId + domainId + --confirm
 *   nexus wpe promote         — requires sourceInstallId + destInstallId + --confirm
 *   nexus wpe user-remove     — requires accountId + userId + --confirm
 *   nexus wpe ssh-key-remove  — requires keyId + --confirm
 *   nexus wpe create-site     — write (not destructive but tested here)
 *   nexus wpe create-install  — write (not destructive but tested here)
 *   nexus wpe backup          — write (creates backup, safe to run)
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, DESTRUCTIVE_NOTE } from './helpers/cli-test-utils';

// Fake UUIDs for argument parsing tests
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe(`nexus wpe delete-install — ${DESTRUCTIVE_NOTE}`, () => {
  it('requires installId argument', async () => {
    const r = await runCli('wpe delete-install');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/required|missing|argument/);
  });

  it('requires --confirm flag (fails without it)', async () => {
    const r = await runCli(`wpe delete-install ${FAKE_UUID}`);
    expect(r.exitCode).toBe(1);
    // Should refuse without confirmation, not actually delete
    expect(r.output.toLowerCase()).toMatch(/confirm|confirmation/);
  });

  it('--confirm with invalid id returns not found (not a crash)', async () => {
    const r = await runCli(`wpe delete-install ${FAKE_UUID} --confirm`);
    expect(r.exitCode).toBe(1);
    // Should fail gracefully — CAPI 404, not unhandled exception
    expect(r.output.toLowerCase()).toMatch(/not found|error|failed/);
  });
});

describe(`nexus wpe domain-remove — ${DESTRUCTIVE_NOTE}`, () => {
  it('requires installId and domainId', async () => {
    const r = await runCli('wpe domain-remove');
    expect(r.exitCode).toBe(1);
  });

  it('requires --confirm flag', async () => {
    const r = await runCli(`wpe domain-remove ${FAKE_UUID} ${FAKE_UUID}`);
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/confirm/);
  });
});

describe(`nexus wpe promote — ${DESTRUCTIVE_NOTE}`, () => {
  it('requires source and destination install IDs', async () => {
    const r = await runCli('wpe promote');
    expect(r.exitCode).toBe(1);
  });

  it('requires --confirm flag', async () => {
    const r = await runCli(`wpe promote ${FAKE_UUID} ${FAKE_UUID}`);
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/confirm/);
  });
});

describe(`nexus wpe user-remove — ${DESTRUCTIVE_NOTE}`, () => {
  it('requires accountId and userId', async () => {
    const r = await runCli('wpe user-remove');
    expect(r.exitCode).toBe(1);
  });

  it('requires --confirm flag', async () => {
    const r = await runCli(`wpe user-remove ${FAKE_UUID} ${FAKE_UUID}`);
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/confirm/);
  });
});

describe(`nexus wpe ssh-key-remove — ${DESTRUCTIVE_NOTE}`, () => {
  it('requires keyId argument', async () => {
    const r = await runCli('wpe ssh-key-remove');
    expect(r.exitCode).toBe(1);
  });

  it('requires --confirm flag', async () => {
    const r = await runCli(`wpe ssh-key-remove ${FAKE_UUID}`);
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/confirm/);
  });
});

describe('nexus wpe create-site — argument validation', () => {
  it('requires --name option', async () => {
    const r = await runCli(`wpe create-site --account ${FAKE_UUID}`);
    expect(r.exitCode).toBe(1);
  });

  it('requires --account option', async () => {
    const r = await runCli('wpe create-site --name test-site');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus wpe create-install — argument validation', () => {
  it('requires --name, --account, and --site options', async () => {
    const r = await runCli('wpe create-install');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus wpe backup — argument validation', () => {
  it('requires a target argument', async () => {
    const r = await runCli('wpe backup');
    expect(r.exitCode).toBe(1);
  });
});
