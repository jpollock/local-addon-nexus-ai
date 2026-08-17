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
import { probeTimestampDiscipline, probeTopicFamily } from './probes';

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
    const probe = probeTopicFamily(fixture, 'control.');
    expect(probe.ok).toBe(false);
    expect(probe.evidence[0]).toMatch(/returned 0 event\(s\) of \d+ total/);
  });

  it('reports presence for a family the real producers do fill', () => {
    const probe = probeTopicFamily(fixture, 'state.plugin.');
    expect(probe.ok).toBe(true);
    expect(probe.evidence[0]).toContain('returned 7 event(s)');
  });
});
