import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';
import { ZonedDate, localDay } from './simulatedZone';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eventlog-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const read = (p: string) => fs.readFileSync(p, 'utf-8');
const AT = new Date('2026-08-09T13:31:02.123Z');

/**
 * The day a file is named for, derived the way the READER derives it — `date +%F`, i.e. local.
 * Hardcoding `2026-08-09` pins the UTC rendering of this instant and passes only where the two
 * happen to agree; every expectation below is built from this instead.
 */
const day = localDay;
const combinedPath = (d: Date = AT) => path.join(root, `nexus-${day(d)}.log`);
const agentPath = (name: string, d: Date = AT) => path.join(root, 'agents', `${name}-${day(d)}.log`);

describe('EventLog', () => {
  it('writes an agent event to both the combined stream and the agent file', () => {
    // The duplication is the point: one file to tail for everything, one to read an agent in
    // isolation, reconciled by run=.
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'security-sentinel', sourceKind: 'agent', runId: 'r_1', event: 'phase' });

    expect(read(combinedPath())).toContain('run=r_1 phase');
    expect(read(agentPath('security-sentinel'))).toBe(read(combinedPath()));
  });

  it('writes a system event only to the combined stream', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'gateway', event: 'llm.call' });
    expect(fs.existsSync(path.join(root, 'agents'))).toBe(false);
    expect(read(combinedPath())).toContain('gateway llm.call');
  });

  it('rolls to a new file at midnight without any explicit rotation step', () => {
    // 24 hours apart, so the two instants land on different LOCAL days in every timezone,
    // whatever the offset and whatever DST does in between.
    let clock = AT;
    const log = new EventLog({ root, now: () => clock });
    log.write({ level: 'INFO', source: 'a', message: 'before' });
    const nextDay = new Date(AT.getTime() + 24 * 60 * 60 * 1000);
    clock = nextDay;
    log.write({ level: 'INFO', source: 'a', message: 'after' });

    expect(day(nextDay)).not.toBe(day(AT));
    expect(read(combinedPath(AT))).toContain('before');
    expect(read(combinedPath(nextDay))).toContain('after');
  });

  it('rolls within a day once the file passes maxBytes', () => {
    // A runaway agent must not fill the disk before midnight arrives.
    const log = new EventLog({ root, now: () => AT, maxBytes: 200 });
    for (let i = 0; i < 40; i++) log.write({ level: 'INFO', source: 'a', message: `line ${i}` });
    expect(fs.existsSync(`${combinedPath()}.1`)).toBe(true);
  });

  it('drops events below the configured level', () => {
    const log = new EventLog({ root, minLevel: 'INFO', now: () => AT });
    log.write({ level: 'DEBUG', source: 'a', message: 'noisy' });
    log.write({ level: 'INFO', source: 'a', message: 'kept' });

    const out = read(combinedPath());
    expect(out).not.toContain('noisy');
    expect(out).toContain('kept');
  });

  it('always keeps ERROR, whatever the level', () => {
    const log = new EventLog({ root, minLevel: 'ERROR', now: () => AT });
    log.write({ level: 'ERROR', source: 'a', message: 'boom' });
    expect(read(combinedPath())).toContain('boom');
  });

  it('never throws when the root is unwritable', () => {
    // Logging must never be able to fail a run.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = new EventLog({ root: '/proc/nonexistent/nope', now: () => AT });
      expect(() => log.write({ level: 'ERROR', source: 'a', message: 'x' })).not.toThrow();
    } finally { spy.mockRestore(); }
  });

  it('sanitizes source name to prevent directory traversal', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: '../../../etc/passwd', sourceKind: 'agent', message: 'bad' });
    const agents = path.join(root, 'agents');
    const files = fs.readdirSync(agents, { recursive: true }) as string[];
    expect(files.length).toBeGreaterThan(0);
    // Containment is the property that matters: every file is a direct child of root/agents,
    // with no separator left in the name to walk out of it. A literal '..' inside the name is
    // harmless — the '-YYYY-MM-DD.log' suffix means no segment can ever BE '..'.
    for (const file of files) {
      expect(file).not.toContain('/');
      expect(file).not.toContain('\\');
      expect(path.dirname(path.resolve(agents, file))).toBe(agents);
    }
    expect(files).toContain(`.._.._.._etc_passwd-${day(AT)}.log`);
  });

  it('sanitizes source name containing forward slashes', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'agent/name/with/slashes', sourceKind: 'agent', message: 'test' });
    const files = fs.readdirSync(path.join(root, 'agents'));
    expect(files.length).toBeGreaterThan(0);
    // The filename should have slashes replaced with underscores
    expect(files[0]).toContain('agent_name_with_slashes');
  });

  it('keeps a dot in a source name, so a.b and a_b are different files', () => {
    // `defineAgent({ name: 'my.agent' })` registers cleanly — VALID_AGENT_NAME is enforced only
    // in loadManifest(), while loadAgent() registers on name+run alone — so a dotted source is
    // reachable, and collapsing '.' merged it with the underscore form into one file.
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'a.b', sourceKind: 'agent', message: 'dotted' });
    log.write({ level: 'INFO', source: 'a_b', sourceKind: 'agent', message: 'underscored' });

    expect(read(agentPath('a.b'))).toContain('dotted');
    expect(read(agentPath('a.b'))).not.toContain('underscored');
    expect(read(agentPath('a_b'))).toContain('underscored');
    expect(read(agentPath('a_b'))).not.toContain('dotted');
  });

  it('keeps a dot distinct from a slash, so a.b and a/b do not collide either', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'a.b', sourceKind: 'agent', message: 'dotted' });
    log.write({ level: 'INFO', source: 'a/b', sourceKind: 'agent', message: 'slashed' });

    expect(read(agentPath('a.b'))).toContain('dotted');
    expect(read(agentPath('a.b'))).not.toContain('slashed');
    expect(read(agentPath('a_b'))).toContain('slashed');
  });

  it('applies 0600 mode to combined log file', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'a', message: 'test' });
    const stat = fs.statSync(combinedPath());
    // Check that mode is 0600 (owner read+write only)
    expect((stat.mode & 0o777)).toBe(0o600);
  });

  it('applies 0600 mode to agent log file', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'agent-x', sourceKind: 'agent', message: 'test' });
    const stat = fs.statSync(agentPath('agent-x'));
    // Check that mode is 0600 (owner read+write only)
    expect((stat.mode & 0o777)).toBe(0o600);
  });

  it('preserves 0600 mode when appending to existing file', () => {
    const log = new EventLog({ root, now: () => AT });

    // Write first event
    log.write({ level: 'INFO', source: 'a', message: 'line1' });
    let stat = fs.statSync(combinedPath());
    expect((stat.mode & 0o777)).toBe(0o600);

    // Write second event to existing file
    log.write({ level: 'INFO', source: 'a', message: 'line2' });
    stat = fs.statSync(combinedPath());
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
    expect(paths.combined).toBe(combinedPath());
    expect(paths.agent).toBe(agentPath('test-agent'));
  });

  it('pathsFor returns undefined agent path for system events', () => {
    const log = new EventLog({ root, now: () => AT });
    const paths = log.pathsFor({
      level: 'INFO',
      source: 'gateway',
      sourceKind: 'system',
      at: AT,
    });
    expect(paths.combined).toBe(combinedPath());
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
    // Separators are gone, so the result is one filename segment inside root/agents.
    expect(paths.agent).toBe(agentPath('.._bad_source'));
    expect(path.dirname(paths.agent!)).toBe(path.join(root, 'agents'));
  });

  it('pathsFor handles invalid dates gracefully', () => {
    const log = new EventLog({ root, now: () => AT });
    let paths!: { combined: string };
    expect(() => {
      paths = log.pathsFor({
        level: 'INFO',
        source: 'test',
        at: new Date('invalid'),
      });
    }).not.toThrow();
    // 'Invalid Date' carries a space and would land in a filename verbatim.
    expect(paths.combined).toBe(path.join(root, 'nexus-unknown.log'));
  });
});

