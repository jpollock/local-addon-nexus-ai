/**
 * WP-20c · procedure delivery — the turn carrier, its cadence, and the four
 * honest outcomes.
 *
 * The fixtures are REAL documents run through the real loader and the real
 * registry, so the hash a grant pins, the ceiling the registry enforces and the
 * text the turn carries are the same canonical string in the test that they are
 * in production. A hand-built `Runbook` literal would let the pin and the
 * payload drift apart, which is the one thing §6(b) exists to catch.
 */
import { parseLawDocument } from '../../law/loader';
import { RunbookRegistry } from '../../law/runbookRegistry';
import { documentHash } from '../../law/hash';
import { LawDocument } from '../../law/types';
import {
  assemble,
  estimateTokens,
  PROCEDURE_TOKEN_CEILING,
  renderProcedureBlock,
} from '../assembler';
import { AssembleDeps, AssembleRequest, ProcedureDelivery, ProcedureRefusal } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STRICT_RUNBOOK = `---
id: rb.fixture-update
kind: runbook
version: 2.1.0
strictness: strict
capability: cap.fixture_update
owner: ops
scope:
  environments: [local, wpe_staging]
checkpoints:
  - id: cp.consult-history
  - id: cp.dry-run
  - id: cp.approval
aborts:
  - id: ab.backup-failed
    on: cp.backup failure
    do: full stop
communication:
  - the dry-run diff, before any write
---

# Fixture update

Update the fixture fleet, carefully.

## cp.consult-history

Ask the ledger first.
`;

const GUIDED_RUNBOOK = `---
id: rb.fixture-guided
kind: runbook
version: 1.0.0
strictness: guided
capability: cap.fixture_guided
owner: ops
steps:
  - id: st.look
  - id: st.decide
---

# Fixture guided

Adapt as needed.
`;

/** A strict runbook whose canonical text is over the delivery ceiling. */
const OVERSIZE_RUNBOOK = `---
id: rb.fixture-oversize
kind: runbook
version: 1.0.0
strictness: strict
capability: cap.fixture_oversize
owner: ops
checkpoints:
  - id: cp.only
---

# Fixture oversize

${'padding padding padding padding padding padding padding padding\n'.repeat(200)}
`;

function docOf(text: string, path: string): LawDocument {
  const parsed = parseLawDocument(path, text);
  if (!('kind' in parsed)) throw new Error(`fixture failed to parse: ${parsed.reason}`);
  return parsed;
}

function registryOf(...texts: Array<[string, string]>): RunbookRegistry {
  return RunbookRegistry.build({ documents: texts.map(([p, t]) => docOf(t, p)) });
}

const STRICT_HASH = documentHash(STRICT_RUNBOOK);

function baseRequest(over: Partial<AssembleRequest> = {}): AssembleRequest {
  return {
    actor: { id: 'act_test', kind: 'system', autonomy: 'interactive' },
    task: { id: 'task_1', intent: 'update the plugins everywhere' },
    targets: [],
    surface: 'chat.docked-panel',
    ...over,
  };
}

const GRANT = {
  capability: 'cap.fixture_update',
  runbookId: 'rb.fixture-update',
  runbookHash: STRICT_HASH,
};

function depsWith(reg: RunbookRegistry, over: AssembleDeps = {}): AssembleDeps {
  return { runbooks: reg, ...over };
}

const strictReg = () => registryOf(['runbooks/fixture-update.md', STRICT_RUNBOOK]);

// ---------------------------------------------------------------------------

describe('parity — the packet is additive or it is a defect', () => {
  test('a request with no procedure input assembles byte-identically, procedure null', async () => {
    const withoutDep = await assemble(baseRequest(), {});
    const withDep = await assemble(baseRequest(), depsWith(strictReg()));

    expect(withoutDep.blocks.turn).toBe(withDep.blocks.turn);
    expect(withDep.procedure).toBeNull();
    expect(withDep.manifest.procedure).toBeNull();
  });

  test('an EMPTY grant list is the same as no grants at all — no index, no header', async () => {
    // An actor may legitimately hold zero grants once 20b exists. The index
    // header must not appear over an empty list: "Procedures granted to this
    // actor:" followed by nothing reads as a platform that lost them.
    const empty = await assemble(baseRequest({ procedure: { grants: [] } }), depsWith(strictReg()));
    const none = await assemble(baseRequest(), depsWith(strictReg()));

    expect(empty.blocks.turn).toBe(none.blocks.turn);
    expect(empty.procedureIndex).toEqual([]);
  });

  test('holding grants but arming nothing costs the index and nothing else', async () => {
    const unarmed = await assemble(
      baseRequest({ procedure: { grants: [GRANT] } }),
      depsWith(strictReg())
    );
    const none = await assemble(baseRequest(), depsWith(strictReg()));

    // The index rides every turn once a grant exists — deliberate, and pinned
    // separately from parity because it BREAKS byte-identity (design note §3).
    expect(unarmed.blocks.turn).not.toBe(none.blocks.turn);
    expect(unarmed.blocks.turn).toContain('cap.fixture_update');
    expect(unarmed.blocks.turn).toContain('rb.fixture-update');
    // …but an unarmed turn still delivers no procedure and claims none.
    expect(unarmed.procedure).toBeNull();
    expect(unarmed.manifest.procedure).toBeNull();
    expect(unarmed.blocks.turn).not.toContain('Fixture update');
  });
});

