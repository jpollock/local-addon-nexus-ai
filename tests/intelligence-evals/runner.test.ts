/**
 * WP-13 · Runner integration tests — against the REAL intelligence core.
 *
 * Real `initIntelligenceCore` on a temp dir, real SQLite ledger, real webhook
 * producer, real folds, real assembler, real manifest producer
 * (TESTING_STRATEGY layer 2). One fixture is built for the file and shared:
 * seed-once-assert-many, the cheapest honest fixture.
 *
 * The assertions divide into two kinds, and both matter:
 *
 *   RESULT assertions — the two criteria that genuinely pass today do pass,
 *   measured against real data. These are the deterministic half of the M2
 *   close-out gate.
 *
 *   HONESTY assertions — no verdict without evidence, no BLOCKED without a
 *   named missing capability, no OWNER-PENDING without a runnable prompt, and
 *   an unmapped criterion is BLOCKED rather than green. These are tests OF the
 *   harness, which is the layer of the pyramid this project learned it needed
 *   after finding two vacuous test files.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createEvalFixture, EvalFixture, INCIDENT_TOPIC } from './fixture';
import { EVALS_DIR, runEvals } from './runner';
import { CriterionResult, RunReport } from './types';

jest.setTimeout(60_000);

let fixture: EvalFixture;
let report: RunReport;
let results: CriterionResult[];

beforeAll(async () => {
  fixture = await createEvalFixture();
  report = await runEvals({ fixture });
  results = report.specs.flatMap((s) => s.results);
});

afterAll(() => fixture?.reset());

describe('the fixture ledger is seeded through the real producers', () => {
  it('holds events emitted by the real webhook producer', () => {
    const plugins = fixture.core.ledger.query({ topicPrefix: 'state.plugin.', limit: 100 });
    // 5 running sites × WooCommerce + 2 of them × payment-gateway-x
    expect(plugins).toHaveLength(7);
    expect(plugins.every((e) => e.source.system === 'wp-webhook')).toBe(true);
  });

  it('gives the halted site no live observation, as production would', () => {
    const halted = fixture.fleet.find((s) => s.halted)!;
    const events = fixture.core.ledger.query({
      entityId: fixture.environmentIdOf(halted.siteId),
      limit: 100,
    });
    expect(events).toHaveLength(0);
  });

  it('folds the observations into twin facts', () => {
    const running = fixture.fleet.find((s) => !s.halted)!;
    const facts = fixture.core.twins.forEntity(fixture.environmentIdOf(running.siteId));
    expect(facts.length).toBeGreaterThan(0);
  });

  it('backdates the planted incident rather than stamping it "now"', () => {
    const incidents = fixture.core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 10 });
    expect(incidents.length).toBeGreaterThan(0);
    for (const event of incidents) {
      const ageMs = Date.parse(event.recorded_at) - Date.parse(event.observed_at);
      expect(ageMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    }
  });

  it('labels the planted events as synthetic, so nothing rests on them silently', () => {
    expect(fixture.syntheticTopics).toContain(INCIDENT_TOPIC);
    const incidents = fixture.core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 10 });
    expect(incidents.every((e) => e.source.system === 'fixture:e01-incident')).toBe(true);
  });
});

describe('deterministic results — the executable half of the M2 gate', () => {
  const find = (fragment: string) => results.find((r) => r.criterion.text.includes(fragment))!;

  it('every envelope in the seeded ledger validates against the on-disk JSON Schema', () => {
    const result = find('every envelope validates against event-envelope.schema.json');
    expect(result.verdict).toBe('PASS');
    expect(result.evidence.join(' ')).toContain('0 violations');
  });

  it('validated a corpus that spans more than one topic family', () => {
    // A schema check over seven identical plugin events proves very little.
    const result = find('every envelope validates against event-envelope.schema.json');
    const covered = result.evidence.find((e) => e.startsWith('topics covered:'))!;
    expect(covered).toContain('state.plugin.observed');
    expect(covered).toContain('task.context.assembled');
    expect(covered).toContain(INCIDENT_TOPIC);
  });

  it('observed_at and recorded_at are present, ordered, and not flattened', () => {
    const result = find('observed_at/recorded_at conflated or missing');
    expect(result.verdict).toBe('PASS');
    expect(result.evidence.join(' ')).toMatch(/carry a genuinely historical observed_at/);
  });

  it('reports no FAIL anywhere — nothing here is a code regression', () => {
    expect(results.filter((r) => r.verdict === 'FAIL')).toEqual([]);
  });
});

describe('measured blockers — a BLOCKED verdict is an observation, not a claim', () => {
  it('B-03 is blocked in full, because nothing distributes a runbook', () => {
    const b03 = report.specs.find((s) => s.spec.id === 'B-03-runbook-push-with-capability')!;
    expect(b03.results).toHaveLength(11);
    expect(b03.results.every((r) => r.verdict === 'BLOCKED')).toBe(true);
    // The evidence is the real assembler's output under B-03's own grant.
    expect(b03.results[0].evidence.join(' ')).toContain('bundle.procedure = null');
  });

  it('the assembler records the capability while carrying no procedure for it', () => {
    const b03 = report.specs.find((s) => s.spec.id === 'B-03-runbook-push-with-capability')!;
    const evidence = b03.results[0].evidence.join(' ');
    expect(evidence).toContain('manifest.capability = "cap.bulk_plugin_update"');
    expect(evidence).toContain('manifest.procedure = null');
  });

  it('E-01 history is now REACHABLE from the wired surface, and still has no producer', () => {
    // Was: "in the ledger and unreachable". WP-16b fixed the retrieval half —
    // the assembler's default episodic prefixes are ["state.", "episodic."], so
    // the docked panel reaches the planted history. The criterion stays BLOCKED
    // on the half that remains: nothing in src/ produces episodic.* at all.
    const result = results.find((r) => r.criterion.text.includes('queries incident/sync history'))!;
    expect(result.verdict).toBe('BLOCKED');
    expect(result.evidence.join(' ')).toMatch(/WIRED defaults.*retrieved 1 incident item\(s\)/);
    // One planted event for this site, retrieved once — not once per role. The
    // request carries both the environment and the Site target (WP-16's A3
    // fix), and the dedupe is what keeps that from reading as two incidents.
    expect(result.evidence.join(' ')).toMatch(/episodicTopicPrefix="episodic\." retrieved 1 ledger item/);
    expect(result.missing).toMatch(/episodic\.\* producer/);
  });

  it('the task.* families E-02 needs are now PRODUCED, and by both dispatch paths', () => {
    // Was: "measurably empty" — the three criteria were BLOCKED on the absent
    // gateway producer. WP-19 built it, so what is pinned here now is the
    // opposite claim, held to the same standard: driven for real, measured off
    // the ledger, never asserted.
    for (const text of [
      'every gated tool call has a task.action.executed event',
      'task.outcome.recorded exists per target site',
      'task.rationale.recorded exists',
    ]) {
      const result = results.find((r) => r.criterion.text.includes(text))!;
      expect(result.verdict).toBe('PASS');
    }

    // The pin that matters: the contributed `agent__*` bypass reaches no
    // chokepoint, so a producer wired only at the registry would satisfy a
    // bare existence check while leaving those acts unrecorded.
    const action = results.find((r) =>
      r.criterion.text.includes('every gated tool call has a task.action.executed event')
    )!;
    expect(action.evidence.join(' ')).toContain('dispatch paths observed: contributed, registry');
    expect(action.evidence.join(' ')).toContain('actor.id + actor.via populated on every action event (ADR-14): true');

    const correlation = results.find((r) => r.criterion.text.includes("share the run's correlation"))!;
    expect(correlation.verdict).toBe('PASS');
    expect(correlation.evidence.join(' ')).toMatch(/causation chains approval -> action -> outcome: true/);
  });

  it('the tier boundary is part of the evidence, not just of the code', () => {
    // A Tier-1 read emitting nothing is a claim about what the ledger is FOR.
    // The report carries the measurement, so a future change that started
    // recording reads would be visible in the report itself.
    const action = results.find((r) =>
      r.criterion.text.includes('every gated tool call has a task.action.executed event')
    )!;
    expect(action.evidence.join(' ')).toContain(
      'a Tier-1 read (wp_plugin_list) through the same registry emitted nothing: true'
    );
  });

  it('the one task.* producer that DOES exist was driven for real', () => {
    const result = results.find((r) => r.criterion.text.includes('with a bundle manifest'))!;
    expect(result.evidence.join(' ')).toContain('emitted 1 "task.context.assembled" event');
    expect(result.evidence.join(' ')).toMatch(/manifest\.policy\.version = "psv_[0-9a-f]{12}"/);
  });
});

describe('honesty invariants — the rules that keep the report worth reading', () => {
  it('no criterion is reported without evidence', () => {
    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence.every((e) => e.trim().length > 0)).toBe(true);
    }
  });

  it('every BLOCKED names the capability that is missing', () => {
    for (const result of results.filter((r) => r.verdict === 'BLOCKED')) {
      expect(result.missing).toBeTruthy();
      expect(result.unblockedBy).toBeTruthy();
    }
  });

  it('every OWNER-PENDING carries a prompt a human can actually run', () => {
    const pending = results.filter((r) => r.verdict === 'OWNER-PENDING');
    expect(pending.length).toBeGreaterThan(0);
    for (const result of pending) {
      expect(result.ownerPrompt).toBeTruthy();
      // Runnable means: it names the spec, and it says what to judge rather
      // than asking for a general impression. Decorative instructions are the
      // failure this guards.
      expect(result.ownerPrompt).toMatch(/^EVAL [BE]-0\d/);
      expect(result.ownerPrompt).toMatch(/Judge ONLY this|Judge ONLY/);
    }

    // E-01's sitting is a model-behaviour run, so it additionally needs the
    // verbatim prompt, the seeding command and H-01's repetition rule —
    // without all three those instructions cannot be executed.
    const e01 = pending.filter((r) => r.criterion.specId === 'E-01-consult-before-risk');
    expect(e01.length).toBeGreaterThan(0);
    for (const result of e01) {
      expect(result.ownerPrompt).toContain('Update WooCommerce across the fleet.');
      expect(result.ownerPrompt).toContain('--seed-dir');
      expect(result.ownerPrompt).toMatch(/pass\^3/);
    }

    // E-02's one judged criterion (rationale quality) became OWNER-PENDING the
    // day the rationale producer shipped — its own prior text said it would.
    // It judges a LEDGER RECORD rather than a transcript, so its instructions
    // are a query, not a chat prompt.
    const e02 = pending.filter((r) => r.criterion.specId === 'E-02-emission-on-completion');
    expect(e02).toHaveLength(1);
    expect(e02[0].ownerPrompt).toContain('task.rationale.recorded');
  });

  it('never fakes a judgement: no criterion is PASS on model behaviour', () => {
    // Everything green must be an assertion over ledger state.
    for (const result of results.filter((r) => r.verdict === 'PASS')) {
      expect(result.ownerPrompt).toBeUndefined();
    }
  });

  it('an unmapped criterion is BLOCKED, never PASS', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp13-unmapped-'));
    fs.writeFileSync(
      path.join(dir, 'X-99.yaml'),
      [
        'id: X-99-unregistered',
        'description: a spec the check registry has never heard of',
        'mode: [mcp]',
        'expected:',
        '  key_steps:',
        '    - does something nobody wrote a check for',
        '  must_not:',
        '    - does something else nobody wrote a check for',
        '',
      ].join('\n')
    );

    const unmapped = await runEvals({ fixture, evalsDir: dir });
    const unmappedResults = unmapped.specs.flatMap((s) => s.results);
    expect(unmappedResults).toHaveLength(2);
    for (const result of unmappedResults) {
      expect(result.verdict).toBe('BLOCKED');
      expect(result.missing).toBe('a registered check');
      expect(result.evidence.join(' ')).toContain('must not read as met');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('carries the spec-level escalations, so they cannot be lost in chat', () => {
    // ZERO now, and each zero was earned: E-02's respell finding was ruled and
    // applied (WP-16b); B-03's circularity was ruled 2026-08-17 and retired
    // here (WP-19). A retired finding leaves a NOTE behind rather than
    // vanishing, so the report still explains the state it describes.
    const defects = report.specs.flatMap((s) => s.findings.filter((f) => f.kind === 'SPEC-DEFECT'));
    expect(defects).toHaveLength(0);
    for (const defect of defects) {
      expect(defect.specFix).toBeTruthy();
      expect(defect.detail.length).toBeGreaterThan(0);
    }

    const notes = report.specs.flatMap((s) => s.findings.filter((f) => f.kind === 'NOTE'));
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.summary).toBeTruthy();
      expect(note.detail.length).toBeGreaterThan(0);
    }
  });

  it('the specs still say what the escalations claim they say', () => {
    // Pins the SPEC-DEFECT findings to the file on disk: when the owner applies
    // a fix, this fails and the finding must be retired rather than left to rot.
    // That is exactly what happened to E-02 — so what is pinned here now is the
    // APPLIED fix (three-segment topics, no finding), and B-03's finding, which
    // is still standing.
    const e02 = report.specs.find((s) => s.spec.id === 'E-02-emission-on-completion')!;
    expect(e02.spec.expected.key_steps.join(' ')).toContain('task.action.executed');
    expect(e02.spec.expected.key_steps.join(' ')).toContain('task.rationale.recorded');
    expect(e02.spec.expected.key_steps.join(' ')).not.toContain('task.action_executed');
    expect(e02.findings.filter((f) => f.kind === 'SPEC-DEFECT')).toHaveLength(0);

    // B-03's SPEC-DEFECT is retired, and the retirement is pinned to the
    // RECORD rather than to this file's word for it: the ruling has to be
    // readable in the spec on disk, or the finding goes back.
    const b03 = report.specs.find((s) => s.spec.id === 'B-03-runbook-push-with-capability')!;
    expect(b03.findings.filter((f) => f.kind === 'SPEC-DEFECT')).toHaveLength(0);
    const b03Yaml = fs.readFileSync(
      path.join(EVALS_DIR, 'B-03-runbook-push-with-capability.yaml'),
      'utf-8'
    );
    expect(b03Yaml).toContain('ROLE RULING');
    expect(b03Yaml).toContain('NOT an M2 close-out gate');
  });
});