describe('EventLog filenames use the LOCAL day', () => {
  // `tail -f nexus-$(date +%F).log` is the documented acceptance command, and `date +%F` prints
  // the LOCAL date. Under a UTC filename that command follows a file that exists and is never
  // appended to again — silent, empty, forever, during the evening hours west of Greenwich when
  // someone is asking why their agent did not run.
  //
  // The zone is simulated at the Date (see simulatedZone.ts) rather than pinned via
  // process.env.TZ, which Jest does not propagate to the runtime — so this is deterministic on
  // every machine, a UTC one included, and still fails outright under a UTC implementation.

  it.each([
    ['ahead of UTC', 9, '2026-08-09T23:30:00Z'],   // already the 10th in UTC+9
    ['behind UTC', -7, '2026-08-09T02:30:00Z'],    // still the 8th in UTC-7
  ])('writes to the local day, not the UTC day, in a zone %s', (_label, offsetHours, iso) => {
    const at = new ZonedDate(iso, offsetHours as number);
    const utcDay = at.toISOString().slice(0, 10);
    expect(day(at)).not.toBe(utcDay);              // guard: the assertions below discriminate

    const log = new EventLog({ root, now: () => at });
    log.write({ level: 'INFO', source: 'sentinel', sourceKind: 'agent', message: 'evening' });

    expect(read(path.join(root, `nexus-${day(at)}.log`))).toContain('evening');
    expect(fs.existsSync(path.join(root, `nexus-${utcDay}.log`))).toBe(false);
    // The agent file must use the same rule — one in UTC and one local is the only combination
    // that is definitely wrong.
    expect(fs.existsSync(path.join(root, 'agents', `sentinel-${day(at)}.log`))).toBe(true);
    expect(fs.existsSync(path.join(root, 'agents', `sentinel-${utcDay}.log`))).toBe(false);
  });
});

