/**
 * WP-13 · Eval spec runner — contract types.
 *
 * The runner's whole job is to answer, per criterion, "did this hold, and how
 * do you know?". Every answer therefore carries EVIDENCE, and the verdict
 * vocabulary is closed so that "we could not check this" can never be
 * mistaken for "this passed".
 *
 * Five verdicts, and the distinctions between them are load-bearing:
 *
 *   PASS          a check RAN against the real intelligence core and held.
 *   FAIL          a check RAN and did not hold. A real defect.
 *   BLOCKED       deterministically checkable in principle, but a NAMED
 *                 capability does not exist yet. Never a pass.
 *   OWNER-PENDING requires live model judgement (H-02 reserves judges for
 *                 register/clarity/plan quality). Carries the human prompt.
 *                 Never a pass, never faked.
 *   SPEC-DEFECT   the criterion as written cannot be executed because the
 *                 spec contradicts a standing ruling or a code contract.
 *                 The spec gets fixed in the record — not worked around.
 *
 * A criterion with no registered check resolves to BLOCKED, never PASS. That
 * rule is pinned by a test: an unmapped criterion silently scoring green is
 * the exact vacuous-guard shape this harness exists to prevent.
 */

/** The house eval dialect (tests/evals/cases/*.yaml and the anchor-slice set). */
export interface EvalSpec {
  id: string;
  description: string;
  suite?: string;
  moment?: string;
  tier?: number;
  frequency?: string;
  stakes?: string;
  mode: string[];
  prompt?: string;
  context?: { description?: string; setup?: string; [k: string]: unknown };
  guardrails?: Record<string, unknown>;
  expected: {
    task_completed?: boolean;
    key_steps: string[];
    must_not: string[];
  };
  scoring_weights?: Record<string, number>;
  notes?: string;
  /** Source path, relative to the evals directory. Diagnostics only. */
  path: string;
}

export interface SpecLoadError {
  path: string;
  reason: string;
}

export interface SpecLoadResult {
  specs: EvalSpec[];
  errors: SpecLoadError[];
}

export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'OWNER-PENDING' | 'SPEC-DEFECT';

/** Verdicts that may never be produced by an absent or unrun check. */
export const NON_PASSING: readonly Verdict[] = ['FAIL', 'BLOCKED', 'OWNER-PENDING', 'SPEC-DEFECT'];

/** Which half of `expected` a criterion came from. */
export type CriterionKind = 'key_step' | 'must_not';

export interface Criterion {
  /** `<specId>#<kind>[<index>]` — stable within one version of the YAML. */
  id: string;
  specId: string;
  kind: CriterionKind;
  index: number;
  /** The criterion text, verbatim from the spec. */
  text: string;
}

export interface CriterionResult {
  criterion: Criterion;
  verdict: Verdict;
  /**
   * Why this verdict. NEVER empty — a bare verdict is the thing this runner
   * exists not to emit. Rendered as bullet lines under the criterion.
   */
  evidence: string[];
  /** BLOCKED only: the capability that does not exist, named. */
  missing?: string;
  /** BLOCKED only: the packet or work that would supply it, if known. */
  unblockedBy?: string;
  /**
   * BLOCKED only: WHICH wall. `product` — the capability does not exist yet.
   * `harness` — it does, and this suite cannot yet walk it, so the gap is a
   * driver here rather than work in the product. Absent reads as `product`,
   * which is what every pre-2026-08-26 BLOCKED meant. Typed rather than
   * inferred from prose so the summary cannot drift from the detail again.
   */
  blockedOn?: 'product' | 'harness';
  /** OWNER-PENDING only: the verbatim prompt a human runs, and how to run it. */
  ownerPrompt?: string;
  /** SPEC-DEFECT only: what the record must be changed to say. */
  specFix?: string;
}

/**
 * A finding about the SPEC ITSELF rather than about any one criterion.
 *
 * Kept separate from criterion verdicts on purpose: "this eval's premise
 * cannot be constructed" and "criterion 4 failed" are different claims, and
 * folding the first into an arbitrarily-chosen criterion would both distort
 * the per-criterion tally and bury the escalation.
 */
export interface SpecFinding {
  kind: 'SPEC-DEFECT' | 'NOTE';
  summary: string;
  detail: string[];
  /** SPEC-DEFECT only: what the record must be changed to say. */
  specFix?: string;
}

export interface SpecReport {
  spec: EvalSpec;
  results: CriterionResult[];
  findings: SpecFinding[];
}

export interface RunReport {
  /** ISO timestamp of the run. */
  at: string;
  /** Where the seeded ledger lived, so a failed run can be inspected. */
  ledgerPath: string;
  /** How many events the real producers put in it. */
  ledgerEvents: number;
  specs: SpecReport[];
  loadErrors: SpecLoadError[];
}

export function tally(report: RunReport): Record<Verdict, number> {
  const counts: Record<Verdict, number> = {
    PASS: 0,
    FAIL: 0,
    BLOCKED: 0,
    'OWNER-PENDING': 0,
    'SPEC-DEFECT': 0,
  };
  for (const s of report.specs) for (const r of s.results) counts[r.verdict]++;
  return counts;
}
