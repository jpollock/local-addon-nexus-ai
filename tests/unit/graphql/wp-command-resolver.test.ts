/**
 * nexusWpCommand — the GraphQL resolver behind ~17 `nexus wp` CLI commands.
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
