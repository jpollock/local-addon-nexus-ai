/**
 * WP-13 · Probe failure directions.
 *
 * `runner.test.ts` only ever sees these probes succeed, and a check that has
 * never been observed to fail is indistinguishable from a check that cannot
 * fail. This file drives the ones whose negative direction the integration run
 * does not reach.
 *
 * (`probeEnvelopeSchema`'s negative direction is covered by
 * `jsonSchemaCheck.test.ts`'s six rejection cases, and was additionally
 * observed live during this packet: it reported FAIL on ten envelopes because
 * the validator was mishandling `undefined`-valued optional keys, which is how
 * that bug was found.)
 */
import * as fs from 'fs';
import * as path from 'path';
import { createEvalFixture, EvalFixture } from './fixture';
import {
  probeCitationContract,
  probeIncidentProducer,
  probeRefusalPayload,
  probeRendererSurfaces,
  probeTimestampDiscipline,
  probeTopicFamily,
} from './probes';
import {
  getCapabilityGrants,
  resolveCapabilityGrants,
  syncCapabilityGrants,
  DisarmedGrant,
  GrantResolution,
  ResolvedGrant,
} from '../../src/main/intelligence-host/capabilityGrants';
import type { RunbookRegistry } from '../../src/intelligence';
import type { NexusSettings } from '../../src/common/types';
import { STORAGE_KEYS } from '../../src/common/constants';
import { assemble, taskId as mintTaskId } from '../../src/intelligence';
import { supplyFromBundle } from '../../src/intelligence/citation/resolve';
import { setIntelligenceCore } from '../../src/main/intelligence-host/coreRegistry';
import { wrapUntrusted } from '../../src/main/mcp/pii';
import { citedEventIdsOf } from './sitting';

jest.setTimeout(60_000);