describe('delivery — the full document, once', () => {
  const armedRequest = (over: Partial<AssembleRequest> = {}) =>
    baseRequest({
      procedure: { grants: [GRANT], armed: { capability: GRANT.capability, armedBy: 'predicate' } },
      ...over,
    });

  test('the arming turn carries the whole canonical document, frontmatter included', async () => {
    const bundle = await assemble(armedRequest(), depsWith(strictReg()));
    const delivered = bundle.procedure as ProcedureDelivery;

    expect(delivered.status).toBe('delivered');
    expect(delivered.assertFull).toBe(true);
    expect(delivered.runbookId).toBe('rb.fixture-update');
    expect(delivered.version).toBe('2.1.0');
    expect(delivered.hash).toBe(STRICT_HASH);
    expect(delivered.armedBy).toBe('predicate');

    // The obligations live in the FRONTMATTER for these runbooks, so a
    // body-only delivery would ship the prose and drop the contract — the same
    // reasoning that made the hash and the ceiling whole-document (WP-20a).
    expect(bundle.blocks.turn).toContain('capability: cap.fixture_update');
    expect(bundle.blocks.turn).toContain('- id: cp.approval');
    expect(bundle.blocks.turn).toContain('the dry-run diff, before any write');
    expect(bundle.blocks.turn).toContain('Update the fixture fleet, carefully.');
  });

  test('the procedure follows the POLICY re-assert and precedes everything else', async () => {
    // ADR-20's amendment (WP-20c gate): law outranks procedure, so the standing
    // policy is read first and the procedure is read in its light. Everything
    // below the procedure — routing, freshness, retrieval — is evidence FOR it,
    // which is §3's original argument and is unchanged.
    const constraints = [
      { id: 'c.one', rule: 'no production writes', enforcement: 'gateway' as const, origin: 'expertise' as const, docId: 'pol.x', docVersion: '1', scope: 'tenant' },
    ];
    const bundle = await assemble(
      armedRequest({
        targets: [{ role: 'environment', id: 'ent_env_1', label: 'acme' }],
      }),
      depsWith(strictReg(), {
        law: { constraints: () => constraints, documents: () => [{ id: 'pol.x', version: '1' }] },
        twins: {
          forEntity: () => [{ entityId: 'ent_env_1', fact: 'plugin:acf', observedAt: new Date(0).toISOString() } as never],
          freshness: () => ({ ageSeconds: 100, sloSeconds: 50, fresh: false }) as never,
        },
      })
    );

    const turn = bundle.blocks.turn!;
    expect(turn).toContain('Operating policy');
    expect(turn).toContain('Cached-data freshness');
    expect(turn.indexOf('Operating policy')).toBeLessThan(turn.indexOf('rb.fixture-update'));
    expect(turn.indexOf('rb.fixture-update')).toBeLessThan(turn.indexOf('Cached-data freshness'));
  });

  test('a second turn re-asserts by hash and cursor, not by body (ADR-20 extended)', async () => {
    const bundle = await assemble(
      armedRequest({
        context: { procedureHash: STRICT_HASH },
        procedure: {
          grants: [GRANT],
          armed: { capability: GRANT.capability, armedBy: 'predicate' },
          cursor: { attested: ['cp.consult-history', 'cp.dry-run'] },
        },
      }),
      depsWith(strictReg())
    );
    const delivered = bundle.procedure as ProcedureDelivery;
    const turn = bundle.blocks.turn!;

    expect(delivered.assertFull).toBe(false);
    expect(delivered.bodyDelivered).toBe(false);
    expect(turn).not.toContain('Update the fixture fleet, carefully.');
    expect(turn).toContain('remains in effect');
    expect(turn).toContain('cp.consult-history');
    expect(turn).toContain('cp.approval'); // the NEXT unattested checkpoint, named

    // The cadence is the whole point of ADR-20, so it is pinned as a RATIO of
    // two measured numbers rather than against a remembered token count: a
    // re-assert that costs a meaningful fraction of the body has stopped being
    // one. (This fixture is deliberately small; the anchor runbook's ride is
    // ~1,215 tokens against the same ~45, so the real gap is far wider.)
    const full = await assemble(
      armedRequest(),
      depsWith(strictReg())
    );
    expect(delivered.tokens).toBeLessThan((full.procedure as ProcedureDelivery).tokens / 3);
  });

  test('a changed document re-delivers in full — the hash the actor carries is the key', async () => {
    const bundle = await assemble(
      armedRequest({ context: { procedureHash: 'sha256:something-else' } }),
      depsWith(strictReg())
    );

    expect((bundle.procedure as ProcedureDelivery).assertFull).toBe(true);
    expect(bundle.blocks.turn).toContain('Update the fixture fleet, carefully.');
  });

  test('with no cursor the platform says it is not attesting, and ticks nothing', async () => {
    const bundle = await assemble(armedRequest(), depsWith(strictReg()));
    const delivered = bundle.procedure as ProcedureDelivery;

    expect(delivered.checkpoints.map((c) => c.attest)).toEqual(['narrative', 'narrative', 'narrative']);
    expect(delivered.checkpoints.every((c) => c.attested === false)).toBe(true);
    // The honest sentence, and NOT the cursor's "Attested: …/Next: …" shape,
    // which would claim a progress record the platform does not have.
    expect(bundle.blocks.turn).toMatch(/not attesting checkpoints/i);
    expect(bundle.blocks.turn).toMatch(/nothing below is verified by the gateway/i);
    expect(bundle.blocks.turn).not.toContain('Attested:');
  });

  test('the manifest records what rode, its cost, and the checkpoint basis', async () => {
    const bundle = await assemble(armedRequest(), depsWith(strictReg()));
    const m = bundle.manifest.procedure!;

    expect(m.status).toBe('delivered');
    expect(m.capability).toBe('cap.fixture_update');
    expect(m.runbook).toBe('rb.fixture-update');
    expect(m.version).toBe('2.1.0');
    expect(m.hash).toBe(STRICT_HASH);
    expect(m.asserted).toBe('full');
    expect(m.armed_by).toBe('predicate');
    expect(m.checkpoints).toBe(3);
    expect(m.attested).toBe(0);
    // The delivered cost is measured, and it is INSIDE the turn's total.
    expect(m.tokens).toBeGreaterThanOrEqual(estimateTokens(STRICT_RUNBOOK));
    expect(bundle.manifest.budget.tokens_used).toBeGreaterThanOrEqual(m.tokens);
  });

  test('a delivered procedure is inside the token ceiling the registry enforces', async () => {
    const bundle = await assemble(armedRequest(), depsWith(strictReg()));

    expect(PROCEDURE_TOKEN_CEILING).toBe(2560);
    expect(bundle.manifest.procedure!.tokens).toBeLessThanOrEqual(PROCEDURE_TOKEN_CEILING);
  });
});

