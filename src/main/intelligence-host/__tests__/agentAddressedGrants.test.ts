/**
 * fixes-082526 · agent-addressed grants (packet phase 1) — the grant unit
 * becomes (grantee, capability), and the flip is FAIL-CLOSED.
 *
 * Rulings (2026-08-26, owner): grants widen to (grantee, capability); three
 * grantee classes — named agents, 'chat', 'mcp-client'; existing platform-wide
 * grants are REVOKED at the flip with an honest recorded reason, chained to
 * the act they end (the WP-20f precedent) — no fan-out, no grandfathering.
 *
 * The trap this suite exists to spring: MATERIALIZED_STORAGE_KEY presence
 * short-circuits re-materialization, so a flip that revoked the issuance
 * marker but left the v1 materialized record standing would silently re-grant
 * everything on the very next sync. Both markers convert, or the flip is a lie.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import {
  CHAT_GRANTEE,
  MCP_CLIENT_GRANTEE,
  GRANT_ISSUED_TOPIC,
  GRANT_REVOKED_TOPIC,
  GRANTS_STORAGE_KEY,
  MATERIALIZED_STORAGE_KEY,
  MANDATED_EXPLICIT_CAPABILITIES,
  getCapabilityGrants,
  getDisarmedCapabilityGrants,
  syncCapabilityGrants,
} from '../capabilityGrants';
import type { EventEnvelope } from '../../../intelligence';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, error: () => {} };
const ANCHOR = 'cap.bulk_plugin_update';
const AGENT = 'security-sentinel';
/**
 * The materialization target — BUILTINS ONLY, by design. Bootstrap's first
 * sync runs before agent discovery, and under the fail-closed ruling an agent
 * auto-receiving grants at discovery would be looser than what upgrading
 * machines get (explicit re-grants). So chat and mcp-client — the
 * human-in-the-loop surfaces, consent at every checkpoint — carry the WP-20f
 * out-of-box set, and an agent holds ONLY what a human granted it. Ever.
 */
const BUILTINS = [CHAT_GRANTEE, MCP_CLIENT_GRANTEE];

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

/**
 * Storage exists BEFORE the core: bootstrap's init runs its own grant sync,
 * so a v1 world must be on disk when the core comes up — exactly the real
 * upgrade path, where the flip fires inside the first boot's sync.
 */
function prepare(): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-agrants-'));
  kv = new Map<string, unknown>();
}

function initCore(): IntelligenceCore {
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
}

function newCore(): IntelligenceCore {
  prepare();
  return initCore();
}

const storage = () => ({ get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) });
const sync = (extra: Record<string, unknown> = {}) =>
  syncCapabilityGrants({ core, storage: storage(), logger: silent, ...extra } as never);
const events = (topic: string): EventEnvelope[] => core.ledger.query({ topicPrefix: topic, limit: 200 });

afterEach(() => core?.close());

describe('fresh install — materialization is per grantee', () => {
  it('the anchor capability is granted to the builtin surfaces, each with its own act', () => {
    core = newCore();
    sync();
    const anchor = getCapabilityGrants().filter((g) => g.capability === ANCHOR);
    expect(anchor.map((g) => g.grantee).sort()).toEqual([...BUILTINS].sort());
    const issued = events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === ANCHOR);
    expect(issued.map((e) => e.payload.grantee).sort()).toEqual([...BUILTINS].sort());
  });

  it('NO agent is ever materialized — an agent holds only what a human granted it', () => {
    core = newCore();
    sync();
    expect(getCapabilityGrants().every((g) => (BUILTINS as string[]).includes(g.grantee))).toBe(true);
  });

  it('mandated-explicit capabilities are granted to NO grantee', () => {
    core = newCore();
    sync();
    for (const cap of MANDATED_EXPLICIT_CAPABILITIES) {
      expect(getCapabilityGrants().some((g) => g.capability === cap)).toBe(false);
    }
  });

  it('the marker is v2 and every entry names its grantee', () => {
    core = newCore();
    sync();
    const marker = kv.get(GRANTS_STORAGE_KEY) as { version: number; grants: Array<{ grantee?: string }> };
    expect(marker.version).toBe(2);
    expect(marker.grants.length).toBeGreaterThan(0);
    expect(marker.grants.every((g) => typeof g.grantee === 'string' && g.grantee.length > 0)).toBe(true);
  });
});

