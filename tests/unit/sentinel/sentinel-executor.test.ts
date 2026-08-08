import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { executeSentinelCommands } from '../../../src/main/sentinel/SentinelExecutor';
import { STORAGE_KEYS } from '../../../src/common/constants';

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

// Minimal `registryStorage` fixture: `getEffectiveSettings` reads
// STORAGE_KEYS.SETTINGS, and the environment lookup reads
// STORAGE_KEYS.WPE_INSTALL_CACHE. Both come from the same `.get()` call.
function stubRegistryStorage(opts: {
  environment?: string;
  remoteOperationPermissions?: Record<string, any>;
} = {}) {
  const settings = opts.remoteOperationPermissions
    ? { remoteOperationPermissions: opts.remoteOperationPermissions }
    : {};
  const installCache = opts.environment
    ? { installs: [{ installName: 'acme', environment: opts.environment }] }
    : null;
  return {
    get: jest.fn((key: string) => {
      if (key === STORAGE_KEYS.SETTINGS) return settings;
      if (key === STORAGE_KEYS.WPE_INSTALL_CACHE) return installCache;
      return null;
    }),
  } as any;
}

describe('executeSentinelCommands', () => {
  // Real behavior is fail-closed by default (mirrors `resolveTarget`'s WPE
  // gate): with no registryStorage, the install's environment resolves to
  // 'production' and DEFAULT_OPERATION_PERMISSIONS denies 'wpcli' there —
  // and 'delete' is denied in *every* environment by default. Every
  // pre-existing test in this file exercises dispatch behavior (command
  // parsing, error propagation, etc.), not the permission gate itself, so
  // they all opt into an install with both operations explicitly permitted,
  // to keep exercising that behavior unchanged.
  const permissive = stubRegistryStorage({
    environment: 'development',
    remoteOperationPermissions: {
      wpcli: { development: true, staging: true, production: true },
      delete: { development: true, staging: true, production: true },
    },
  });

  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  it('skips full-line comments and blank lines without spawning', async () => {
    const res = await executeSentinelCommands('acme', ['# a note', '', '   '], stubServices(), permissive);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.steps).toHaveLength(3);
    expect(res.steps.every(s => s.ok && s.durationMs === 0)).toBe(true);
  });

  it('strips inline comments before dispatch', async () => {
    await executeSentinelCommands('acme', ['rm evil.php   # remove webshell'], stubServices(), permissive);
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/evil.php'");
  });

  it('strips rm flags when building the NAS path', async () => {
    await executeSentinelCommands('acme', ['rm -rf -v wp-content/uploads/x.php'], stubServices(), permissive);
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/wp-content/uploads/x.php'");
  });

  it('escapes single quotes in the deletion path', async () => {
    await executeSentinelCommands('acme', ["rm wp-content/it's.php"], stubServices(), permissive);
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/wp-content/it'\\''s.php'");
  });

  it('truncates rm failure output to 300 characters', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'x'.repeat(500) }));
    const res = await executeSentinelCommands('acme', ['rm evil.php'], stubServices(), permissive);
    expect(res.steps[0].error).toHaveLength(300);
    expect(res.success).toBe(false);
  });

  it('strips a leading "wp" and routes non-rm commands to remoteWpCliRun', async () => {
    const services = stubServices();
    await executeSentinelCommands('acme', ['wp plugin list --format=json'], services, permissive);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(services.remoteWpCliRun).toHaveBeenCalledWith('acme', ['plugin', 'list', '--format=json']);
  });

  it('marks the run failed but continues after a failing step', async () => {
    const services = stubServices({ stdout: 'nope', stderr: 'bad', success: false });
    const res = await executeSentinelCommands('acme', ['wp plugin list', 'wp core version'], services, permissive);
    expect(res.success).toBe(false);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].error).toBe('bad');
  });

  it('never rejects when the underlying call throws', async () => {
    const services = { remoteWpCliRun: jest.fn(async () => { throw new Error('kaboom'); }) } as any;
    const res = await executeSentinelCommands('acme', ['wp core version'], services, permissive);
    expect(res.success).toBe(false);
    expect(res.steps[0].error).toBe('kaboom');
  });

  it('refuses a wp-cli command on production when wpcli is not permitted', async () => {
    // No explicit override needed: DEFAULT_OPERATION_PERMISSIONS already
    // denies 'wpcli' on 'production'.
    const services = stubServices();
    const registryStorage = stubRegistryStorage({ environment: 'production' });
    const result = await executeSentinelCommands(
      'acme', ['wp option get siteurl'], services, registryStorage,
    );
    expect(result.success).toBe(false);
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].error).toMatch(/blocked|not permitted/i);
    expect(services.remoteWpCliRun).not.toHaveBeenCalled();
  });

  it('refuses an rm command on production when delete is not permitted', async () => {
    // Default policy denies 'delete' in every environment, not just production.
    const services = stubServices();
    const registryStorage = stubRegistryStorage({ environment: 'production' });
    const result = await executeSentinelCommands(
      'acme', ['rm -f wp-content/mu-plugins/bad.php'], services, registryStorage,
    );
    expect(result.success).toBe(false);
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].error).toMatch(/blocked|not permitted/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('still executes when the operation is permitted (no regression on the happy path)', async () => {
    // 'development' allows both 'wpcli' and 'delete' by default — confirms
    // the gate does not block a genuinely-allowed case.
    const services = stubServices();
    const registryStorage = stubRegistryStorage({
      environment: 'production',
      remoteOperationPermissions: {
        wpcli: { development: true, staging: true, production: true },
        delete: { development: true, staging: true, production: true },
      },
    });
    const result = await executeSentinelCommands(
      'acme', ['wp option get siteurl'], services, registryStorage,
    );
    expect(result.success).toBe(true);
    expect(services.remoteWpCliRun).toHaveBeenCalledWith('acme', ['option', 'get', 'siteurl']);
  });
});
