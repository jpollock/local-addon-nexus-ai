import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { executeSentinelCommands } from '../../../src/main/sentinel/SentinelExecutor';

function fakeProc(opts: { code?: number; stdout?: string; stderr?: string } = {}) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.code ?? 0);
  });
  return proc;
}

function stubServices(result: any = { stdout: 'done', success: true }) {
  return { remoteWpCliRun: jest.fn(async () => result) } as any;
}

describe('executeSentinelCommands', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  it('skips full-line comments and blank lines without spawning', async () => {
    const res = await executeSentinelCommands('acme', ['# a note', '', '   '], stubServices());
    expect(spawnMock).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.steps).toHaveLength(3);
    expect(res.steps.every(s => s.ok && s.durationMs === 0)).toBe(true);
  });

  it('strips inline comments before dispatch', async () => {
    await executeSentinelCommands('acme', ['rm evil.php   # remove webshell'], stubServices());
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/evil.php'");
  });

  it('strips rm flags when building the NAS path', async () => {
    await executeSentinelCommands('acme', ['rm -rf -v wp-content/uploads/x.php'], stubServices());
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/wp-content/uploads/x.php'");
  });

  it('escapes single quotes in the deletion path', async () => {
    await executeSentinelCommands('acme', ["rm wp-content/it's.php"], stubServices());
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/wp-content/it'\\''s.php'");
  });

  it('truncates rm failure output to 300 characters', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'x'.repeat(500) }));
    const res = await executeSentinelCommands('acme', ['rm evil.php'], stubServices());
    expect(res.steps[0].error).toHaveLength(300);
    expect(res.success).toBe(false);
  });

  it('strips a leading "wp" and routes non-rm commands to remoteWpCliRun', async () => {
    const services = stubServices();
    await executeSentinelCommands('acme', ['wp plugin list --format=json'], services);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(services.remoteWpCliRun).toHaveBeenCalledWith('acme', ['plugin', 'list', '--format=json']);
  });

  it('marks the run failed but continues after a failing step', async () => {
    const services = stubServices({ stdout: 'nope', stderr: 'bad', success: false });
    const res = await executeSentinelCommands('acme', ['wp plugin list', 'wp core version'], services);
    expect(res.success).toBe(false);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].error).toBe('bad');
  });

  it('never rejects when the underlying call throws', async () => {
    const services = { remoteWpCliRun: jest.fn(async () => { throw new Error('kaboom'); }) } as any;
    const res = await executeSentinelCommands('acme', ['wp core version'], services);
    expect(res.success).toBe(false);
    expect(res.steps[0].error).toBe('kaboom');
  });
});
