import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';
import { LogLevel } from '../../../src/main/logging/Logger';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eventlog-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const read = (p: string) => fs.readFileSync(p, 'utf-8');
const AT = new Date('2026-08-09T13:31:02.123Z');

describe('EventLog', () => {
  it('writes an agent event to both the combined stream and the agent file', () => {
    // The duplication is the point: one file to tail for everything, one to read an agent in
    // isolation, reconciled by run=.
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'security-sentinel', sourceKind: 'agent', runId: 'r_1', event: 'phase' });

    const combined = path.join(root, 'nexus-2026-08-09.log');
    const agent = path.join(root, 'agents', 'security-sentinel-2026-08-09.log');
    expect(read(combined)).toContain('run=r_1 phase');
    expect(read(agent)).toBe(read(combined));
  });

  it('writes a system event only to the combined stream', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'gateway', event: 'llm.call' });
    expect(fs.existsSync(path.join(root, 'agents'))).toBe(false);
    expect(read(path.join(root, 'nexus-2026-08-09.log'))).toContain('gateway llm.call');
  });

  it('rolls to a new file at midnight without any explicit rotation step', () => {
    let clock = new Date('2026-08-09T23:59:59.000Z');
    const log = new EventLog({ root, now: () => clock });
    log.write({ level: 'INFO', source: 'a', message: 'before' });
    clock = new Date('2026-08-10T00:00:01.000Z');
    log.write({ level: 'INFO', source: 'a', message: 'after' });

    expect(read(path.join(root, 'nexus-2026-08-09.log'))).toContain('before');
    expect(read(path.join(root, 'nexus-2026-08-10.log'))).toContain('after');
  });

  it('rolls within a day once the file passes maxBytes', () => {
    // A runaway agent must not fill the disk before midnight arrives.
    const log = new EventLog({ root, now: () => AT, maxBytes: 200 });
    for (let i = 0; i < 40; i++) log.write({ level: 'INFO', source: 'a', message: `line ${i}` });
    expect(fs.existsSync(path.join(root, 'nexus-2026-08-09.log.1'))).toBe(true);
  });

  it('drops events below the configured level', () => {
    const log = new EventLog({ root, minLevel: 'INFO', now: () => AT });
    log.write({ level: 'DEBUG', source: 'a', message: 'noisy' });
    log.write({ level: 'INFO', source: 'a', message: 'kept' });

    const out = read(path.join(root, 'nexus-2026-08-09.log'));
    expect(out).not.toContain('noisy');
    expect(out).toContain('kept');
  });

  it('always keeps ERROR, whatever the level', () => {
    const log = new EventLog({ root, minLevel: 'ERROR', now: () => AT });
    log.write({ level: 'ERROR', source: 'a', message: 'boom' });
    expect(read(path.join(root, 'nexus-2026-08-09.log'))).toContain('boom');
  });

  it('never throws when the root is unwritable', () => {
    // Logging must never be able to fail a run.
    const log = new EventLog({ root: '/proc/nonexistent/nope', now: () => AT });
    expect(() => log.write({ level: 'ERROR', source: 'a', message: 'x' })).not.toThrow();
  });

  it('sanitizes source name to prevent directory traversal', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: '../../../etc/passwd', sourceKind: 'agent', message: 'bad' });
    // File should be inside root/agents, not outside
    const files = fs.readdirSync(path.join(root, 'agents'), { recursive: true }) as string[];
    expect(files.length).toBeGreaterThan(0);
    // All files should be inside root/agents
    for (const file of files) {
      const fullPath = path.join(root, 'agents', file);
      expect(fullPath.startsWith(path.join(root, 'agents'))).toBe(true);
    }
    // The sanitized filename should replace slashes with underscores
    expect(files.some((f: string) => f.includes('_') && !f.includes('..'))).toBe(true);
  });

  it('sanitizes source name containing forward slashes', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'agent/name/with/slashes', sourceKind: 'agent', message: 'test' });
    const agentDir = path.join(root, 'agents');
    const files = fs.readdirSync(agentDir);
    expect(files.length).toBeGreaterThan(0);
    // The filename should have slashes replaced with underscores
    expect(files[0]).toContain('agent_name_with_slashes');
  });

  it('applies 0600 mode to combined log file', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'a', message: 'test' });
    const combined = path.join(root, 'nexus-2026-08-09.log');
    const stat = fs.statSync(combined);
    // Check that mode is 0600 (owner read+write only)
    expect((stat.mode & 0o777)).toBe(0o600);
  });

  it('applies 0600 mode to agent log file', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'agent-x', sourceKind: 'agent', message: 'test' });
    const agent = path.join(root, 'agents', 'agent-x-2026-08-09.log');
    const stat = fs.statSync(agent);
    // Check that mode is 0600 (owner read+write only)
    expect((stat.mode & 0o777)).toBe(0o600);
  });

  it('preserves 0600 mode when appending to existing file', () => {
    const log = new EventLog({ root, now: () => AT });
    const combined = path.join(root, 'nexus-2026-08-09.log');

    // Write first event
    log.write({ level: 'INFO', source: 'a', message: 'line1' });
    let stat = fs.statSync(combined);
    expect((stat.mode & 0o777)).toBe(0o600);

    // Write second event to existing file
    log.write({ level: 'INFO', source: 'a', message: 'line2' });
    stat = fs.statSync(combined);
    // Mode should still be 0600
    expect((stat.mode & 0o777)).toBe(0o600);
  });

  it('pathsFor returns the correct shape for agent events', () => {
    const log = new EventLog({ root, now: () => AT });
    const paths = log.pathsFor({
      level: 'INFO',
      source: 'test-agent',
      sourceKind: 'agent',
      at: AT,
    });
    expect(paths.combined).toBe(path.join(root, 'nexus-2026-08-09.log'));
    expect(paths.agent).toBe(path.join(root, 'agents', 'test-agent-2026-08-09.log'));
  });

  it('pathsFor returns undefined agent path for system events', () => {
    const log = new EventLog({ root, now: () => AT });
    const paths = log.pathsFor({
      level: 'INFO',
      source: 'gateway',
      sourceKind: 'system',
      at: AT,
    });
    expect(paths.combined).toBe(path.join(root, 'nexus-2026-08-09.log'));
    expect(paths.agent).toBeUndefined();
  });

  it('pathsFor sanitizes source name in agent path', () => {
    const log = new EventLog({ root, now: () => AT });
    const paths = log.pathsFor({
      level: 'INFO',
      source: '../bad/source',
      sourceKind: 'agent',
      at: AT,
    });
    // The agent path should have slashes replaced with underscores
    expect(paths.agent).toContain('_bad_source-2026-08-09.log');
    expect(paths.agent).not.toContain('..');
    expect(paths.agent).not.toContain('/bad');
  });

  it('pathsFor handles invalid dates gracefully', () => {
    const log = new EventLog({ root, now: () => AT });
    expect(() => {
      log.pathsFor({
        level: 'INFO',
        source: 'test',
        at: new Date('invalid'),
      });
    }).not.toThrow();
  });
});