/** Storage the grant sync can read, seeded with whatever a case needs. */
function memoryStorageWith(seed: Record<string, unknown>): { get(k: string): unknown; set(k: string, v: unknown): void } {
  const map = new Map<string, unknown>(Object.entries(seed));
  return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

let fixture: EvalFixture;

beforeAll(async () => {
  fixture = await createEvalFixture();
});

afterAll(() => fixture?.reset());

describe('probeTimestampDiscipline', () => {
  it('passes on the seeded ledger', () => {
    expect(probeTimestampDiscipline(fixture).ok).toBe(true);
  });

  it('FAILS when a fact is recorded before it was true', () => {
    // The shape a laundered backfill takes. Emitted through the real Emitter —
    // the envelope validator checks ISO format, not ordering, so this is a
    // genuinely reachable state rather than a hand-built row.
    const site = fixture.fleet[0];
    fixture.core.emitter.emit({
      observed_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      topic: 'state.site.observed',
      schema: 'site.observed/1',
      entity: { environment: fixture.environmentIdOf(site.siteId) },
      actor: { id: 'act_eval_probe', kind: 'system' },
      source: { class: 'platform', system: 'test', trust: 'observed' },
      payload: { name: site.name, domain: '', wp_version: '' },
    });

    const probe = probeTimestampDiscipline(fixture);
    expect(probe.ok).toBe(false);
    expect(probe.evidence.join(' ')).toMatch(/is AFTER recorded_at/);
  });
});

describe('probeTopicFamily', () => {
  it('reports absence as absence, with the total for context', () => {
    // `procedure.` is the family with no producer anywhere (`procedure.runbook
    // .published` is declared in the taxonomy and nothing emits it). This case
    // used to use `control.`, which WP-20b filled: the shipped capability grant
    // is recorded as `control.grant.issued` at bootstrap, so that family is no
    // longer an example of absence — see the case below.
    const probe = probeTopicFamily(fixture, 'procedure.');
    expect(probe.ok).toBe(false);
    expect(probe.evidence[0]).toMatch(/returned 0 event\(s\) of \d+ total/);
  });

  it('reports presence for control.grant, which WP-20b gave its first producer', () => {
    const probe = probeTopicFamily(fixture, 'control.grant.');
    expect(probe.ok).toBe(true);
  });

  it('reports presence for a family the real producers do fill', () => {
    const probe = probeTopicFamily(fixture, 'state.plugin.');
    expect(probe.ok).toBe(true);
    expect(probe.evidence[0]).toContain('returned 7 event(s)');
  });
});

/**
 * WP-24 · The probes must not put electron on their own require chain.
 *
 * `probes.ts` is imported by `runner.ts`, which is imported by BOTH CLI entry
 * points (`run.ts` and `sitting.ts`). Those run under plain Node, where
 * `require('electron')` resolves to nothing at all — so a value import of
 * anything that reaches it (`AgentDispatcher` →`buildAgentContext` →
 * `ipc-handlers` → `getAIProvider` → `KeyVault`) makes both CLIs unstartable.
 * That is not hypothetical: it is how the 2026-08-18 owner sitting came to be
 * run behind a stub require-hook, and WP-24 is the packet that removed it.
 *
 * Under jest `electron` is mapped to a working mock, so the failure is
 * invisible here unless it is made visible — hence poisoning the module rather
 * than trusting the mock. `jest.isolateModules` gives the require a fresh
 * registry so the poison applies to a genuinely fresh load of the whole graph.
 */
test('electron is not on the require chain — both eval CLIs run under plain Node', () => {
  jest.isolateModules(() => {
    jest.doMock('electron', () => {
      throw new Error('electron was required by the eval probes');
    });
    expect(() => require('./probes')).not.toThrow();
    // And through the path that actually matters: the runner both CLIs load.
    expect(() => require('./runner')).not.toThrow();
  });
});

/**
 * WP-33 · `probeRefusalPayload` — the ORACLE is what makes it a probe.
 *
 * J-Refusal asks whether the door deep-links to *the specific grant*. A probe
 * that compared the door against the refusal that carries it would pass on any
 * two matching strings and would keep passing if the door were built from the
 * refusal alone — the shape of a guard that measures itself. So the probe reads
 * the LIVE GRANT and compares against that, and this test pins the oracle's
 * presence rather than only the verdict it produced.
 */
describe('probeRefusalPayload', () => {
  it('reads the live grant as the oracle, not the refusal it is judging', async () => {
    const p = await probeRefusalPayload(fixture);
    expect(p.refused).toBe(true);
    // The oracle fields are populated from getCapabilityGrants(), so a probe
    // that stopped consulting the grant leaves them undefined and this fails.
    expect(p.grantCapability).toBeTruthy();
    expect(p.grantRunbookId).toBeTruthy();
    // …and the comparison is door-vs-grant, which is only meaningful because
    // the two ids come from different places.
    expect(p.doorCapability).toBe(p.grantCapability);
    expect(p.doorRunbookId).toBe(p.grantRunbookId);
    expect(p.doorSurface).toBe('settings');
    expect(p.doorSection).toBe('capabilities');
    expect(p.capabilityInGrantVocabulary).toBe(true);
    expect(p.doorResolvesToThatGrant).toBe(true);
  });

  it('DISCLOSES that it cannot tell the grant\'s document from the refusal\'s', () => {
    // The limit found by WP-33's mutation battery: swapping the comparison's
    // operand from the grant to the refusal survives, because on a healthy run
    // the two ids are the same string. The probe must SAY so — an unstated
    // limit is how a measurement gets read as more than it is.
    return probeRefusalPayload(fixture).then((p) => {
      expect(p.grantAndRefusalAgreeOnDocument).toBe(true);
      expect(p.evidence.join(' ')).toContain('LIMIT of this measurement');
      expect(p.evidence.join(' ')).toContain('cannot distinguish');
    });
  });

  it('the disclosure points at the attempt that tried to remove it (WP-33b)', () => {
    // A disclosed limit with no record of having been tested reads as one
    // nobody looked at. The type's own comment carries where the attempt lives
    // and what it found, so the next reader does not redo it from scratch —
    // and if the attempt is ever deleted, this goes red rather than quietly
    // leaving a dangling citation.
    const source = fs.readFileSync(path.join(__dirname, 'probes.ts'), 'utf-8');
    expect(source).toContain('WP-33b ATTEMPTED THE DIVERGENT CASE AND FOUND IT UNREACHABLE');
    const attempt = fs.readFileSync(path.join(__dirname, 'probes.test.ts'), 'utf-8');
    expect(attempt).toContain('a stale pin disarms — it never yields a divergent document');
  });

  it('reports refused=false rather than throwing when nothing is armed', async () => {
    // The negative direction the runner never reaches: the guard returns null
    // for a tool on a turn with no request pending, and the probe has to
    // survive it with evidence rather than an exception.
    const p = await probeRefusalPayload(fixture);
    expect(p.evidence.length).toBeGreaterThan(0);
    expect(p.evidence.join(' ')).toContain('oracle');
  });
});

/**
 * WP-33 · `probeRendererSurfaces` — the absence has to be measured, and the
 * measurement has to be capable of finding something.
 */
describe('probeRendererSurfaces', () => {
  const surfaces = probeRendererSurfaces();

  it('reports which journey surfaces are still absent — and which have landed', () => {
    // NOT a blanket "everything is zero". That assertion was true when WP-33
    // was written and false eight hours later: WP-32 merged `scopeBlock` into
    // the renderer. A probe whose test freezes today's absences turns into a
    // tripwire against its own project's progress, so what is pinned is the
    // per-token reading, token by token, with the reason each one matters.
    expect(surfaces.counts.needsYou.renderer).toBe(0); // Glance's row, Return's triage
    expect(surfaces.counts.siteAtPlaces.renderer).toBe(0); // Inspect's comparator
    expect(surfaces.counts.sessionRegistry.renderer).toBe(0); // WP-30's fold
    expect(surfaces.counts.capabilityGrants.renderer).toBe(0); // Govern's matrix
    expect(surfaces.counts.refusalTurn.renderer).toBe(0); // WP-33b, the empty-run turn
    // …and the one that HAS landed, pinned as present so its BLOCKED criteria
    // cannot quietly go on citing it as missing.
    expect(surfaces.counts.scopeBlock.renderer).toBeGreaterThan(0); // WP-32, merged
    expect(surfaces.ok).toBe(false);
  });

  it('the scanner can actually find a token — otherwise every absence is free', () => {
    // The vacuous shape this guards: a walker with a broken path or a bad
    // extension filter reports zero for everything, and every BLOCKED verdict
    // downstream rests on it. `capabilityGrants` exists under src/ (just not
    // under src/renderer), so a working scanner must see it there.
    expect(surfaces.counts.capabilityGrants.all).toBeGreaterThan(0);
  });

  it('names each token and what its absence means', () => {
    expect(surfaces.evidence).toHaveLength(Object.keys(surfaces.counts).length);
    for (const line of surfaces.evidence) {
      expect(line).toMatch(/file\(s\) under src\/renderer/);
    }
  });
});

describe('probeIncidentProducer', () => {
  /**
   * The negative direction this probe has, and the one a report would never
   * show: `ok` must TRACK the measurements rather than announce success.
   *
   * A second run over the same fixture is the cheapest honest degraded world —
   * and it is a real property, not a contrivance. The producer's dedup is
   * durable, so the second fold of the same report and the same halted call
   * emits nothing; a probe hardcoded to `ok: true` (or one whose conjunction
   * had lost a term) would still claim a healthy supply, and E-01's criterion
   * would pass on a platform that had produced nothing this time.
   */
  it('reports NOT-ok when a run produces nothing new, however much history exists', async () => {
    const first = await probeIncidentProducer(fixture);
    expect(first.ok).toBe(true);
    expect(first.emittedBySentinelTap).toBeGreaterThan(0);
    expect(first.emittedByAbortTap).toBeGreaterThan(0);

    const second = await probeIncidentProducer(fixture);
    expect(second.emittedBySentinelTap).toBe(0);
    expect(second.ok).toBe(false);
    // …and it says so, rather than reporting a bare false.
    expect(second.evidence.join(' ')).toMatch(/folded a 2-finding report into 0 incident\(s\)/);
  });
});


/**
 * WP-33b · THE STALE-PIN EXHIBITING ATTEMPT — and its honest result.
 *
 * WP-33 left one mutation SURVIVED-and-disclosed: swapping
 * `grantAndRefusalAgreeOnDocument`'s (and the door check's) oracle from the
 * GRANT to the REFUSAL survives, because on a healthy run the two documents are
 * the same string. The merge acceptance registered a follow-up: WP-31's
 * stale-pin disarm is a shipped state in which a grant's pinned document and
 * the current registry can differ, so *maybe* a fixture reaching that state
 * makes the mutation observable and converts the survivor to a kill.
 *
 * IT DOES NOT, AND THE REASON IS STRUCTURAL RATHER THAN CIRCUMSTANTIAL. A stale
 * pin does not produce a grant that names a different document; it produces NO
 * GRANT. `resolveCapabilityGrants.admit` refuses the pin — hash-mismatch on
 * either form, the ruled word for both — and pushes it onto `disarmed`, where
 * the capability behaves as though it had never been granted. So the two
 * documents cannot differ *while both exist*:
 *
 *   · a LIVE grant's `runbookId` is always `rb.id` for the runbook the registry
 *     serves that capability, because `admit` writes `rb.id` and never the
 *     pinned `entry.runbookId`;
 *   · the refusal's `runbookId` is `runbooks.byCapability(capability).id` —
 *     the same registry, the same lookup;
 *   · and the registry refuses a second runbook claiming a capability already
 *     served (`duplicate-capability`), so that lookup has exactly one answer.
 *
 *   grant exists ⟹ same document.  documents differ ⟹ no grant, no oracle,
 *   and the probe reports "the journey has no subject here" instead of a door.
 *
 * THE SURVIVOR THEREFORE STAYS DISCLOSED. The alternative — reaching into the
 * grant set or the registry to force a divergent pair — would be a fixture
 * faking a state the platform cannot be in, and a kill credited to it would be
 * a kill of nothing. An unreachable state honestly stated beats a fixture that
 * fakes one. Everything below is executable: the disarm is driven through the
 * production resolver, the invariant is checked over every capability the
 * registry actually serves, and the probe is driven end to end in the disarmed
 * state. If a later change makes the divergence reachable, these tests are what
 * will notice — the third one goes red the day a stale pin yields a live grant.
 *
 * PLACED LAST IN THIS FILE ON PURPOSE: the end-to-end half re-syncs the
 * module-level live grant set, which every earlier test in this file reads.
 */
describe('WP-33b · a stale pin disarms — it never yields a divergent document', () => {
  const CAP = 'cap.bulk_plugin_update';
  const NEVER_THE_FILE_HASH = `sha256:${'0'.repeat(64)}`;

  const runbooks = (): RunbookRegistry => fixture.core.law!.runbooks;
  const grantFor = (res: GrantResolution, capability: string): ResolvedGrant | undefined =>
    res.grants.find((g) => g.capability === capability);
  const disarmFor = (res: GrantResolution, capability: string): DisarmedGrant | undefined =>
    res.disarmed.find((d) => d.capability === capability);

  it('the healthy state is the one the survivor describes: one document, two readers', () => {
    // The premise of the whole follow-up, driven rather than recalled.
    const served = runbooks().byCapability(CAP)!;
    const healthy = grantFor(resolveCapabilityGrants({ runbooks: runbooks(), settings: null }), CAP)!;
    expect(healthy.runbookId).toBe(served.id);
    expect(healthy.runbookHash).toBe(served.hash);
  });

  it('a pin to a hash the file has moved past DISARMS — no grant, not a different one', () => {
    const res = resolveCapabilityGrants({
      runbooks: runbooks(),
      settings: { capabilityGrants: [{ capability: CAP, runbookHash: NEVER_THE_FILE_HASH }] },
    });
    expect(grantFor(res, CAP)).toBeUndefined();
    const disarmed = disarmFor(res, CAP)!;
    expect(disarmed.reason).toBe('hash-mismatch');
    // Both hashes, because the remedy is to re-grant against the current file.
    expect(disarmed.detail).toContain(NEVER_THE_FILE_HASH);
  });

  it('a pin to a DIFFERENT document — the runbook-split shape — disarms the same way', () => {
    // The other half of "the grant's pinned document and the current registry
    // can differ": a grant reviewed against a document that no longer serves
    // this capability. This is the case that would most plausibly have produced
    // a live-but-divergent grant, and it does not.
    const res = resolveCapabilityGrants({
      runbooks: runbooks(),
      settings: { capabilityGrants: [{ capability: CAP, runbookId: 'rb.some-other-document' }] },
    });
    expect(grantFor(res, CAP)).toBeUndefined();
    expect(disarmFor(res, CAP)!.reason).toBe('hash-mismatch');
  });

  it('every live grant names the document the registry serves — there is no third source', () => {
    // The invariant the two cases above are instances of, checked over the
    // whole shipped set rather than the one capability this journey uses. This
    // is what makes the conclusion structural: a live grant CANNOT name a
    // document other than the served one, whatever settings say.
    // Checked with NO overlay and with three overlays, because the settings
    // layer is the only thing that could introduce a second document — an
    // invariant asserted only over the shipped set would say nothing about the
    // case the follow-up was actually about.
    const overlays: Array<Pick<NexusSettings, 'capabilityGrants'> | null> = [
      null,
      { capabilityGrants: [{ capability: CAP, runbookId: runbooks().byCapability(CAP)!.id }] },
      { capabilityGrants: [{ capability: CAP, runbookId: 'rb.some-other-document' }] },
      { capabilityGrants: [{ capability: CAP, runbookHash: NEVER_THE_FILE_HASH }] },
    ];
    for (const settings of overlays) {
      const res = resolveCapabilityGrants({ runbooks: runbooks(), settings });
      expect(res.grants.length).toBeGreaterThan(0);
      for (const grant of res.grants) {
        const served = runbooks().byCapability(grant.capability)!;
        expect(served).toBeDefined();
        expect(grant.runbookId).toBe(served.id);
        expect(grant.runbookHash).toBe(served.hash);
      }
    }
  });

  it('END TO END: in the disarmed state the probe has NO ORACLE, so there is nothing to compare', async () => {
    // The exhibiting attempt itself, driven through production code: sync the
    // live grant set from a settings overlay carrying a stale pin, then run the
    // probe the survivor lives in. If the divergent state were reachable this
    // is where it would show up as two different documents. What shows up
    // instead is the absence of the oracle — and the probe says so.
    const staleStorage = memoryStorageWith({
      [STORAGE_KEYS.SETTINGS]: { capabilityGrants: [{ capability: CAP, runbookHash: NEVER_THE_FILE_HASH }] },
    });
    syncCapabilityGrants({ core: fixture.core, storage: staleStorage, logger: quietLogger });
    expect(getCapabilityGrants().some((g) => g.capability === CAP)).toBe(false);

    const p = await probeRefusalPayload(fixture);
    expect(p.ok).toBe(false);
    expect(p.grantRunbookId).toBeUndefined();
    expect(p.grantAndRefusalAgreeOnDocument).toBe(false);
    expect(p.evidence.join(' ')).toContain('no live grant');
    // …and it does NOT report a divergent pair, because there is no pair. The
    // door the guard would still build has nothing to be compared against.
    expect(p.evidence.join(' ')).not.toContain('DIFFERENT here');
  });

  afterAll(() => {
    // Put the live set back, so a later reader of this module's state sees the
    // tree's real grants rather than this block's disarmed one.
    syncCapabilityGrants({ core: fixture.core, storage: memoryStorageWith({}), logger: quietLogger });
  });
});

/**
 * WP-34 · the two derivations of a task's citation supply must agree.
 *
 * `supplyFromBundle` is authoritative — it reads the bundle. The sitting's
 * `citedEventIdsOf` SCRAPES the rendered carrier instead, because a transcript
 * holds text and not the bundle it came from. Two derivations of one universe
 * is exactly the drift this codebase pins elsewhere (`localDay`,
 * `resolveAgentCron`/`effectiveCadenceExpression`), and the consequence here is
 * specific and bad: a scrape that misses an id renders a GOOD citation as the
 * loudest state on a judgment sheet, which is a false accusation handed to a
 * human. So the copies are pinned together over a real assembled turn.
 */
describe('WP-34 · probeCitationContract MEASURES its subject', () => {
  /**
   * The probe's failure direction, driven — because a probe that can only ever
   * report `ok: true` is an assertion wearing a measurement's clothes, and the
   * three citation criteria gate on exactly that field. If it could not go
   * false, "OWNER-PENDING" would be a constant and a platform regression that
   * stopped teaching the convention would still hand an owner six prompts to
   * sit with citations nobody was asked to write.
   *
   * The degraded world is a REACHABLE one, not a contrivance: WP-17's
   * `law-registry` init stage can fail, `IntelligenceCore.law` is optional for
   * that reason, and `syncCapabilityGrants` with no core is the production path
   * for "no law registry ⇒ no grants". With neither, no carrier rides at all.
   */
  it('reports ok:false when the wired carrier taught no convention', async () => {
    const before = getCapabilityGrants();
    syncCapabilityGrants({
      core: undefined,
      storage: memoryStorageWith({}),
      logger: quietLogger,
    });
    try {
      const probe = await probeCitationContract({
        ...fixture,
        core: { ...fixture.core, law: undefined },
      } as never);
      expect(probe.conventionRode).toBe(false);
      expect(probe.ok).toBe(false);
      expect(probe.evidence.join(' ')).toContain('did NOT teach');
    } finally {
      syncCapabilityGrants({ core: fixture.core, storage: memoryStorageWith({}), logger: quietLogger });
      expect(getCapabilityGrants().length).toBe(before.length);
    }
  });
});

describe('WP-34 · the scraped supply equals the assembled one', () => {
  it('every event id the bundle makes citable is found in the rendered carrier', async () => {
    setIntelligenceCore(fixture.core);
    const flagged = fixture.fleet.find((s) => s.historyFlagged)!;
    const bundle = await assemble(
      {
        actor: { id: 'act_wp34_pin', kind: 'agent', autonomy: 'interactive' },
        task: { id: mintTaskId(), intent: 'Update WooCommerce across the fleet.' },
        targets: [
          { role: 'environment', id: fixture.environmentIdOf(flagged.siteId), label: flagged.name },
          { role: 'site', id: fixture.siteIdOf(flagged.siteId), label: flagged.name },
        ],
        surface: 'eval.wp-34-pin',
      },
      {
        law: fixture.core.law?.registry,
        ledger: fixture.core.ledger,
        twins: fixture.core.twins,
        wrapUntrusted,
      }
    );

    const authoritative = supplyFromBundle(bundle).events.map((e) => e.id).sort();
    // The premise: this turn HAS episodic history. Without it both sides are
    // empty and the comparison would hold vacuously.
    expect(authoritative.length).toBeGreaterThan(0);

    const scraped = citedEventIdsOf(bundle.blocks.turn ?? undefined).sort();
    expect(scraped).toEqual(authoritative);
  });
});
