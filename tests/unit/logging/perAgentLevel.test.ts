import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-perlevel-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const AT = () => new Date('2026-08-09T10:00:00Z');
const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '');
const combined = () => read(path.join(root, `nexus-${new Date(AT()).toLocaleDateString('en-CA')}.log`));

describe('per-agent level override', () => {
  it('lets one agent log DEBUG while the rest stay at INFO', () => {
    // You debug one agent, not the whole app: a global DEBUG across a fleet produces noise
    // nobody reads, which is why the override exists at all.
    const log = new EventLog({
      root, minLevel: 'INFO', now: AT,
      levelFor: (source) => (source === 'security-sentinel' ? 'DEBUG' : undefined),
    });
    log.write({ level: 'DEBUG', source: 'security-sentinel', sourceKind: 'agent', message: 'kept' } as any);
    log.write({ level: 'DEBUG', source: 'log-processor', sourceKind: 'agent', message: 'dropped' } as any);

    expect(combined()).toContain('kept');
    expect(combined()).not.toContain('dropped');
  });

  it('falls back to the global level when the agent has no override', () => {
    const log = new EventLog({ root, minLevel: 'WARN', now: AT, levelFor: () => undefined });
    log.write({ level: 'INFO', source: 'a', sourceKind: 'agent', message: 'dropped' } as any);
    log.write({ level: 'ERROR', source: 'a', sourceKind: 'agent', message: 'kept' } as any);
    expect(combined()).toContain('kept');
    expect(combined()).not.toContain('dropped');
  });

  it('an override can also be stricter than the global level', () => {
    const log = new EventLog({
      root, minLevel: 'DEBUG', now: AT,
      levelFor: (s) => (s === 'noisy' ? 'ERROR' : undefined),
    });
    log.write({ level: 'INFO', source: 'noisy', sourceKind: 'agent', message: 'dropped' } as any);
    log.write({ level: 'INFO', source: 'quiet', sourceKind: 'agent', message: 'kept' } as any);
    expect(combined()).toContain('kept');
    expect(combined()).not.toContain('dropped');
  });

  it('a throwing levelFor cannot lose the line', () => {
    // The callback reads a settings cache that may not exist yet. Failing closed here would drop
    // evidence for the least interesting reason.
    const log = new EventLog({
      root, minLevel: 'INFO', now: AT,
      levelFor: () => { throw new Error('cache not ready'); },
    });
    expect(() => log.write({ level: 'INFO', source: 'a', sourceKind: 'agent', message: 'kept' } as any)).not.toThrow();
    expect(combined()).toContain('kept');
  });
});
