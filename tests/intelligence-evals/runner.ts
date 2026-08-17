/**
 * WP-13 · The runner — load the specs, probe the real core, adjudicate every
 * criterion, and return a report that carries its own evidence.
 *
 * Deliberately NOT a jest suite. The runner is a library plus a CLI
 * (`run.ts`), and `runner.test.ts` drives it. That split is what lets the
 * OWNER-PENDING half exist at all: a jest run must be green or red, while an
 * eval sitting needs a printed prompt for a human to act on. Folding the two
 * together would force every judged criterion into a fake boolean, which is
 * precisely what the packet forbids.
 */
import { createEvalFixture, EvalFixture } from './fixture';
import { criteriaOf, loadEvalSpecs } from './specLoader';
import { checkFor } from './checks';
import {
  probeEnvelopeSchema,
  probeEpisodicRetrieval,
  probeManifestEvent,
  probeProcedureDistribution,
  probeTimestampDiscipline,
  probeTopicFamily,
} from './probes';
import { CriterionResult, RunReport, SpecFinding, SpecReport } from './types';
import * as path from 'path';

export const EVALS_DIR = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'intelligence',
  'anchor-slice',
  'evals'
);

/**
 * Findings about the specs themselves, keyed by spec id.
 *
 * These are escalations in the WP-11 sense: the record is wrong or
 * self-contradictory, and the fix belongs in the record rather than in a
 * workaround here. They are stated as data so the report renders them and a
 * test can pin that they are still true.
 */
export const SPEC_FINDINGS: Record<string, SpecFinding[]> = {
  'E-02-emission-on-completion': [
    {
      kind: 'SPEC-DEFECT',
      summary:
        'Four of E-02\'s six key_steps name TWO-segment task topics that the envelope validator ' +
        'cannot admit, so they can never be satisfied as written.',
      detail: [
        'envelope/validate.ts requires <type>.<subject>.<verb> — three segments.',
        'The spec names: task.context_assembled, task.action_executed, task.outcome_recorded, ' +
          'task.rationale_recorded. All are two-segment and unemittable.',
        'This is already adjudicated. WP-11 raised the identical escalation against the ' +
          'architecture doc\'s §4.2 taxonomy and the architect ruled "the validator wins, taxonomy ' +
          'respelled" (WORK_PACKETS finding 1, closed in the WP-11 adjudication). The shipped ' +
          'producer emits task.context.assembled. The eval YAML was written before that ruling and ' +
          'never carried it.',
        'Consequence if left: an eval that literally cannot pass, on a milestone gate, reading as ' +
          'an implementation failure rather than a stale spelling.',
      ],
      specFix:
        'In docs/intelligence/anchor-slice/evals/E-02-emission-on-completion.yaml respell to ' +
        'task.context.assembled / task.action.executed / task.outcome.recorded / ' +
        'task.rationale.recorded — mechanical, and covered by the standing WP-11 ruling.',
    },
  ],
  'B-03-runbook-push-with-capability': [
    {
      kind: 'SPEC-DEFECT',
      summary:
        'B-03 is registered as a gate on M2 AND as the gate on the feature it requires. The two ' +
        'cannot both hold; one of them has to move.',
      detail: [
        'WORK_PACKETS.md (WP-11 adjudication): "M2 is code-complete; the milestone closes when ' +
          'WP-13\'s runner executes those three evals green against the real ledger."',
        'src/intelligence/assemble/types.ts:16-18: "procedure and tools are present but inert in v0 ' +
          '(always null / []) — recon §4.3 defers both to the procedure packet, GATED ON EVAL B-03."',
        'So B-03 cannot pass until procedure distribution ships, and procedure distribution is ' +
          'gated on B-03. Every one of B-03\'s eleven criteria is BLOCKED on that circle, and the ' +
          'probe in this report measures it rather than asserting it.',
        'Reading the two statements together, the assembler\'s is the intended one: B-03 is a ' +
          'DESIGN gate ("do not build procedure distribution until this eval says what good looks ' +
          'like"), not an acceptance gate M2 could ever have met.',
      ],
      specFix:
        'Owner ruling needed on ONE of: (a) B-03 leaves the M2 close-out set and moves to the ' +
        'procedure packet as its acceptance eval — recommended, it matches the assembler contract ' +
        'and leaves M2 gated on E-01/E-02; or (b) M2 stays open until procedure distribution ships, ' +
        'which makes M2 a much larger milestone than "code-complete" implies.',
    },
  ],
  'E-01-consult-before-risk': [
    {
      kind: 'NOTE',
      summary:
        'E-01\'s fixture cannot be built by any production producer: nothing in src/ emits an ' +
        'episodic.* event.',
      detail: [
        'The only topics emitted anywhere in src/ are state.plugin.observed, state.plugin.removed, ' +
          'state.theme.observed, state.user.observed, state.site.observed, state.drift.detected, ' +
          'semantic.content.changed and task.context.assembled.',
        'This runner therefore plants the incident history through the real Emitter (real ' +
          'validation, real ids) under source.system="fixture:e01-incident", and says so in the ' +
          'evidence of every criterion that leans on it. Nothing in this report rests silently on ' +
          'synthetic data.',
        'The incident-history plane is what WP-14 (sync events) starts to fill; an incident ' +
          'producer proper is not yet registered as a packet.',
      ],
    },
  ],
};

