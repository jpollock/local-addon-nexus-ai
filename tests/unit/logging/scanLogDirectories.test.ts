import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanLogDirectories } from '../../../src/main/logging/scanLogDirectories';

describe('scanLogDirectories', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* cleanup is best-effort */ }
  });

  it('sums only audit log files, not the entire nexus-ai directory', () => {
    // C4: scanLogDirectories must use an allowlist for audit files, not sweep the directory
    const nexusAiDir = path.join(tmpDir, 'nexus-ai');
    const logsDir = path.join(nexusAiDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Create audit logs
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log'), 'a'.repeat(1000));
    fs.writeFileSync(path.join(nexusAiDir, 'operation-audit.log'), 'b'.repeat(2000));
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log.1'), 'c'.repeat(500));

    // Create large non-log file in nexus-ai/ (simulating vectors.db)
    const largeFile = 'x'.repeat(10 * 1024 * 1024); // 10 MB
    fs.writeFileSync(path.join(nexusAiDir, 'vectors.db'), largeFile);
    fs.writeFileSync(path.join(nexusAiDir, 'graph.db'), 'y'.repeat(1024 * 1024)); // 1 MB

    const sizes = scanLogDirectories(tmpDir);

    // Audit size should be ~3500 bytes (1000 + 2000 + 500), NOT ~11 MB
    expect(sizes.audit).toBe(3500);
    expect(sizes.audit).toBeLessThan(10000); // Well below the large files
  });

  it('counts all rotated generations of audit logs', () => {
    const nexusAiDir = path.join(tmpDir, 'nexus-ai');
    const logsDir = path.join(nexusAiDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Create audit.log and its rotated generations
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log'), 'a'.repeat(1000));
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log.1'), 'b'.repeat(1000));
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log.2'), 'c'.repeat(1000));
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log.3'), 'd'.repeat(1000));

    // Create operation-audit.log and one generation
    fs.writeFileSync(path.join(nexusAiDir, 'operation-audit.log'), 'e'.repeat(2000));
    fs.writeFileSync(path.join(nexusAiDir, 'operation-audit.log.1'), 'f'.repeat(2000));

    const sizes = scanLogDirectories(tmpDir);

    // Total: 1000 * 4 (audit.log family) + 2000 * 2 (operation-audit.log family) = 8000
    expect(sizes.audit).toBe(8000);
  });

  it('gracefully handles missing audit log files', () => {
    const nexusAiDir = path.join(tmpDir, 'nexus-ai');
    const logsDir = path.join(nexusAiDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Create only one audit file
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log'), 'a'.repeat(500));

    const sizes = scanLogDirectories(tmpDir);

    // Should count the one file that exists
    expect(sizes.audit).toBe(500);
  });

  it('counts combined, agent, and transcript logs correctly', () => {
    const nexusAiDir = path.join(tmpDir, 'nexus-ai');
    const logsDir = path.join(nexusAiDir, 'logs');
    const agentsDir = path.join(logsDir, 'agents');
    const transcriptsDir = path.join(logsDir, 'transcripts');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(transcriptsDir, { recursive: true });

    // Create various log files
    fs.writeFileSync(path.join(logsDir, 'nexus-2026-08-09.log'), 'a'.repeat(1000));
    fs.writeFileSync(path.join(logsDir, 'nexus-2026-08-08.log'), 'b'.repeat(1500));
    fs.writeFileSync(path.join(agentsDir, 'auth-probe-2026-08-09.log'), 'c'.repeat(2000));
    fs.writeFileSync(path.join(transcriptsDir, 'r_abc123.jsonl'), 'd'.repeat(500));

    // Create audit logs
    fs.writeFileSync(path.join(nexusAiDir, 'audit.log'), 'e'.repeat(300));

    const sizes = scanLogDirectories(tmpDir);

    expect(sizes.combined).toBe(2500); // 1000 + 1500
    expect(sizes.agent).toBe(2000);
    expect(sizes.transcript).toBe(500);
    expect(sizes.audit).toBe(300);
    expect(sizes.total).toBe(5300); // sum of all
  });
});
