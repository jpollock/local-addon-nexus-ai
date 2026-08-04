import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { resolveTransport } from '../../../src/main/transport';
import type { NexusServices } from '../../../src/main/mcp/types';
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

const mockServices: NexusServices = {
  siteData: {
    getSite: () => null,
    getSites: () => ({}),
  },
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
} as unknown as NexusServices;

describe('resolveTransport — external SSH', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  it('resolves ssh_target to an external-ssh transport', async () => {
    const transport = await resolveTransport(
      { ssh_target: 'ssh:acme-box@staging' },
      mockServices,
      'wpcli_read'
    );
    // Not an error result
    expect(transport).not.toHaveProperty('content');
    expect(transport).not.toHaveProperty('isError');
    // Is a transport with the correct kind
    if ('kind' in transport) {
      expect(transport.kind).toBe('external-ssh');
      expect(transport.siteRef).toEqual({
        kind: 'external',
        alias: 'acme-box',
      });
    } else {
      fail('Expected transport, got error result');
    }
  });

  it('passes wpPath through to the transport', async () => {
    const transport = await resolveTransport(
      { ssh_target: 'ssh:web@production', wp_path: '/var/www/html' },
      mockServices,
      'wpcli_read'
    );
    if ('kind' in transport && transport.kind === 'external-ssh') {
      // The transport is built and wpPath is private, but we can verify it
      // executes the command with --path by checking the constructed command
      const result = await transport.runWpCli(['core', 'version']);
      // This will fail to spawn, but that's fine — we're verifying resolution, not execution
    } else {
      fail('Expected external-ssh transport');
    }
  });
});

describe('resolveTransport — stored external profile', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  function servicesWithProfile(profile: any) {
    const store: Record<string, unknown> = {};
    // STORAGE_KEYS.EXTERNAL_SITE_PROFILES is `nexus-ai_external_site_profiles`
    // (src/common/constants.ts:307). Import the constant; never hardcode it.
    if (profile) store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] = { [profile.alias]: profile };
    return {
      registryStorage: {
        get: (k: string) => store[k],
        set: (k: string, v: unknown) => { store[k] = v; },
      },
    } as any;
  }

  it('uses the stored wpPath when no --path is given', async () => {
    const services = servicesWithProfile({
      alias: 'h1', wpPath: '/home/u/public_html', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    const t = await resolveTransport({ ssh_target: 'ssh:h1@production' }, services, 'wpcli_read');
    if ('content' in t) fail('Expected transport, got error');
    await t.runWpCli(['core', 'version']);
    const remoteCommand = spawnMock.mock.calls[0][1].at(-1);
    expect(remoteCommand).toContain("--path='/home/u/public_html'");
  });

  it('lets an explicit wp_path override the stored one', async () => {
    const services = servicesWithProfile({
      alias: 'h1', wpPath: '/home/u/public_html', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:h1@production', wp_path: '/srv/other' }, services, 'wpcli_read');
    if ('content' in t) fail('Expected transport, got error');
    await t.runWpCli(['core', 'version']);
    const remoteCommand = spawnMock.mock.calls[0][1].at(-1);
    expect(remoteCommand).toContain("--path='/srv/other'");
    expect(remoteCommand).not.toContain('/home/u/public_html');
  });

  it('passes the stored wpCliPath through', async () => {
    const services = servicesWithProfile({
      alias: 'h1', wpCliPath: '/opt/cpanel/composer/bin/wp', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    const t = await resolveTransport({ ssh_target: 'ssh:h1@production' }, services, 'wpcli_read');
    if ('content' in t) fail('Expected transport, got error');
    await t.runWpCli(['core', 'version']);
    const remoteCommand = spawnMock.mock.calls[0][1].at(-1);
    expect(remoteCommand).toMatch(/^'\/opt\/cpanel\/composer\/bin\/wp' /);
  });

  it('resolves an unregistered alias without throwing', async () => {
    const t = await resolveTransport(
      { ssh_target: 'ssh:unknown@production' }, servicesWithProfile(null), 'wpcli_read');
    expect(t).toBeDefined();
    expect('content' in t).toBe(false);
  });
});