export interface RunOptions {
  /** Reuse a fixture (the test suite builds one per file). Otherwise one is created and reset. */
  fixture?: EvalFixture;
  /** Restrict to one spec id. */
  only?: string;
  /** Override the spec directory. Exists so the honesty rules can be tested against
   *  a spec the registry deliberately does NOT cover — see runner.test.ts. */
  evalsDir?: string;
}

export async function runEvals(options: RunOptions = {}): Promise<RunReport> {
  const fixture = options.fixture ?? (await createEvalFixture());
  const owned = !options.fixture;

  try {
    // Probes run ONCE and are shared: they are observations of one fixture
    // state, and re-running them per criterion would let two criteria in the
    // same report disagree about what the ledger contains.
    const probes = {
      procedure: await probeProcedureDistribution(fixture),
      episodic: await probeEpisodicRetrieval(fixture),
      manifest: await probeManifestEvent(fixture),
      schema: probeEnvelopeSchema(fixture),
      timestamps: probeTimestampDiscipline(fixture),
      taskFamily: (prefix: string) => probeTopicFamily(fixture, prefix),
    };
    const ctx = { fixture, probes };

    const { specs, errors } = loadEvalSpecs(options.evalsDir ?? EVALS_DIR);
    const specReports: SpecReport[] = [];

    for (const spec of specs) {
      if (options.only && spec.id !== options.only) continue;
      const results: CriterionResult[] = [];

      for (const criterion of criteriaOf(spec)) {
        const check = checkFor(criterion.specId, criterion.kind, criterion.text);
        if (!check) {
          // The rule that keeps the harness honest: unmapped is never green.
          results.push({
            criterion,
            verdict: 'BLOCKED',
            missing: 'a registered check',
            unblockedBy: 'add one to tests/intelligence-evals/checks.ts',
            evidence: [
              'no check in the registry binds to this criterion text',
              'reported BLOCKED rather than skipped: an obligation nobody checks must not read as met',
            ],
          });
          continue;
        }
        try {
          results.push({ criterion, ...check.run(ctx) });
        } catch (err) {
          // A throwing check is a broken check, not a passing criterion.
          results.push({
            criterion,
            verdict: 'FAIL',
            evidence: [`the check itself threw: ${(err as Error).message}`],
          });
        }
      }

      specReports.push({ spec, results, findings: SPEC_FINDINGS[spec.id] ?? [] });
    }

    return {
      at: new Date().toISOString(),
      ledgerPath: fixture.dir,
      ledgerEvents: fixture.core.ledger.count(),
      specs: specReports,
      loadErrors: errors,
    };
  } finally {
    if (owned) fixture.reset();
  }
}
