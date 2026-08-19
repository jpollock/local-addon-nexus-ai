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
  probeArmingGap,
  probeCitationContract,
  probeDeniedApproval,
  probeEnvelopeSchema,
  probeEpisodicRetrieval,
  probeGatewayEmission,
  probeIncidentProducer,
  probeManifestEvent,
  probeWidening,
  probeProcedureRun,
  probeRefusalPayload,
  probeRendererSurfaces,
  probeSessionRegistry,
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
  // RETIRED 2026-08-16 (WP-16b). E-02's four two-segment task topics were the
  // subject of a SPEC-DEFECT finding here; the architect ruled the respell and
  // applied it to the YAML, so the finding is gone rather than left to rot —
  // WP-13's own rule ("when the owner applies a fix, retire the finding"). The
  // spec now reads task.context.assembled / task.action.executed /
  // task.outcome.recorded / task.rationale.recorded, and the checks in
  // checks.ts bind to those strings.
  // RETIRED 2026-08-17 (WP-19). B-03's circularity — "gate on M2 AND gate on
  // the feature it requires" — was a standing SPEC-DEFECT here until the owner
  // RULED it at the WP-13 escalation: B-03 is not an M2 close-out gate, it is
  // the acceptance eval of the procedure-distribution packet (WP-20). The
  // ruling is recorded in TWO places, and this finding is retired rather than
  // left to rot because BOTH now carry it — the spec file's own ROLE RULING
  // block and the WP-13 adjudication in WORK_PACKETS.md. The NOTE below keeps
  // the reasoning visible in the report (a retired defect that vanishes
  // entirely reads as one that never existed) while no longer demanding a
  // decision that has already been made.
  'B-03-runbook-push-with-capability': [
    {
      kind: 'NOTE',
      summary:
        'B-03 is WP-20\'s acceptance eval, not an M2 gate — ruled 2026-08-17. WP-20 phase 2 has ' +
        'shipped, so the eleven criteria are no longer BLOCKED: four are platform properties this ' +
        'report DRIVES, and seven need a live model.',
      detail: [
        'Was a SPEC-DEFECT here: the record had B-03 gating M2 while the assembler contract ' +
          '(src/intelligence/assemble/types.ts:16-18) had procedure distribution gated on B-03.',
        'Ruled at the WP-13 escalation and applied to the record: the spec file carries a ROLE ' +
          'RULING block naming WP-20 as the packet B-03 accepts, and the WP-11 adjudication\'s ' +
          'milestone-DoD sentence is superseded by the WP-13 adjudication in WORK_PACKETS.md.',
        'WP-20e (2026-08-17) then flipped the criteria themselves. The blocker they shared — ' +
          '"nothing delivers a runbook to an actor" — is retired: a grant arms a capability, the ' +
          'hash-pinned document rides the trusted turn carrier, and an out-of-sequence gated call ' +
          'is refused at the dispatch chokepoint. This report drives all three, per run.',
        'What is left is not a platform gap: "did it canary one low-risk site", "was the flagged ' +
          'site last", "did it say it skipped the halted one" are facts about what an ACTOR did. ' +
          'They are OWNER-PENDING with sitting-harness instructions, and they need ' +
          'NEXUS_EVAL_API_KEY — the one dependency of this milestone that is not code.',
      ],
    },
  ],
  'E-01-consult-before-risk': [
    {
      kind: 'NOTE',
      summary:
        'E-01\'s incident history HAS a producer as of WP-25 — and the history this report plants ' +
        'is still planted. Two different statements, and the report keeps them apart.',
      detail: [
        'Retired here: "nothing in src/ emits an episodic INCIDENT event", true at WP-13 and ' +
          'narrowed at WP-20e to exclude WP-14\'s sync topics. incidentProducer.ts now folds ' +
          'security-sentinel findings and procedure aborts into episodic.incident.recorded, and ' +
          'probeIncidentProducer DRIVES both taps in this report rather than asserting them.',
        'What has NOT changed: the WooCommerce-broke-checkout history the prompt is about is ' +
          'planted by this runner through the real Emitter (real validation, real ids) under ' +
          'source.system="fixture:e01-incident". Rewriting it through the producer would change ' +
          'what the judged criteria are judging, and the sentinel tap cannot supply its version ' +
          'pair anyway — a sentinel finding carries no from_version/to_version.',
        'The two are separable by provenance in the ledger (source.system), and every criterion ' +
          'that leans on the planted half still says so. Nothing in this report rests silently on ' +
          'synthetic data.',
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
      // WP-20e. Runs FIRST, and it is the one probe that changes the world: it
      // arms a capability, delivers a runbook, and drives five gate decisions
      // through the production chokepoint. Everything below therefore reads a
      // ledger that contains a real procedure run — which is the point, and is
      // why the schema and timestamp probes still run last.
      procedure: await probeProcedureRun(fixture),
      deniedApproval: await probeDeniedApproval(fixture),
      // WP-31. Runs on its own turn, assembled with NOTHING armed — the gap has
      // no run by definition, and a probe that armed first would answer a
      // different question than the one the incident asks.
      armingGap: await probeArmingGap(fixture),
      // WP-33. Its own unarmed turn, like the gap probe and for the same
      // reason: it must read the refusal the guard builds when nothing is
      // armed, not one produced by a run this report set up.
      refusalPayload: await probeRefusalPayload(fixture),
      // WP-33. Reads the tree, not the ledger — no fixture, no ordering
      // constraint. Placed here so the journey checks see it beside the rest.
      surfaces: probeRendererSurfaces(),
      episodic: await probeEpisodicRetrieval(fixture),
      // WP-25. Runs AFTER the episodic probe, deliberately: that one counts the
      // fixture-planted history, and this one adds producer-emitted events to
      // the same ledger. In the other order the "planted" count would include
      // them and the report would lose the distinction it exists to keep.
      incidentProducer: await probeIncidentProducer(fixture),
      // WP-34. AFTER the incident producer, deliberately: it drives the wired
      // chat carrier over a site whose history this report has finished
      // planting, so the ids it reports as citable are the ids a sitting would
      // actually be handed.
      citation: await probeCitationContract(fixture),
      // WP-44. AFTER the refusal probe and after the citation probe, because it
      // is the one probe besides `procedure` that CHANGES the world: it grants a
      // production capability at the control and then revokes it. Running it
      // earlier would put a live grant under every probe below, and
      // `probeRefusalPayload` in particular reads a refusal that depends on what
      // is granted — it would stop refusing and the report would lose its
      // subject rather than fail.
      widening: await probeWidening(fixture),
      manifest: await probeManifestEvent(fixture),
      // WP-19. Runs BEFORE the schema/timestamp probes below read the ledger,
      // so those two validate the gateway's own envelopes rather than a corpus
      // that predates them — a schema check that never sees the newest
      // producer's output is a check with a blind spot.
      gateway: await probeGatewayEmission(fixture),
      schema: probeEnvelopeSchema(fixture),
      timestamps: probeTimestampDiscipline(fixture),
      // WP-30. LAST, and it has to be: it is the only probe that DESTROYS host
      // state rather than adding to the ledger — the simulated boot empties
      // `procedureCursor`'s in-memory run map, which `probeProcedureRun` warmed
      // and the sequence guard reads. Any probe after this one would be reading
      // a process rebooted underneath it. Placing it here is not tidiness; a
      // probe that ran after it and consulted `runForTask` would silently
      // measure the wrong world.
      sessionRegistry: await probeSessionRegistry(fixture),
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
