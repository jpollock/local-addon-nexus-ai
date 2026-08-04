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
const transport = (res: any) => ({ runWpCli: jest.fn().mockResolvedValue(res) });

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
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'cli.wp.command', outcome: 'failure' });
  });

  it('audits a refused resolution too — the attempt is the record', async () => {
    resolveTransportMock.mockResolvedValue({ content: [{ text: 'Operation blocked' }], isError: true });
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'failure' });
  });
});
