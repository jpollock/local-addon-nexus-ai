import type { RegistryStorage } from '../content/IndexRegistry';
import type { ApiKeyConnection } from './types';
import { STORAGE_KEYS } from '../../common/constants';

export class ApiKeyConnectionStore {
  constructor(private storage: RegistryStorage) {}

  private read(): ApiKeyConnection[] {
    return (this.storage.get(STORAGE_KEYS.API_KEY_CONNECTIONS) ?? []) as ApiKeyConnection[];
  }

  private write(conns: ApiKeyConnection[]): void {
    this.storage.set(STORAGE_KEYS.API_KEY_CONNECTIONS, conns);
  }

  save(conn: ApiKeyConnection): void {
    const conns = this.read().filter(c => c.id !== conn.id);
    conns.push(conn);
    this.write(conns);
  }

  get(id: string): ApiKeyConnection | null {
    return this.read().find(c => c.id === id) ?? null;
  }

  list(provider?: string): ApiKeyConnection[] {
    const conns = this.read();
    return provider ? conns.filter(c => c.provider === provider) : conns;
  }

  markRevoked(id: string): void {
    const conn = this.get(id);
    if (!conn) return;
    this.save({ ...conn, status: 'revoked' });
  }

  delete(id: string): void {
    const conns = this.read().filter(c => c.id !== id);
    this.write(conns);
  }
}
