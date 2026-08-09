import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';

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
});
