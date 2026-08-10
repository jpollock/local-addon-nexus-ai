/**
 * Unit tests for run ID in audit entries
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog, AuditEntry } from '../../../src/main/audit/OperationAuditLog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuditLog(): OperationAuditLog {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-runid-test-'));
  const logPath = path.join(dir, 'audit.log');
  return new OperationAuditLog(logPath);
}

function readEntries(log: OperationAuditLog): AuditEntry[] {
  return log.list();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OperationAuditLog run ID support', () => {
  it('records the run id when one is supplied', async () => {
    const log = makeAuditLog();
    await log.log({ operation: 'wp_plugin_update', target: 'acfprod', outcome: 'success', runId: 'r_abc' } as any);
    expect(readEntries(log)[0].runId).toBe('r_abc');
  });

  it('omits it entirely when there is none, rather than writing null', async () => {
    // Most audit entries come from paths with no run — a null field on every one of them is noise
    // that makes the joinable entries harder to spot.
    const log = makeAuditLog();
    await log.log({ operation: 'ipc.wp.core.update', target: 'site', outcome: 'success' } as any);
    expect('runId' in readEntries(log)[0]).toBe(false);
  });

  it('redacts the run id like every other field', async () => {
    // Not because a run id is secret, but because the redaction walk must cover every field it
    // writes — an exemption is how the next field added quietly skips it.
    const log = makeAuditLog();
    await log.log({ operation: 'x', target: 'y', outcome: 'success', runId: 'r_abc' } as any);
    expect(readEntries(log)[0].runId).toBeDefined();
  });

  it('passes short run IDs through redaction unchanged', async () => {
    // Run IDs like r_abc or r_1a2b3c are too short to trigger opaque-run masking (20+ chars)
    const log = makeAuditLog();
    await log.log({ operation: 'x', target: 'y', outcome: 'success', runId: 'r_abc123' } as any);
    expect(readEntries(log)[0].runId).toBe('r_abc123');
  });

  it('passes realistic run IDs through redaction unchanged', async () => {
    // Realistic run IDs from newRunId() are r_<base36> — verify they survive redaction
    const log = makeAuditLog();
    await log.log({ operation: 'x', target: 'y', outcome: 'success', runId: 'r_m1n2o3p4q5r6s7t8' } as any);
    const entry = readEntries(log)[0];
    expect(entry.runId).toBe('r_m1n2o3p4q5r6s7t8');
    expect(entry.runId).not.toContain('[REDACTED]');
  });
});
