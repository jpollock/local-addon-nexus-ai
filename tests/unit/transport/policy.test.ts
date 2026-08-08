import { REMOTE_POLICY, checkCommand, withPolicy } from '../../../src/main/transport/policy';
import { ExternalSshTransport } from '../../../src/main/transport/ExternalSshTransport';
import type { SiteTransport } from '../../../src/main/transport/types';

describe('REMOTE_POLICY — one policy for every remote target', () => {
  it('blocks exactly the five arbitrary-code commands', () => {
    for (const cmd of [['eval','x'], ['eval-file','x'], ['shell'], ['db','query','SELECT 1'], ['db','cli']]) {
      expect(checkCommand(cmd, REMOTE_POLICY)).not.toBeNull();
    }
  });

  it('has no whitelist — an unlisted command is permitted', () => {
    expect(REMOTE_POLICY.allowed).toBeUndefined();
    expect(checkCommand(['cron','event','list'], REMOTE_POLICY)).toBeNull();
  });

  // The five tools MCP_REMOTE_POLICY's whitelist made permanently dead on WPE.
  it.each([
    ['core update',    ['core','update']],
    ['theme activate', ['theme','activate','twentytwentyfour']],
    ['post create',    ['post','create','--post_title=x']],
    ['post update',    ['post','update','12']],
    ['post delete',    ['post','delete','12']],
  ])('permits %s, which the old whitelist refused', (_label, cmd) => {
    expect(checkCommand(cmd as string[], REMOTE_POLICY)).toBeNull();
  });

  // The eight CLI commands that unifying UPWARD would have broken.
  it.each([
    [['theme','activate','x']], [['core','update']], [['db','export']],
    [['db','import','f.sql']], [['search-replace','a','b']],
    [['post','create']], [['post','update','1']], [['post','delete','1']],
  ])('keeps CLI command %j working on WP Engine', (cmd) => {
    expect(checkCommand(cmd as string[], REMOTE_POLICY)).toBeNull();
  });
});

describe('withPolicy', () => {
  const inner = () => ({
    kind: 'wpe-ssh' as const,
    siteRef: { kind: 'wpe' as const, installName: 'acmeprod' },
    runWpCli: jest.fn(async () => ({ stdout: 'ran', success: true })),
    deleteRemoteFile: jest.fn(async () => ({ success: true, output: '' })),
    probe: jest.fn(async () => ({ reachable: true })),
  });

  it('passes permitted commands through to the inner transport', async () => {
    const t = inner();
    const res = await withPolicy(t, REMOTE_POLICY).runWpCli(['plugin', 'list']);
    expect(t.runWpCli).toHaveBeenCalledWith(['plugin', 'list'], undefined);
    expect(res).toEqual({ stdout: 'ran', success: true });
  });

  it('returns the legacy wrapper result shape for a blocklist hit, without calling through', async () => {
    const t = inner();
    const res = await withPolicy(t, REMOTE_POLICY).runWpCli(['eval', '<?php']);
    expect(t.runWpCli).not.toHaveBeenCalled();
    expect(res).toEqual({
      stdout: 'Command "eval" is blocked for security reasons on remote sites.',
      success: false,
    });
  });

  it('does not gate deleteRemoteFile or probe', async () => {
    const t = inner();
    const wrapped = withPolicy(t, REMOTE_POLICY);
    await wrapped.deleteRemoteFile('/tmp/x');
    await wrapped.probe();
    expect(t.deleteRemoteFile).toHaveBeenCalled();
    expect(t.probe).toHaveBeenCalled();
    expect(wrapped.kind).toBe('wpe-ssh');
  });
});

function makeExternalLikeTransport(batchImpl?: (c: string[][]) => Promise<(string | null)[]>) {
  const base: SiteTransport & { runWpCliBatch?: any } = {
    kind: 'external-ssh' as any,
    siteRef: { kind: 'external', alias: 'test' } as any,
    probe: async () => ({ reachable: true }),
    deleteRemoteFile: async () => ({ success: false, output: 'n/a' }),
    runWpCli: async () => ({ stdout: '', success: true }),
  };
  if (batchImpl) (base as any).runWpCliBatch = batchImpl;
  return base;
}

describe('withPolicy forwards runWpCliBatch', () => {
  // Every other test here hand-builds an object literal that already has
  // runWpCliBatch, so deleting the method from the concrete class would leave
  // them all green — the exact blind spot that let the original bug survive six
  // tasks. This one composes the REAL class with the REAL wrapper. It never
  // SSHes anywhere: constructing the transport opens no connection.
  it('forwards runWpCliBatch from a real ExternalSshTransport', () => {
    const wrapped = withPolicy(new ExternalSshTransport('some-alias'), REMOTE_POLICY);
    expect(typeof wrapped.runWpCliBatch).toBe('function');
  });

  it('forwards runWpCliBatch when the wrapped transport has one', async () => {
    const batchImpl = jest.fn(async (c: string[][]) => c.map(() => 'ok'));
    const wrapped = withPolicy(makeExternalLikeTransport(batchImpl), REMOTE_POLICY);
    expect(wrapped.runWpCliBatch).toBeDefined();
    const result = await wrapped.runWpCliBatch!([['core', 'version'], ['option', 'get', 'siteurl']]);
    expect(result).toEqual(['ok', 'ok']);
    expect(batchImpl).toHaveBeenCalledWith([['core', 'version'], ['option', 'get', 'siteurl']]);
  });

  it('does not add runWpCliBatch when the wrapped transport has none (e.g. Local/WPE)', () => {
    const wrapped = withPolicy(makeExternalLikeTransport(/* no batch impl */), REMOTE_POLICY);
    expect(wrapped.runWpCliBatch).toBeUndefined();
  });

  it('fails the whole batch closed (all nulls) when any sub-command is blocked', async () => {
    const batchImpl = jest.fn(async (c: string[][]) => c.map(() => 'should not run'));
    const wrapped = withPolicy(makeExternalLikeTransport(batchImpl), REMOTE_POLICY);
    const result = await wrapped.runWpCliBatch!([
      ['core', 'version'],
      ['eval', 'echo 1'],       // blocked by REMOTE_POLICY
      ['option', 'get', 'siteurl'],
    ]);
    expect(result).toEqual([null, null, null]);
    expect(batchImpl).not.toHaveBeenCalled();
  });

  it('permits a batch where no sub-command is blocked', async () => {
    const batchImpl = jest.fn(async (c: string[][]) => c.map(() => 'ok'));
    const wrapped = withPolicy(makeExternalLikeTransport(batchImpl), REMOTE_POLICY);
    const result = await wrapped.runWpCliBatch!([
      ['plugin', 'list', '--format=json'],
      ['theme', 'list', '--format=json'],
    ]);
    expect(result).toEqual(['ok', 'ok']);
  });
});
