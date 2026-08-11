/**
 * Performance characteristics for EventLog.append
 *
 * Hot-path optimizations that must not compromise correctness. These tests verify that
 * directory creation and file permission setting are correctly cached, while still ensuring
 * the security guarantees (mode 0600) survive the optimization.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventLog } from '../../../src/main/logging/eventLog';

describe('EventLog append performance', () => {
  let tmpDir: string;
  let log: EventLog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventlog-perf-'));
    log = new EventLog({ root: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('caches directory creation across multiple appends', () => {
    const mkdirSpy = jest.spyOn(fs, 'mkdirSync');

    // Write three events to the same day's log file
    const events = [
      { level: 'INFO' as const, source: 'test', sourceKind: 'agent' as const, message: 'one' },
      { level: 'INFO' as const, source: 'test', sourceKind: 'agent' as const, message: 'two' },
      { level: 'INFO' as const, source: 'test', sourceKind: 'agent' as const, message: 'three' },
    ];

    events.forEach(e => log.write(e));

    // An agent write creates TWO files (combined at root + agent in agents/ subdirectory),
    // so TWO directories are created on the first write (root and agents/), then cached.
    // Total: 2 mkdirs for the first event, 0 for subsequent events = 2 total
    expect(mkdirSpy).toHaveBeenCalledTimes(2);
    mkdirSpy.mockRestore();
  });

  it('sets mode 0600 on new file creation only', () => {
    const chmodSpy = jest.spyOn(fs, 'chmodSync');

    // First write creates TWO files (combined + agent), so 2 chmods
    log.write({ level: 'INFO', source: 'test', sourceKind: 'agent', message: 'first' });
    expect(chmodSpy).toHaveBeenCalledTimes(2);

    // Subsequent writes to the same files do not chmod again
    log.write({ level: 'INFO', source: 'test', sourceKind: 'agent', message: 'second' });
    log.write({ level: 'INFO', source: 'test', sourceKind: 'agent', message: 'third' });
    expect(chmodSpy).toHaveBeenCalledTimes(2);

    chmodSpy.mockRestore();
  });

  it('maintains 0600 mode on new files after optimization', () => {
    log.write({ level: 'INFO', source: 'test', sourceKind: 'agent', message: 'create' });

    // Combined log goes to root, agent log goes to agents/ subdirectory
    const logFiles = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('nexus-') && f.endsWith('.log'));

    expect(logFiles.length).toBeGreaterThan(0);
    const filePath = path.join(tmpDir, logFiles[0]);
    const stat = fs.statSync(filePath);

    // Verify mode is 0600 (user read/write only)
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('maintains 0600 mode on pre-existing files', () => {
    // Create a pre-existing log file with LOOSE MODE (0644), using the SAME day derivation as production.
    // The previous implementation used toISOString() (UTC) while production uses localDay() (local),
    // so off UTC the test statted a file the code never opened.
    //
    // Task 7 moved chmod from every-append to creation-only, but appendFileSync's mode option
    // applies ONLY at creation — a pre-existing file with loose mode stays loose. The fix corrects
    // mode once per file per process (when first cached), so this test starts from 0644 (reachable
    // via older build, different umask, or external recreation) and asserts correction to 0600.
    const { localDay } = require('../../../src/main/logging/eventLog');
    const today = localDay(new Date());
    const logPath = path.join(tmpDir, `nexus-${today}.log`);
    fs.writeFileSync(logPath, 'existing content\n', { mode: 0o644 });

    // Verify it starts loose
    let stat = fs.statSync(logPath);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o644);

    // Append to the existing file
    log.write({ level: 'INFO', source: 'test', sourceKind: 'agent', message: 'append' });

    // Verify mode is corrected to 0600
    stat = fs.statSync(logPath);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('invalidates cache when directory is externally removed', () => {
    // Write first event, creating directory
    log.write({ level: 'INFO', source: 'test', sourceKind: 'agent', message: 'first' });

    // Externally remove the agents directory (where agent logs go)
    const agentsDir = path.join(tmpDir, 'agents');
    fs.rmSync(agentsDir, { recursive: true, force: true });

    // Next write should recreate directory (not throw)
    expect(() => {
      log.write({ level: 'INFO', source: 'test', sourceKind: 'agent', message: 'second' });
    }).not.toThrow();

    // Verify the agents directory exists again
    expect(fs.existsSync(agentsDir)).toBe(true);
  });
});
