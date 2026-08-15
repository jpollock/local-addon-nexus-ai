/**
 * The extraction seam (ADR-16).
 *
 * Everything the intelligence core needs from its host arrives through these
 * ports. The core NEVER imports electron, @getflywheel/*, or anything under
 * src/main or src/renderer — enforced by this directory's .eslintrc.json.
 * Extracting the core to a standalone daemon later means re-implementing
 * these three small interfaces, nothing else.
 */

export interface ClockPort {
  now(): Date;
}

export interface IdentityPort {
  /** The session actor (ADR-14: human/agent session on this machine). */
  actor(): { id: string; kind: 'human' | 'agent' | 'ability' | 'system' };
  /** This satellite's identity — becomes actor.via on every event. */
  via(): string;
  /** Tenant for the access block (ADR-11; single-tenant 'local' until the hub exists). */
  tenant(): string;
}

export interface StoragePort {
  /** Absolute path for the ledger database file (or ':memory:' in tests). */
  ledgerDbPath(): string;
}

export interface HostPorts {
  clock: ClockPort;
  identity: IdentityPort;
  storage: StoragePort;
}

export const systemClock: ClockPort = { now: () => new Date() };
