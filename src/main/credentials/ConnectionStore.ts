import type { RegistryStorage } from '../content/IndexRegistry';
import type { Connection, Grant } from './types';
import { STORAGE_KEYS } from '../../common/constants';

export class ConnectionStore {
  constructor(private storage: RegistryStorage) {}

  private readConnections(): Record<string, Connection> {
    return (this.storage.get(STORAGE_KEYS.OAUTH_CONNECTIONS) ?? {}) as Record<string, Connection>;
  }

  private writeConnections(data: Record<string, Connection>): void {
    this.storage.set(STORAGE_KEYS.OAUTH_CONNECTIONS, data);
  }

  private readGrants(): Grant[] {
    return (this.storage.get(STORAGE_KEYS.OAUTH_GRANTS) ?? []) as Grant[];
  }

  private writeGrants(grants: Grant[]): void {
    this.storage.set(STORAGE_KEYS.OAUTH_GRANTS, grants);
  }

  // ── Connections ────────────────────────────────────────────────────────────

  saveConnection(conn: Connection): void {
    const data = this.readConnections();
    data[conn.id] = conn;
    this.writeConnections(data);
  }

  getConnection(id: string): Connection | null {
    return this.readConnections()[id] ?? null;
  }

  listConnections(): Connection[] {
    return Object.values(this.readConnections());
  }

  deleteConnection(id: string): void {
    const data = this.readConnections();
    delete data[id];
    this.writeConnections(data);
  }

  // ── Grants ─────────────────────────────────────────────────────────────────

  saveGrant(grant: Grant): void {
    const grants = this.readGrants().filter(
      g => !(g.connectionId === grant.connectionId && g.agentId === grant.agentId && g.siteId === grant.siteId),
    );
    grants.push(grant);
    this.writeGrants(grants);
  }

  getGrant(connectionId: string, agentId: string, siteId: string): Grant | null {
    return this.readGrants().find(
      g => g.connectionId === connectionId && g.agentId === agentId && g.siteId === siteId,
    ) ?? null;
  }

  listGrantsForConnection(connectionId: string): Grant[] {
    return this.readGrants().filter(g => g.connectionId === connectionId);
  }

  listGrantsForAgent(agentId: string): Grant[] {
    return this.readGrants().filter(g => g.agentId === agentId);
  }

  deleteGrant(connectionId: string, agentId: string, siteId: string): void {
    this.writeGrants(this.readGrants().filter(
      g => !(g.connectionId === connectionId && g.agentId === agentId && g.siteId === siteId),
    ));
  }

  deleteGrantsForConnection(connectionId: string): void {
    this.writeGrants(this.readGrants().filter(g => g.connectionId !== connectionId));
  }
}
