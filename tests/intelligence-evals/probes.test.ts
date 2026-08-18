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
import { createEvalFixture, EvalFixture } from './fixture';
import { probeRefusalPayload, probeRendererSurfaces, probeTimestampDiscipline, probeTopicFamily } from './probes';

jest.setTimeout(60_000);

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
