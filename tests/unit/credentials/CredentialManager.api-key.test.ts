import { CredentialManager } from '../../../src/main/credentials/CredentialManager';
import { NotConnectedError } from '../../../src/main/credentials/types';

function makeManager(): CredentialManager {
  const mem = new Map<string, unknown>();
  const storage = { get: (k: string) => mem.get(k), set: (k: string, v: unknown) => mem.set(k, v) };
  return new CredentialManager({
    storage: storage as any,
    emitNexusState: () => {},
    emitCredentialEvent: () => {},
  });
}

describe('CredentialManager api_key', () => {
  it('setApiKey stores and returns a connectionId', async () => {
    const mgr = makeManager();
    const id = await mgr.setApiKey('aws', { accessKeyId: 'AKIA123', secretAccessKey: 'secret' }, 'arn:aws:iam::123:user/nexus');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('getSecretForAgent returns stored fields', async () => {
    const mgr = makeManager();
    await mgr.setApiKey('aws', { accessKeyId: 'AKIA123', secretAccessKey: 'secret' }, 'arn');
    const fields = await mgr.getSecretForAgent('aws', 'log-processor');
    expect(fields.accessKeyId).toBe('AKIA123');
    expect(fields.secretAccessKey).toBe('secret');
  });

  it('getSecretForAgent throws NotConnectedError when no connection', async () => {
    const mgr = makeManager();
    await expect(mgr.getSecretForAgent('aws', 'log-processor')).rejects.toThrow(NotConnectedError);
  });

  it('markApiKeyRevoked marks the active connection revoked', async () => {
    const mgr = makeManager();
    await mgr.setApiKey('aws', { accessKeyId: 'AKIA123', secretAccessKey: 'secret' }, 'arn');
    mgr.markApiKeyRevoked('aws');
    const conns = mgr.listApiKeyConnections('aws');
    expect(conns[0].status).toBe('revoked');
  });

  it('getSecretForAgent throws NotConnectedError when connection is revoked', async () => {
    const mgr = makeManager();
    await mgr.setApiKey('aws', { accessKeyId: 'AKIA123', secretAccessKey: 'secret' }, 'arn');
    mgr.markApiKeyRevoked('aws');
    await expect(mgr.getSecretForAgent('aws', 'log-processor')).rejects.toThrow(NotConnectedError);
  });

  it('clearApiKey marks the connection revoked', async () => {
    const mgr = makeManager();
    const id = await mgr.setApiKey('aws', { accessKeyId: 'AKIA123', secretAccessKey: 'secret' }, 'arn');
    mgr.clearApiKey(id);
    const conns = mgr.listApiKeyConnections('aws');
    expect(conns).toHaveLength(1);
    expect(conns[0].status).toBe('revoked');
  });
});