describe('the four outcomes are four DIFFERENT things', () => {
  const armedFor = (capability: string, grants = [GRANT]) =>
    baseRequest({ procedure: { grants, armed: { capability, armedBy: 'predicate' } } });

  test('not armed — no section, no manifest record, nothing claimed', async () => {
    const bundle = await assemble(baseRequest({ procedure: { grants: [GRANT] } }), depsWith(strictReg()));

    expect(bundle.procedure).toBeNull();
    expect(bundle.manifest.procedure).toBeNull();
  });

  test('cannot load — disarmed, disclosed, and the model is told not to improvise', async () => {
    const empty = RunbookRegistry.build({ documents: [] });
    const bundle = await assemble(armedFor('cap.fixture_update'), depsWith(empty));
    const refusal = bundle.procedure as ProcedureRefusal;

    expect(refusal.status).toBe('refused');
    expect(refusal.code).toBe('not-loaded');
    expect(bundle.manifest.procedure!.status).toBe('refused');
    expect(bundle.manifest.procedure!.refusal!.code).toBe('not-loaded');
    expect(bundle.blocks.turn).toContain('could not be loaded');
    expect(bundle.blocks.turn).toMatch(/do not improvise/i);
    // Not the integrity vocabulary, and not the ceiling's.
    expect(bundle.blocks.turn).not.toMatch(/integrity/i);
    expect(bundle.blocks.turn).not.toMatch(/ceiling/i);
  });

  test('over ceiling — a distinct code and a distinct disclosure, never a trim', async () => {
    const reg = registryOf(['runbooks/fixture-oversize.md', OVERSIZE_RUNBOOK]);
    const grant = {
      capability: 'cap.fixture_oversize',
      runbookId: 'rb.fixture-oversize',
      runbookHash: documentHash(OVERSIZE_RUNBOOK),
    };
    const bundle = await assemble(armedFor('cap.fixture_oversize', [grant]), depsWith(reg));
    const refusal = bundle.procedure as ProcedureRefusal;

    expect(refusal.code).toBe('over-ceiling');
    expect(refusal.reason).toMatch(/ceiling/i);
    expect(bundle.blocks.turn).toMatch(/ceiling/i);
    expect(bundle.blocks.turn).toMatch(/never delivered in part/i);
    // The body did NOT ride, in any quantity.
    expect(bundle.blocks.turn).not.toContain('padding padding');
  });

  test('the delivery ceiling refuses an oversize runbook a registry admitted', async () => {
    // Defence in depth, and the only way to reach it: a registry built with a
    // different bound than this assembler's. The refusal has to be the delivery
    // layer's own, because by the time a document is here, refusing is the only
    // honest answer left — §6.2 forbids trimming it.
    const admitted = docOf(OVERSIZE_RUNBOOK, 'runbooks/fixture-oversize.md');
    const lenientRegistry = {
      byCapability: () => ({
        id: 'rb.fixture-oversize',
        version: '1.0.0',
        capability: 'cap.fixture_oversize',
        strictness: 'strict' as const,
        path: 'runbooks/fixture-oversize.md',
        hash: admitted.hash,
        canonicalBytes: admitted.canonicalBytes,
        checkpoints: [{ id: 'cp.only', attest: 'narrative' as const, tools: [] }],
        steps: [],
        tools: [],
        toolScope: 'advisory' as const,
        body: admitted.body,
        canonicalText: admitted.canonicalText,
        frontmatter: admitted.frontmatter,
      }),
      errors: () => [],
    };
    const grant = {
      capability: 'cap.fixture_oversize',
      runbookId: 'rb.fixture-oversize',
      runbookHash: admitted.hash,
    };
    const bundle = await assemble(armedFor('cap.fixture_oversize', [grant]), {
      runbooks: lenientRegistry,
    });
    const refusal = bundle.procedure as ProcedureRefusal;

    expect(refusal.code).toBe('over-ceiling');
    expect(refusal.reason).toContain(String(PROCEDURE_TOKEN_CEILING));
    expect(bundle.blocks.turn).not.toContain('padding padding');
  });

  test('hash mismatch — integrity, not staleness: both hashes, the remedy, no proceed', async () => {
    const stale = { ...GRANT, runbookHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };
    const bundle = await assemble(armedFor('cap.fixture_update', [stale]), depsWith(strictReg()));
    const refusal = bundle.procedure as ProcedureRefusal;

    expect(refusal.code).toBe('hash-mismatch');
    expect(refusal.expectedHash).toBe(stale.runbookHash);
    expect(refusal.actualHash).toBe(STRICT_HASH);
    const turn = bundle.blocks.turn!;
    // Both hashes IN FULL: a truncated hash cannot be checked against anything.
    expect(turn).toContain(stale.runbookHash);
    expect(turn).toContain(STRICT_HASH);
    expect(turn).toMatch(/integrity/i);
    expect(turn).toMatch(/re-grant/i);
    // ADR-7's warn-and-proceed does NOT apply here (P6's ratified refinement).
    expect(turn).not.toMatch(/proceed without it/i);
    expect(bundle.blocks.turn).not.toContain('Update the fixture fleet, carefully.');
  });

  test('a grant naming a different runbook than the registry serves is an integrity failure', async () => {
    const wrong = { ...GRANT, runbookId: 'rb.something-else' };
    const bundle = await assemble(armedFor('cap.fixture_update', [wrong]), depsWith(strictReg()));

    expect((bundle.procedure as ProcedureRefusal).code).toBe('hash-mismatch');
    expect(bundle.blocks.turn).toContain('rb.something-else');
  });

  test('armed for a capability no grant covers refuses rather than serving it', async () => {
    const bundle = await assemble(armedFor('cap.fixture_update', []), depsWith(strictReg()));

    expect((bundle.procedure as ProcedureRefusal).code).toBe('not-loaded');
    expect(bundle.blocks.turn).not.toContain('Update the fixture fleet, carefully.');
  });
});

