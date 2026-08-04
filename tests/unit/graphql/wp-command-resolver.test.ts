/**
 * nexusWpCommand and nexusWpPluginList — the GraphQL resolvers behind the
 * `nexus wp` CLI commands.
 *
 * It used to hand-roll its own target resolution, command blocklist and
 * permission gate, and knew only two target types. These tests pin the
 * delegation to resolveTransport (the one router) and — just as important —
 * that the `cli.wp.command` audit entry survives on every outcome, since
 * neither resolveTransport nor ToolRegistry.call()'s chokepoint audits here.
 */

const auditMock = jest.fn();
jest.mock('../../../src/main/audit/auditDirectOperation', () => ({
  auditDirectOperation: (...a: any[]) => auditMock(...a),
}));
const resolveTransportMock = jest.fn();
jest.mock('../../../src/main/transport', () => ({
  ...jest.requireActual('../../../src/main/transport'),
  resolveTransport: (...a: any[]) => resolveTransportMock(...a),
}));

import { createResolvers } from '../../../src/main/graphql/resolvers';

function ctx(sites: string[] = []) {
  const s = Object.fromEntries(sites.map((n) => [n, { id: `id-${n}`, name: n }]));
  return {
    services: {
      localServices: { wpCliRun: jest.fn(), isSSHKeyAvailable: () => true },
      siteData: { getSites: () => s, getSite: (i: string) => (s as any)[i] ?? null },
      graphService: { getDb: () => undefined },
      registryStorage: { get: () => ({}), set: jest.fn() },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    },
    registry: {},
  } as any;
}
const transport = (res: any, siteRef: any = { kind: 'external', alias: 'box' }) =>
  ({ siteRef, runWpCli: jest.fn().mockResolvedValue(res) });

beforeEach(() => { auditMock.mockReset(); resolveTransportMock.mockReset(); });

describe('nexusWpCommand', () => {
  it('routes an ssh: target through resolveTransport', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: '7.0.2', success: true }));
    const r = await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(r.success).toBe(true);
    expect(r.stdout).toBe('7.0.2');
    expect(resolveTransportMock).toHaveBeenCalledWith(
      { ssh_target: 'ssh:box@production' }, expect.anything(), 'wpcli_read');
  });

  it('classifies a write and passes wpcli', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'ok', success: true }));
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(resolveTransportMock).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'wpcli');
  });

  it('returns the resolution error instead of throwing', async () => {
    resolveTransportMock.mockResolvedValue({ content: [{ text: 'Operation blocked: nope' }], isError: true });
    const r = await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Operation blocked');
    expect(r.exitCode).toBe(1);
  });

  it('audits on success', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'ok', success: true }));
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'cli.wp.command', outcome: 'success' });
  });

  it('audits on failure', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'boom', success: false }));
    const r = await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'cli.wp.command', outcome: 'failure' });
    // Both SSH transports fold their error text into stdout and set NEITHER
    // stderr nor exitCode. Collapsing failText to result.stderr reports an
    // empty failure and loses the only diagnosis the user gets.
    expect(r.error).toBe('boom');
    expect(auditMock.mock.calls[0][1].error).toBe('boom');
  });

  it('treats exitCode 0 as success even when success is false', async () => {
    // Some bridge paths report success only via exitCode. Collapsing okRun to
    // result.success turns those runs into spurious failures.
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'done', success: false, exitCode: 0 }));
    const r = await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(r.success).toBe(true);
    expect(r.error).toBeNull();
    expect(r.exitCode).toBe(0);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'success' });
  });

  it('records the resolved identity, which the target string alone cannot carry', async () => {
    // A bare name that falls back to a WP Engine install is byte-identical to a
    // local site name in `target`, and the argv is withheld. Without this the
    // entry cannot say whether production was touched.
    resolveTransportMock.mockResolvedValue(
      transport({ stdout: 'ok', success: true }, { kind: 'wpe', installName: 'acme-prod' }));
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'acme-prod', command: ['core', 'version'] });
    expect(auditMock.mock.calls[0][1].parameters).toMatchObject({
      resolved: { kind: 'wpe', installName: 'acme-prod' },
    });
  });

  it('omits resolved when nothing was resolved', async () => {
    resolveTransportMock.mockResolvedValue({ content: [{ text: 'Operation blocked' }], isError: true });
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(auditMock.mock.calls[0][1].parameters).not.toHaveProperty('resolved');
  });

  it('audits a refused resolution too — the attempt is the record', async () => {
    resolveTransportMock.mockResolvedValue({ content: [{ text: 'Operation blocked' }], isError: true });
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'failure' });
  });
});

