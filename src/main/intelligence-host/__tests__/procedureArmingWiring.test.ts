/**
 * WP-20b × WP-20c · the seam where a grant becomes a delivered procedure.
 *
 * 20c built the carrier and said, in `ChatAssemblyRequest.procedure`'s own
 * comment, that **WP-20b owns everything that decides what rides it**. This
 * suite is that decision, and the failure it exists to catch is the WP-17
 * lesson in its purest form: a grant set materialized at boot, an arming
 * function with tests, a delivery path with tests — and nothing calling from
 * one to the other, which reads exactly like "no procedure applies".
 *
 * Two properties, in tension, and both pinned:
 *
 *  1. **With grants, the turn carries the procedure index** — that is §3's ruled
 *     always-on line, the thing that tells a model the procedures exist.
 *  2. **With no grants, the turn is what it was before WP-20 existed.** Not
 *     "nearly", not "plus an empty section": the parity floor P2's additive-only
 *     ruling rests on.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { assembleForChatTurn } from '../chatAssembly';
import {
  getCapabilityGrants,
  resolveCapabilityGrants,
  syncCapabilityGrants,
} from '../capabilityGrants';
import {
  clearArmingRequests,
  procedureRequestForTurn,
  recordArmingRequest,
  takeArmingRequests,
} from '../procedureArming';
import { RunbookRegistry, loadLawDirectory } from '../../../intelligence';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, error: () => {} };
const ANCHOR = 'cap.bulk_plugin_update';

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

function storage() {
  return { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) };
}

function services() {
  return { siteData: { getSite: () => undefined, getSites: () => ({}) } } as never;
}

beforeEach(() => {
  clearArmingRequests();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-armwire-'));
  kv = new Map<string, unknown>();
  core = initIntelligenceCore({ storage: storage(), logger: silent, dataDir: dir })!;
  setIntelligenceCore(core);
});
afterEach(() => {
  core.close();
  setIntelligenceCore(undefined as never);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────
// The decision
// ───────────────────────────────────────────────────────────────────────────

describe('procedureRequestForTurn', () => {
  test('carries every live grant, so the always-on index has something to list', () => {
    const req = procedureRequestForTurn({ runbooks: core.law!.runbooks, userMessage: 'hello' })!.request;
    expect(req.grants.map((g) => g.capability)).toEqual(getCapabilityGrants().map((g) => g.capability));
    expect(req.grants.find((g) => g.capability === ANCHOR)!.runbookHash).toMatch(/^sha256:/);
  });

  test('arms nothing on an ordinary turn — the index is not a procedure', () => {
    const req = procedureRequestForTurn({ runbooks: core.law!.runbooks, userMessage: 'how is my fleet?' })!.request;
    expect(req.armed).toBeUndefined();
  });

  test('with no grants it returns nothing at all — the parity floor', () => {
    kv.set(
      STORAGE_KEYS.SETTINGS,
      {
        capabilityGrants: core
          .law!.runbooks.runbooks({ strictness: 'strict' })
          .map((rb) => ({ capability: rb.capability, enabled: false })),
      }
    );
    syncCapabilityGrants({ core, storage: storage(), logger: silent });

    expect(procedureRequestForTurn({ runbooks: core.law!.runbooks, userMessage: 'update the plugins' }))
      .toBeUndefined();
  });

  test("a model's request arms the capability it asked for, and is consumed", () => {
    recordArmingRequest(ANCHOR);

    const req = procedureRequestForTurn({ runbooks: core.law!.runbooks, userMessage: 'go on then' })!.request;
    expect(req.armed).toEqual({ capability: ANCHOR, armedBy: 'model-request' });
    // Consumed: the next turn must not re-arm from a request already honoured.
    expect(takeArmingRequests()).toEqual([]);
    expect(
      procedureRequestForTurn({ runbooks: core.law!.runbooks, userMessage: 'and now?' })!.request.armed
    ).toBeUndefined();
  });

  test('a request for something not granted arms nothing — a queue is not an authority', () => {
    recordArmingRequest('cap.never-granted');
    const req = procedureRequestForTurn({ runbooks: core.law!.runbooks, userMessage: 'go' })!.request;
    expect(req.armed).toBeUndefined();
  });

  test("an authored predicate arms from the turn's own words", () => {
    // No shipped runbook authors `arms_on:` yet, so the predicate path is
    // exercised against a registry built here — the same code path, a document
    // that declares the field.
    const { registry, capability, grants } = withArmsOn(['update'], ['plugins']);

    const req = procedureRequestForTurn({
      runbooks: registry,
      grants,
      userMessage: 'please update the plugins',
    })!.request;
    expect(req.armed).toEqual({ capability, armedBy: 'predicate' });
  });

  test('two predicates matching one turn arm NEITHER — a coin toss is worse than none', () => {
    const { registry, capability, second, grants } = withArmsOn(['update'], ['plugins'], true);

    const req = procedureRequestForTurn({
      runbooks: registry,
      grants,
      userMessage: 'update the plugins',
    })!.request;
    expect(req.armed).toBeUndefined();
    // Both are still LISTED: the index names them, which is how "say so" is met
    // until a surface renders the ambiguity itself.
    expect(req.grants.map((g) => g.capability).sort()).toEqual([capability, second].sort());
  });

  test("a model's request outranks the predicate — it asked by name", () => {
    const { registry, capability, grants } = withArmsOn(['update'], ['plugins']);
    recordArmingRequest(capability);

    const req = procedureRequestForTurn({
      runbooks: registry,
      grants,
      userMessage: 'update the plugins',
    })!.request;
    expect(req.armed).toEqual({ capability, armedBy: 'model-request' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The wiring, through the real assembly
// ───────────────────────────────────────────────────────────────────────────

describe('assembleForChatTurn reaches the procedure plane', () => {
  test('the turn block carries the procedure index, because grants exist', async () => {
    const result = await assembleForChatTurn({
      services: services(),
      sessionId: 's1',
      userMessage: 'how is my fleet?',
      buildingSystemPrompt: true,
    });

    expect(result).not.toBeNull();
    expect(result!.turnBlock).toContain('Procedures granted to this actor:');
    expect(result!.turnBlock).toContain('rb.bulk-plugin-update');
  });

  test('with every grant off, the turn block mentions no procedure at all', async () => {
    kv.set(
      STORAGE_KEYS.SETTINGS,
      {
        capabilityGrants: core
          .law!.runbooks.runbooks({ strictness: 'strict' })
          .map((rb) => ({ capability: rb.capability, enabled: false })),
      }
    );
    syncCapabilityGrants({ core, storage: storage(), logger: silent });

    const result = await assembleForChatTurn({
      services: services(),
      sessionId: 's2',
      userMessage: 'how is my fleet?',
      buildingSystemPrompt: true,
    });

    // Asserted against the procedure surface, not against the string 'rb.': the
    // policy version line has named every law document id since WP-11, runbooks
    // included, and that is not a procedure section.
    expect(result!.turnBlock ?? '').not.toContain('Procedures granted to this actor:');
    expect(result!.turnBlock ?? '').not.toContain('## Procedure');
    expect(result!.procedure).toBeNull();
  });

  test('a caller that supplies its own procedure request is not overridden', async () => {
    // The field is 20c's contract and stays authoritative: this module only
    // supplies the default for callers that have no opinion.
    const result = await assembleForChatTurn({
      services: services(),
      sessionId: 's3',
      userMessage: 'update the plugins',
      buildingSystemPrompt: true,
      procedure: { grants: [] },
    });

    // Asserted on the INDEX, not on `procedure`: nothing arms on this turn
    // either way, so a null outcome would be true whether the caller was
    // honoured or silently replaced by the live grant set.
    expect(result!.turnBlock ?? '').not.toContain('Procedures granted to this actor:');
    expect(result!.procedure).toBeNull();
  });
});

/** A registry built from a temp law directory, so `arms_on` can be authored here. */
function withArmsOn(verbs: string[], subjects: string[], twice = false) {
  const lawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-arms-'));
  fs.mkdirSync(path.join(lawDir, 'runbooks'), { recursive: true });
  const doc = (id: string, capability: string) => `---
id: ${id}
kind: runbook
version: 1.0.0
capability: ${capability}
strictness: strict
arms_on:
  verbs: [${verbs.join(', ')}]
  subjects: [${subjects.join(', ')}]
checkpoints:
  - id: cp.first
---

# ${id}

Prose.
`;
  fs.writeFileSync(path.join(lawDir, 'runbooks', 'a.md'), doc('rb.a', 'cap.a'));
  if (twice) fs.writeFileSync(path.join(lawDir, 'runbooks', 'b.md'), doc('rb.b', 'cap.b'));
  const { documents } = loadLawDirectory(lawDir);
  fs.rmSync(lawDir, { recursive: true, force: true });
  const registry = RunbookRegistry.build({ documents });
  // Grants for these documents come from the SAME resolver the boot path uses,
  // pointed at this registry — never hand-built, so the shipped rule (strict
  // runbooks are granted) is the rule under test here too.
  const { grants } = resolveCapabilityGrants({ runbooks: registry, settings: null });
  return { registry, grants, capability: 'cap.a', second: 'cap.b' };
}
