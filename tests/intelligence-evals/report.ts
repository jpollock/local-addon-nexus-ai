/**
 * WP-13 · Report rendering.
 *
 * One rule governs this file: a verdict never appears without its evidence.
 * The packet's phrasing is "per-criterion pass/fail WITH evidence — never a
 * bare boolean", and the enforcement is structural rather than editorial —
 * `renderCriterion` cannot emit a line without the evidence block, and
 * `report.test.ts` pins it.
 */
import { CriterionResult, RunReport, SpecFinding, SpecReport, tally, Verdict } from './types';

const MARK: Record<Verdict, string> = {
  PASS: '✔ PASS',
  FAIL: '✘ FAIL',
  BLOCKED: '⊘ BLOCKED',
  'OWNER-PENDING': '◻ OWNER-PENDING',
  'SPEC-DEFECT': '⚑ SPEC-DEFECT',
};

function indent(lines: string[], prefix: string): string[] {
  return lines.flatMap((l) => l.split('\n').map((part) => `${prefix}${part}`));
}

export function renderCriterion(result: CriterionResult): string {
  const out = [`  ${MARK[result.verdict]}  ${result.criterion.text}`];

  if (result.missing) out.push(`      missing: ${result.missing}`);
  if (result.unblockedBy) out.push(`      unblocked by: ${result.unblockedBy}`);
  if (result.specFix) out.push(`      spec fix: ${result.specFix}`);

  // Evidence is not optional. An empty list is itself reported, because a
  // silent verdict is the failure mode this renderer exists to prevent.
  const evidence = result.evidence.length
    ? result.evidence
    : ['(no evidence recorded — this is a defect in the check, not a result)'];
  out.push(...indent(evidence, '      · '));

  if (result.ownerPrompt) {
    out.push('      ┌─ HUMAN-IN-THE-LOOP PROMPT ' + '─'.repeat(40));
    out.push(...indent(result.ownerPrompt.split('\n'), '      │ '));
    out.push('      └' + '─'.repeat(67));
  }
  return out.join('\n');
}

function renderFinding(finding: SpecFinding): string {
  const out = [`  ${finding.kind === 'SPEC-DEFECT' ? '⚑ SPEC-DEFECT' : '· NOTE'}: ${finding.summary}`];
  out.push(...indent(finding.detail, '      - '));
  if (finding.specFix) {
    out.push(...indent([`FIX THE RECORD: ${finding.specFix}`], '      → '));
  }
  return out.join('\n');
}

function renderSpec(specReport: SpecReport): string {
  const { spec, results, findings } = specReport;
  const counts = tally({ specs: [specReport] } as RunReport);
  const summary = (Object.entries(counts) as Array<[Verdict, number]>)
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${n} ${v}`)
    .join(', ');

  const out = [
    '',
    '═'.repeat(78),
    `${spec.id}`,
    spec.description,
    `  ${results.length} criteria — ${summary}`,
    '═'.repeat(78),
  ];
  if (findings.length) {
    out.push('');
    out.push(...findings.map(renderFinding));
  }
  out.push('');
  out.push(...results.map(renderCriterion));
  return out.join('\n');
}

export function renderReport(report: RunReport): string {
  const counts = tally(report);
  const out: string[] = [
    '',
    'WP-13 · Anchor-slice eval run',
    `  at            ${report.at}`,
    `  fixture       ${report.ledgerPath}`,
    `  ledger events ${report.ledgerEvents} (seeded through the real producers)`,
    `  specs         ${report.specs.length}`,
  ];

  if (report.loadErrors.length) {
    out.push('', '  SPEC LOAD ERRORS (siblings still ran):');
    out.push(...report.loadErrors.map((e) => `    ✘ ${e.path || '(directory)'}: ${e.reason}`));
  }

  out.push(...report.specs.map(renderSpec));

  out.push('', '─'.repeat(78), 'TOTALS');
  for (const [verdict, n] of Object.entries(counts) as Array<[Verdict, number]>) {
    // SPEC-DEFECT is counted from spec-level findings, not from criterion
    // verdicts — printing the criterion tally's 0 next to a milestone line
    // reporting two of them is the kind of self-contradicting summary this
    // report exists to avoid.
    if (verdict === 'SPEC-DEFECT') continue;
    out.push(`  ${MARK[verdict].padEnd(18)} ${n}`);
  }
  const findingDefects = report.specs.flatMap((s) =>
    s.findings.filter((f) => f.kind === 'SPEC-DEFECT')
  ).length;
  out.push(`  ${MARK['SPEC-DEFECT'].padEnd(18)} ${counts['SPEC-DEFECT'] + findingDefects} (spec-level)`);
  out.push('', milestoneVerdict(report), '');
  return out.join('\n');
}

/**
 * The M2 close-out answer, stated plainly.
 *
 * "Green" is not the same as "no failures": BLOCKED criteria are absences of
 * capability, and reporting a run with eleven of them as green would be the
 * exact false-completeness this project has already been burned by.
 */
export function milestoneVerdict(report: RunReport): string {
  const counts = tally(report);
  const defects = report.specs.flatMap((s) => s.findings.filter((f) => f.kind === 'SPEC-DEFECT'));

  if (counts.FAIL > 0) {
    return `MILESTONE VERDICT: NOT MET — ${counts.FAIL} criterion/criteria FAILED against the real core.`;
  }
  if (counts.BLOCKED > 0 || defects.length > 0) {
    return [
      'MILESTONE VERDICT: NOT MET, and not by a test failure.',
      `  ${counts.PASS} criteria pass against the real core.`,
      `  ${counts.BLOCKED} are BLOCKED on capabilities that do not exist yet (each names which).`,
      `  ${counts['OWNER-PENDING']} await the owner's eval sitting (each carries its prompt).`,
      `  ${defects.length} spec-level defect(s) need a ruling before the specs can be run as written.`,
      '  Nothing here is a code regression; the gap is between what the specs assume ships and',
      '  what M2 actually shipped. The escalations above say what the record should be changed to.',
    ].join('\n');
  }
  if (counts['OWNER-PENDING'] > 0) {
    return `MILESTONE VERDICT: DETERMINISTIC HALF GREEN (${counts.PASS} pass); ${counts['OWNER-PENDING']} await the owner sitting.`;
  }
  return `MILESTONE VERDICT: MET — ${counts.PASS} criteria pass.`;
}