describe('the fail-closed flip', () => {
  function seedV1World(): void {
    prepare();
    // A v1 machine: platform-wide issuance marker + v1 materialized record —
    // ON DISK BEFORE THE CORE BOOTS, as on a real upgrading machine.
    kv.set(GRANTS_STORAGE_KEY, {
      version: 1,
      grants: [{
        capability: ANCHOR,
        runbookId: 'rb.bulk-plugin-update',
        runbookHash: 'sha256:oldhash',
        eventId: 'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        issuedAt: '2026-08-01T00:00:00.000Z',
      }],
    });
    kv.set(MATERIALIZED_STORAGE_KEY, {
      version: 1,
      migratedAt: '2026-08-01T00:00:00.000Z',
      capabilities: [ANCHOR],
    });
    core = initCore();
  }

  it('every v1 grant is revoked with the flip reason, chained to the act it ends', () => {
    seedV1World();
    sync();
    const revoked = events(GRANT_REVOKED_TOPIC).filter((e) => e.payload.capability === ANCHOR);
    expect(revoked).toHaveLength(1);
    expect(revoked[0].payload.reason).toBe('requires-agent-grant');
    expect(revoked[0].causation).toBe('evt_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('after the flip NOTHING is granted — no re-grant sneaks in from the old materialized record', () => {
    seedV1World();
    sync();
    expect(getCapabilityGrants()).toEqual([]);
    expect(events(GRANT_ISSUED_TOPIC)).toEqual([]);
  });

  it('the disarmed set names the flip so every surface can say why and where to re-grant', () => {
    seedV1World();
    sync();
    const row = getDisarmedCapabilityGrants().find((d) => d.capability === ANCHOR);
    expect(row?.reason).toBe('requires-agent-grant');
  });

  it('both markers land on v2 — the trap this suite exists for', () => {
    seedV1World();
    sync();
    expect((kv.get(GRANTS_STORAGE_KEY) as { version: number }).version).toBe(2);
    expect((kv.get(MATERIALIZED_STORAGE_KEY) as { version: number }).version).toBe(2);
  });

  it('the flip happens once: a second sync emits nothing new', () => {
    seedV1World();
    sync();
    const after = { issued: events(GRANT_ISSUED_TOPIC).length, revoked: events(GRANT_REVOKED_TOPIC).length };
    sync();
    expect(events(GRANT_ISSUED_TOPIC)).toHaveLength(after.issued);
    expect(events(GRANT_REVOKED_TOPIC)).toHaveLength(after.revoked);
  });
});

describe('re-granting in the v2 world', () => {
  it('a settings grant names its grantee and grants that grantee alone', () => {
    prepare();
    seedFlippedEmpty();
    kv.set(STORAGE_KEYS.SETTINGS, {
      capabilityGrants: [{ capability: ANCHOR, grantee: AGENT, enabled: true }],
    });
    core = initCore();
    sync();
    const anchor = getCapabilityGrants().filter((g) => g.capability === ANCHOR);
    expect(anchor.map((g) => g.grantee)).toEqual([AGENT]);
    const issued = events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === ANCHOR);
    expect(issued).toHaveLength(1);
    expect(issued[0].payload.grantee).toBe(AGENT);
  });

  it('a legacy settings entry with NO grantee grants nobody, disclosed with the flip reason', () => {
    prepare();
    seedFlippedEmpty();
    kv.set(STORAGE_KEYS.SETTINGS, {
      capabilityGrants: [{ capability: ANCHOR, enabled: true }],
    });
    core = initCore();
    sync();
    expect(getCapabilityGrants().some((g) => g.capability === ANCHOR)).toBe(false);
    const row = getDisarmedCapabilityGrants().find((d) => d.capability === ANCHOR);
    expect(row?.reason).toBe('requires-agent-grant');
  });

  function seedFlippedEmpty(): void {
    kv.set(GRANTS_STORAGE_KEY, { version: 2, grants: [] });
    kv.set(MATERIALIZED_STORAGE_KEY, { version: 2, migratedAt: '2026-08-26T00:00:00.000Z', grants: [] });
  }
});