describe('EventLog reports its own failures', () => {
  // Total failure of the log is otherwise indistinguishable from "the agent never ran" — the
  // exact question the log exists to answer. Reported once per file, because a stack trace per
  // line would flood the console someone is reading to find out why logging is broken.

  /** A root whose parent is a FILE: every mkdir/append beneath it fails, on any platform. */
  function unwritableRoot(): string {
    const blocked = path.join(root, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    return path.join(blocked, 'logs');
  }

  const reportsFrom = (spy: jest.SpyInstance) =>
    spy.mock.calls.map(c => String(c[0])).filter(m => m.includes('[EventLog]'));

  it('reports a failing append once, not on every line', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = new EventLog({ root: unwritableRoot(), now: () => AT });
      log.write({ level: 'ERROR', source: 'a', message: 'first' });
      const afterOne = reportsFrom(spy).length;
      log.write({ level: 'ERROR', source: 'a', message: 'second' });
      log.write({ level: 'ERROR', source: 'a', message: 'third' });

      expect(afterOne).toBe(1);
      expect(reportsFrom(spy)).toHaveLength(1);
      expect(reportsFrom(spy)[0]).toContain(`nexus-${day(AT)}.log`);
    } finally { spy.mockRestore(); }
  });

  it('reports each failing file separately, so a broken agent file is not hidden by the combined one', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = new EventLog({ root: unwritableRoot(), now: () => AT });
      log.write({ level: 'ERROR', source: 'sentinel', sourceKind: 'agent', message: 'x' });

      const reports = reportsFrom(spy);
      expect(reports).toHaveLength(2);
      expect(reports.some(m => m.includes(`nexus-${day(AT)}.log`))).toBe(true);
      expect(reports.some(m => m.includes(`sentinel-${day(AT)}.log`))).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it('reporting changes nothing the caller can observe: still no throw, still no return value', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = new EventLog({ root: unwritableRoot(), now: () => AT });
      let result: unknown = 'sentinel-value';
      expect(() => { result = log.write({ level: 'ERROR', source: 'a', message: 'x' }); }).not.toThrow();
      expect(result).toBeUndefined();
    } finally { spy.mockRestore(); }
  });
});