describe('autonomy — ADR-7 for load failure, integrity for hash', () => {
  const autonomous = (over: Partial<AssembleRequest>) =>
    baseRequest({
      actor: { id: 'act_agent', kind: 'agent', autonomy: 'autonomous' },
      ...over,
    });
  const policyDeps = (reg: RunbookRegistry): AssembleDeps => ({
    runbooks: reg,
    law: {
      constraints: () => [
        { id: 'c.one', rule: 'no production writes', enforcement: 'gateway', origin: 'expertise', docId: 'pol.x', docVersion: '1', scope: 'tenant' },
      ],
      documents: () => [{ id: 'pol.x', version: '1' }],
    },
  });

  test('an autonomous actor whose procedure will not load gets the refusal bundle', async () => {
    const empty = RunbookRegistry.build({ documents: [] });
    const bundle = await assemble(
      autonomous({ procedure: { grants: [GRANT], armed: { capability: GRANT.capability, armedBy: 'late-gate' } } }),
      policyDeps(empty)
    );

    expect(bundle.failClosed).toBe(true);
    expect(bundle.manifest.fail_closed).toBe(true);
    expect(bundle.blocks.turn).toMatch(/REFUSAL/);
    expect(bundle.blocks.turn).toContain('cap.fixture_update');
    expect(bundle.tools).toEqual([]);
    expect(bundle.retrieved).toEqual([]);
  });

  test('an interactive actor with the same failure keeps its turn and is told', async () => {
    const empty = RunbookRegistry.build({ documents: [] });
    const bundle = await assemble(
      baseRequest({ procedure: { grants: [GRANT], armed: { capability: GRANT.capability, armedBy: 'late-gate' } } }),
      policyDeps(empty)
    );

    expect(bundle.failClosed).toBe(false);
    expect(bundle.blocks.turn).toContain('Operating policy'); // the rest of the turn survives
    expect(bundle.blocks.turn).toContain('could not be loaded');
  });

  test('the pre-WP-20 fail-closed refusal is unchanged when no procedure is involved', async () => {
    const bundle = await assemble(autonomous({}), {});

    expect(bundle.failClosed).toBe(true);
    expect(bundle.blocks.turn).toContain('no policy set is available and this actor is autonomous');
    expect(bundle.manifest.procedure).toBeNull();
  });

  test('a hash mismatch fails closed for an autonomous actor too', async () => {
    const stale = { ...GRANT, runbookHash: 'sha256:dead' };
    const bundle = await assemble(
      autonomous({ procedure: { grants: [stale], armed: { capability: GRANT.capability, armedBy: 'predicate' } } }),
      policyDeps(strictReg())
    );

    expect(bundle.failClosed).toBe(true);
    expect(bundle.blocks.turn).toMatch(/integrity/i);
  });
});