const PLUGIN_JSON = JSON.stringify([
  { name: 'akismet', title: 'Akismet Anti-spam', status: 'active', version: '5.3', update_version: '5.4' },
]);

describe('nexusWpPluginList', () => {
  const list = (target: string) =>
    createResolvers(ctx()).Mutation.nexusWpPluginList(null, { target });

  it('does not crash on an ssh: target — the whole point of the migration', async () => {
    // Before the migration an ssh: target fell past the `local` branch into the
    // WPE `else`, where parsed.installName is undefined:
    //   "Cannot read properties of undefined (reading 'split')".
    // Reachable via `nexus wp plugin list <ssh-target> --json` (wp.ts:31 skips
    // the MCP path for --json) and whenever the MCP server is down.
    resolveTransportMock.mockResolvedValue(transport({ stdout: PLUGIN_JSON, success: true }));
    const r = await list('ssh:box@production');
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.plugins).toEqual([{
      name: 'Akismet Anti-spam', slug: 'akismet', status: 'active',
      version: '5.3', update: '5.4', autoUpdate: null,
    }]);
  });

  it('classifies plugin list as a read and passes wpcli_read to the gate', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: '[]', success: true }));
    await list('ssh:box@production');
    expect(resolveTransportMock).toHaveBeenCalledWith(
      { ssh_target: 'ssh:box@production' }, expect.anything(), 'wpcli_read');
  });

  it('asks for the fields the response shape promises', async () => {
    // Plain --format=json returns neither title nor update_version, so `name`
    // would silently become the slug and `update` would always be null.
    const t = transport({ stdout: '[]', success: true });
    resolveTransportMock.mockResolvedValue(t);
    await list('ssh:box@production');
    expect(t.runWpCli).toHaveBeenCalledWith([
      'plugin', 'list', '--format=json',
      '--fields=name,title,version,status,update_version',
    ]);
  });

  it('returns the refusal instead of throwing, and audits it', async () => {
    resolveTransportMock.mockResolvedValue({ content: [{ text: 'Operation blocked: nope' }], isError: true });
    const r = await list('ssh:box@production');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Operation blocked');
    expect(r.plugins).toEqual([]);
    expect(auditMock.mock.calls[0][1]).toMatchObject({
      operation: 'cli.wp.plugin.list', outcome: 'failure',
    });
  });

  it('audits success with the resolved identity', async () => {
    resolveTransportMock.mockResolvedValue(
      transport({ stdout: '[]', success: true }, { kind: 'wpe', installName: 'acme-prod' }));
    await list('acme-prod');
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({
      operation: 'cli.wp.plugin.list', outcome: 'success',
    });
    expect(auditMock.mock.calls[0][1].parameters).toMatchObject({
      resolved: { kind: 'wpe', installName: 'acme-prod' },
    });
  });

  it('keeps the WPE hostname hint on a failed remote lookup', async () => {
    resolveTransportMock.mockResolvedValue(transport(
      { stdout: 'ssh: Could not resolve hostname nope.ssh.wpengine.net', success: false },
      { kind: 'wpe', installName: 'nope' }));
    const r = await list('wpe:acct/nope@production');
    expect(r.success).toBe(false);
    expect(r.error).toContain('nope.ssh.wpengine.net');
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'failure' });
  });

  it('does not dress up an external host failure as a WPE one', async () => {
    resolveTransportMock.mockResolvedValue(
      transport({ stdout: 'Permission denied (publickey).', success: false }));
    const r = await list('ssh:box@production');
    expect(r.error).toBe('Permission denied (publickey).');
  });

  it('reports unparseable output rather than throwing', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'PHP Warning: ...', success: true }));
    const r = await list('ssh:box@production');
    expect(r.success).toBe(false);
    expect(r.error).toBe('Failed to parse plugin list JSON');
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'failure' });
  });

  it('audits a thrown exception', async () => {
    resolveTransportMock.mockRejectedValue(new Error('graph db exploded'));
    const r = await list('ssh:box@production');
    expect(r.success).toBe(false);
    expect(r.error).toBe('graph db exploded');
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'failure', error: 'graph db exploded' });
  });
});
