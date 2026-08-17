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
import { runEvals } from './runner';
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

  it('E-01 history is in the ledger and unreachable from the wired surface', () => {
    const result = results.find((r) => r.criterion.text.includes('queries incident/sync history'))!;
    expect(result.verdict).toBe('BLOCKED');
    expect(result.evidence.join(' ')).toMatch(/retrieved 0 incident item\(s\)/);
    expect(result.evidence.join(' ')).toMatch(/episodicTopicPrefix="episodic\." retrieved 2 ledger item/);
  });

  it('the task.* families E-02 needs are measurably empty', () => {
    for (const family of ['task.action.', 'task.outcome.', 'task.rationale.']) {
      const result = results.find((r) => r.evidence.some((e) => e.includes(`topicPrefix="${family}"`)))!;
      expect(result.verdict).toBe('BLOCKED');
      expect(result.evidence.join(' ')).toContain(`topicPrefix="${family}" returned 0 event(s)`);
    }
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
      // The spec's verbatim prompt, the seeding command, and H-01's repetition
      // requirement — without all three the "instructions" are decorative.
      expect(result.ownerPrompt).toContain('Update WooCommerce across the fleet.');
      expect(result.ownerPrompt).toContain('--seed-dir');
      expect(result.ownerPrompt).toMatch(/pass\^3/);
    }
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
    const defects = report.specs.flatMap((s) => s.findings.filter((f) => f.kind === 'SPEC-DEFECT'));
    expect(defects).toHaveLength(2);
    for (const defect of defects) {
      expect(defect.specFix).toBeTruthy();
      expect(defect.detail.length).toBeGreaterThan(0);
    }
  });

  it('the specs still say what the escalations claim they say', () => {
    // Pins the SPEC-DEFECT findings to the file on disk: when the owner applies
    // a fix, this fails and the finding must be retired rather than left to rot.
    const e02 = report.specs.find((s) => s.spec.id === 'E-02-emission-on-completion')!;
    expect(e02.spec.expected.key_steps.join(' ')).toContain('task.action_executed');
    expect(e02.spec.expected.key_steps.join(' ')).toContain('task.rationale_recorded');
  });
});
