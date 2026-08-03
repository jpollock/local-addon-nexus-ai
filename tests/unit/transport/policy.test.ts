import {
  checkCommand,
  withPolicy,
  MCP_REMOTE_POLICY,
  GRAPHQL_REMOTE_POLICY,
  EXTERNAL_REMOTE_POLICY,
} from '../../../src/main/transport/policy';

describe('MCP_REMOTE_POLICY (blocklist + whitelist)', () => {
  it('allows a whitelisted command', () => {
    expect(checkCommand(['plugin', 'list'], MCP_REMOTE_POLICY)).toBeNull();
  });
  it('blocks eval', () => {
    expect(checkCommand(['eval', '<?php'], MCP_REMOTE_POLICY)).toBe('eval');
  });
  it('blocks db cli', () => {
    expect(checkCommand(['db', 'cli'], MCP_REMOTE_POLICY)).toBe('db cli');
  });
  it('rejects a non-whitelisted command', () => {
    expect(checkCommand(['core', 'update'], MCP_REMOTE_POLICY))
      .toMatch(/not allowed for remote execution/);
  });
});

describe('GRAPHQL_REMOTE_POLICY (blocklist only)', () => {
  it('allows core update — no whitelist on this path', () => {
    expect(checkCommand(['core', 'update'], GRAPHQL_REMOTE_POLICY)).toBeNull();
  });
  it('blocks eval', () => {
    expect(checkCommand(['eval', '<?php'], GRAPHQL_REMOTE_POLICY)).toBe('eval');
  });
  it('does NOT block db cli — the GraphQL blocklist omits it, preserved deliberately', () => {
    expect(checkCommand(['db', 'cli'], GRAPHQL_REMOTE_POLICY)).toBeNull();
  });
});

describe('EXTERNAL_REMOTE_POLICY (blocklist only, no whitelist)', () => {
  it('blocks the dangerous five', () => {
    expect(checkCommand(['eval', '<?php'], EXTERNAL_REMOTE_POLICY)).toBe('eval');
    expect(checkCommand(['shell'], EXTERNAL_REMOTE_POLICY)).toBe('shell');
    expect(checkCommand(['db', 'cli'], EXTERNAL_REMOTE_POLICY)).toBe('db cli');
  });

  it('permits core update — which MCP_REMOTE_POLICY refuses', () => {
    // The divergence is the point. Applying MCP's 14-command whitelist to
    // external hosts would reproduce, on day one, the five permanently-dead
    // MCP tools and contradict the full-parity decision.
    expect(checkCommand(['core', 'update'], EXTERNAL_REMOTE_POLICY)).toBeNull();
    expect(checkCommand(['core', 'update'], MCP_REMOTE_POLICY))
      .toMatch(/not allowed for remote execution/);
  });

  it('permits post create and theme activate — also refused by MCP', () => {
    expect(checkCommand(['post', 'create'], EXTERNAL_REMOTE_POLICY)).toBeNull();
    expect(checkCommand(['theme', 'activate', 'x'], EXTERNAL_REMOTE_POLICY)).toBeNull();
  });

  it('has no whitelist at all', () => {
    expect(EXTERNAL_REMOTE_POLICY.allowed).toBeUndefined();
  });
});

describe('withPolicy', () => {
  const inner = () => ({
    kind: 'wpe-ssh' as const,
    siteRef: { kind: 'wpe' as const, installName: 'acmeprod' },
    runWpCli: jest.fn(async () => ({ stdout: 'ran', success: true })),
    deleteRemoteFile: jest.fn(async () => ({ success: true, output: '' })),
    supports: () => true,
    probe: jest.fn(async () => ({ reachable: true })),
  });

  it('passes permitted commands through to the inner transport', async () => {
    const t = inner();
    const res = await withPolicy(t, MCP_REMOTE_POLICY).runWpCli(['plugin', 'list']);
    expect(t.runWpCli).toHaveBeenCalledWith(['plugin', 'list'], undefined);
    expect(res).toEqual({ stdout: 'ran', success: true });
  });

  it('returns the legacy wrapper result shape for a blocklist hit, without calling through', async () => {
    const t = inner();
    const res = await withPolicy(t, MCP_REMOTE_POLICY).runWpCli(['eval', '<?php']);
    expect(t.runWpCli).not.toHaveBeenCalled();
    expect(res).toEqual({
      stdout: 'Command "eval" is blocked for security reasons on remote sites.',
      success: false,
    });
  });

  it('reproduces the legacy nested-quote message on a whitelist miss — ugly, but current behaviour', async () => {
    const res = await withPolicy(inner(), MCP_REMOTE_POLICY).runWpCli(['core', 'update']);
    expect(res).toEqual({
      stdout: 'Command "Command "core update" not allowed for remote execution. '
            + 'Use local WP-CLI for advanced operations." is blocked for security reasons on remote sites.',
      success: false,
    });
  });

  it('does not gate deleteRemoteFile, supports or probe', async () => {
    const t = inner();
    const wrapped = withPolicy(t, MCP_REMOTE_POLICY);
    await wrapped.deleteRemoteFile('/tmp/x');
    await wrapped.probe();
    expect(t.deleteRemoteFile).toHaveBeenCalled();
    expect(t.probe).toHaveBeenCalled();
    expect(wrapped.kind).toBe('wpe-ssh');
  });
});
