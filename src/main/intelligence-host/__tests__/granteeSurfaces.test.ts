/**
 * fixes-082526 · agent-addressed grants, phase 3 — the granting surfaces'
 * seam.
 *
 * Three widenings, each the fuel for one surface:
 *  - `setCapabilityGrant` takes a grantee: a NAMED one writes that grantee's
 *    entry alone (the AgentWorkspace control); absent keeps the
 *    interactive-surfaces pair (Govern's switch — chat + mcp-client, no
 *    longer "interim": that IS what the capability-wide switch means now).
 *  - `GovernRow.holders`: who holds the capability live — the set the pane's
 *    ruling renders ("granted to 2 of 3"), derived, never authored.
 *  - `readGrantIssuanceByPair`: the act per (grantee, capability), so a
 *    per-grantee row can cite ITS OWN act rather than the first holder's.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  CHAT_GRANTEE,
  MCP_CLIENT_GRANTEE,
  readGrantIssuanceByPair,
  syncCapabilityGrants,
} from '../capabilityGrants';
import { readGovernMatrix, setCapabilityGrant } from '../governMatrix';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, error: () => {} };
const AGENT = 'security-sentinel';
const ANCHOR = 'cap.bulk_plugin_update';
const PROMOTE = 'cap.promote_environment';

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-gsurf-'));
  kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});
afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const storage = () => ({ get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) });

describe('setCapabilityGrant × grantee', () => {
  it('a NAMED grantee grants that grantee alone — the AgentWorkspace control', () => {
    const r = setCapabilityGrant({
      core, storage: storage(), logger: silent,
      capability: PROMOTE, grant: true, grantee: AGENT,
    });
    expect(r.ok).toBe(true);
    const row = r.matrix!.rows.find((x) => x.capability === PROMOTE)!;
    expect(row.holders).toEqual([AGENT]);
  });

  it('absent stays the interactive-surfaces pair — the Govern switch', () => {
    const r = setCapabilityGrant({
      core, storage: storage(), logger: silent,
      capability: PROMOTE, grant: true,
    });
    const row = r.matrix!.rows.find((x) => x.capability === PROMOTE)!;
    expect([...row.holders].sort()).toEqual([CHAT_GRANTEE, MCP_CLIENT_GRANTEE].sort());
  });

  it("a named revoke removes ONE grantee's grant and leaves the others standing", () => {
    setCapabilityGrant({ core, storage: storage(), logger: silent, capability: PROMOTE, grant: true, grantee: AGENT });
    setCapabilityGrant({ core, storage: storage(), logger: silent, capability: PROMOTE, grant: true });
    const r = setCapabilityGrant({
      core, storage: storage(), logger: silent,
      capability: PROMOTE, grant: false, grantee: AGENT,
    });
    const row = r.matrix!.rows.find((x) => x.capability === PROMOTE)!;
    expect(row.holders).not.toContain(AGENT);
    expect([...row.holders].sort()).toEqual([CHAT_GRANTEE, MCP_CLIENT_GRANTEE].sort());
  });
});

describe('GovernRow.holders — derived, never authored', () => {
  it('a materialized capability is held by the builtin surfaces on a fresh machine', () => {
    syncCapabilityGrants({ core, storage: storage(), logger: silent });
    const row = readGovernMatrix({ core, storage: storage() })!.rows.find((x) => x.capability === ANCHOR)!;
    expect([...row.holders].sort()).toEqual([CHAT_GRANTEE, MCP_CLIENT_GRANTEE].sort());
  });

  it('an ungranted capability has an EMPTY holder set — never a fabricated one', () => {
    syncCapabilityGrants({ core, storage: storage(), logger: silent });
    const row = readGovernMatrix({ core, storage: storage() })!.rows.find((x) => x.capability === PROMOTE)!;
    expect(row.holders).toEqual([]);
  });
});

describe('readGrantIssuanceByPair — each grant cites ITS OWN act', () => {
  it('two holders, two distinct acts', () => {
    syncCapabilityGrants({ core, storage: storage(), logger: silent });
    const byPair = readGrantIssuanceByPair(storage());
    const chatAct = byPair.get(`${CHAT_GRANTEE}|${ANCHOR}`);
    const mcpAct = byPair.get(`${MCP_CLIENT_GRANTEE}|${ANCHOR}`);
    expect(chatAct?.eventId).toMatch(/^evt_/);
    expect(mcpAct?.eventId).toMatch(/^evt_/);
    expect(chatAct!.eventId).not.toBe(mcpAct!.eventId);
  });
});
