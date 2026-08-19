/**
 * WP-13 · Report tests.
 *
 * Two obligations from the packet, made structural rather than editorial:
 * a verdict never renders without its evidence, and a run that could not
 * answer the question never renders as MET.
 */
import { milestoneVerdict, renderCriterion, renderReport } from './report';
import { CriterionResult, RunReport, SpecReport } from './types';

const criterion = (text: string) => ({
  id: `T-01#key_step[0]`,
  specId: 'T-01',
  kind: 'key_step' as const,
  index: 0,
  text,
});

function reportOf(results: CriterionResult[], findings: SpecReport['findings'] = []): RunReport {
  return {
    at: '2026-08-16T00:00:00.000Z',
    ledgerPath: '/tmp/x',
    ledgerEvents: 10,
    loadErrors: [],
    specs: [
      {
        spec: {
          id: 'T-01',
          description: 'a spec',
          mode: ['mcp'],
          expected: { key_steps: [], must_not: [] },
          path: 't.yaml',
        },
        results,
        findings,
      },
    ],
  };
}

describe('renderCriterion — never a bare verdict', () => {
  it('renders the evidence under the verdict', () => {
    const out = renderCriterion({
      criterion: criterion('does the thing'),
      verdict: 'PASS',
      evidence: ['checked 10 events', '0 violations'],
    });
    expect(out).toContain('✔ PASS');
    expect(out).toContain('· checked 10 events');
    expect(out).toContain('· 0 violations');
  });

  it('flags a check that produced NO evidence as a defect in the check', () => {
    // The failure mode this renderer exists to prevent: a verdict with nothing
    // behind it, rendered as if it were a result.
    const out = renderCriterion({
      criterion: criterion('does the thing'),
      verdict: 'PASS',
      evidence: [],
    });
    expect(out).toContain('no evidence recorded');
    expect(out).toContain('defect in the check');
  });

  it('prints the human prompt for an OWNER-PENDING criterion', () => {
    const out = renderCriterion({
      criterion: criterion('is well written'),
      verdict: 'OWNER-PENDING',
      evidence: ['judged'],
      ownerPrompt: 'Ask the model X, then judge Y.',
    });
    expect(out).toContain('HUMAN-IN-THE-LOOP PROMPT');
    expect(out).toContain('Ask the model X, then judge Y.');
  });

  it('names the missing capability for a BLOCKED criterion', () => {
    const out = renderCriterion({
      criterion: criterion('needs a gateway'),
      verdict: 'BLOCKED',
      evidence: ['0 events'],
      missing: 'the gateway middleware',
      unblockedBy: 'the gateway packet',
    });
    expect(out).toContain('missing: the gateway middleware');
    expect(out).toContain('unblocked by: the gateway packet');
  });
});

describe('milestoneVerdict — an absence is not a pass', () => {
  it('is NOT MET when anything failed', () => {
    const verdict = milestoneVerdict(
      reportOf([{ criterion: criterion('a'), verdict: 'FAIL', evidence: ['broke'] }])
    );
    expect(verdict).toContain('NOT MET');
    expect(verdict).toContain('FAILED');
  });

  it('is NOT MET when a criterion is BLOCKED, even with zero failures', () => {
    const verdict = milestoneVerdict(
      reportOf([
        { criterion: criterion('a'), verdict: 'PASS', evidence: ['ok'] },
        { criterion: criterion('b'), verdict: 'BLOCKED', evidence: ['absent'], missing: 'x' },
      ])
    );
    expect(verdict).toContain('NOT MET');
    expect(verdict).toContain('not by a test failure');
  });

  it('is NOT MET when a spec-level defect is outstanding', () => {
    const verdict = milestoneVerdict(
      reportOf(
        [{ criterion: criterion('a'), verdict: 'PASS', evidence: ['ok'] }],
        [{ kind: 'SPEC-DEFECT', summary: 's', detail: ['d'], specFix: 'f' }]
      )
    );
    expect(verdict).toContain('NOT MET');
  });

  it('does not claim MET while criteria await the owner', () => {
    const verdict = milestoneVerdict(
      reportOf([
        { criterion: criterion('a'), verdict: 'PASS', evidence: ['ok'] },
        { criterion: criterion('b'), verdict: 'OWNER-PENDING', evidence: ['judged'], ownerPrompt: 'p' },
      ])
    );
    expect(verdict).not.toContain('MILESTONE VERDICT: MET');
    expect(verdict).toContain('await the owner');
  });

  it('says MET only when every criterion passed', () => {
    const verdict = milestoneVerdict(
      reportOf([{ criterion: criterion('a'), verdict: 'PASS', evidence: ['ok'] }])
    );
    expect(verdict).toBe('MILESTONE VERDICT: MET — 1 criteria pass.');
  });

  it('never says MET over a run that evaluated NOTHING (WP-42)', () => {
    // The vacuous-green family, at this file's own summary line. Every branch
    // above counts verdicts, and zero of everything falls through to MET — so
    // `--only <no-match>`, an unreadable evals directory, and a set of specs
    // that all failed to parse each printed "MET — 0 criteria pass" at exit 0.
    // Nothing was checked, which is the one thing MET must never mean.
    const verdict = milestoneVerdict(reportOf([]));
    expect(verdict).not.toContain('MILESTONE VERDICT: MET');
    expect(verdict).toContain('NOT MET');
    expect(verdict).toContain('no criteria were evaluated');
  });

  it('a zero-criteria run is NOT MET even when the specs loaded cleanly', () => {
    // Guards the fix against being written as "MET unless there were load
    // errors": the reproduced defect had no load errors at all — the selector
    // matched no spec, so the loop simply never ran.
    const report = reportOf([]);
    report.loadErrors = [];
    expect(milestoneVerdict(report)).toContain('NOT MET');
  });
});

describe('renderReport', () => {
  it('counts spec-level defects in the totals instead of printing a misleading 0', () => {
    const out = renderReport(
      reportOf(
        [{ criterion: criterion('a'), verdict: 'PASS', evidence: ['ok'] }],
        [{ kind: 'SPEC-DEFECT', summary: 's', detail: ['d'], specFix: 'f' }]
      )
    );
    expect(out).toMatch(/SPEC-DEFECT\s+1 \(spec-level\)/);
  });

  it('surfaces spec load errors rather than silently running fewer specs', () => {
    const report = reportOf([]);
    report.loadErrors = [{ path: 'broken.yaml', reason: 'invalid YAML' }];
    const out = renderReport(report);
    expect(out).toContain('SPEC LOAD ERRORS');
    expect(out).toContain('broken.yaml: invalid YAML');
  });
});