describe('guided runbooks keep the ruling-2 exemption alive', () => {
  test('a guided procedure is named and summarised, and its body never rides', async () => {
    const reg = registryOf(['runbooks/fixture-guided.md', GUIDED_RUNBOOK]);
    const grant = {
      capability: 'cap.fixture_guided',
      runbookId: 'rb.fixture-guided',
      runbookHash: documentHash(GUIDED_RUNBOOK),
    };
    const bundle = await assemble(
      baseRequest({ procedure: { grants: [grant], armed: { capability: grant.capability, armedBy: 'predicate' } } }),
      depsWith(reg)
    );
    const delivered = bundle.procedure as ProcedureDelivery;

    expect(delivered.status).toBe('delivered');
    expect(delivered.strictness).toBe('guided');
    // The ceiling exempts guided runbooks because nothing delivers them whole.
    // The day that changes, both shipped guided documents are over ceiling —
    // so this pin IS the exemption (WP-20a adjudication, ruling 2).
    expect(delivered.bodyDelivered).toBe(false);
    expect(bundle.blocks.turn).not.toContain('Adapt as needed.');
    expect(bundle.blocks.turn).toContain('st.look');
    expect(bundle.blocks.turn).toMatch(/guided/i);
  });
});

describe('non-fatal by construction', () => {
  test('a registry that throws degrades to a disclosed refusal, never an exception', async () => {
    const exploding = {
      byCapability: () => {
        throw new Error('registry is on fire');
      },
      errors: () => {
        throw new Error('still on fire');
      },
    };
    const bundle = await assemble(
      baseRequest({ procedure: { grants: [GRANT], armed: { capability: GRANT.capability, armedBy: 'predicate' } } }),
      { runbooks: exploding }
    );

    expect((bundle.procedure as ProcedureRefusal).code).toBe('not-loaded');
    expect(bundle.blocks.turn).toContain('could not be loaded');
  });

  test('renderProcedureBlock returns null for nothing to say', () => {
    expect(renderProcedureBlock(null, [])).toBeNull();
  });
});
