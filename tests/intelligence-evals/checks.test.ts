/**
 * WP-13 · Check-registry tests — the binding must be total, in both directions.
 *
 * Two failure modes, and each has a test:
 *
 *   ORPHANED CRITERION — a spec grows a step nobody checks. It would silently
 *   vanish from the report's obligations while the totals still look complete.
 *
 *   DEAD CHECK — a spec's wording changes, the substring stops matching, and
 *   the check keeps existing while checking nothing. This is the exact shape
 *   of a vacuous guard: code that reads as coverage and provides none.
 */
import { CHECKS, checkFor } from './checks';
import { criteriaOf, loadEvalSpecs } from './specLoader';
import { EVALS_DIR } from './runner';

const { specs } = loadEvalSpecs(EVALS_DIR);
const allCriteria = specs.flatMap(criteriaOf);

describe('the check registry binds totally', () => {
  it('has loaded the specs it is asserting about', () => {
    // Guards the whole file: if the specs failed to load, every it.each below
    // would iterate an empty list and pass vacuously.
    expect(specs).toHaveLength(3);
    expect(allCriteria.length).toBeGreaterThanOrEqual(27);
  });

  it.each(allCriteria.map((c) => [c.id, c] as const))(
    'binds exactly one check to %s',
    (_id, criterion) => {
      const matching = CHECKS.filter(
        (c) =>
          c.specId === criterion.specId &&
          c.kind === criterion.kind &&
          criterion.text.includes(c.matches)
      );
      expect(matching).toHaveLength(1);
    }
  );

  it.each(CHECKS.map((c) => [`${c.specId}/${c.kind}: "${c.matches}"`, c] as const))(
    'check %s still binds to a real criterion',
    (_label, check) => {
      const bound = allCriteria.filter(
        (crit) =>
          crit.specId === check.specId && crit.kind === check.kind && crit.text.includes(check.matches)
      );
      expect(bound).toHaveLength(1);
    }
  );
});

describe('checkFor', () => {
  it('returns undefined for text no check claims — the runner turns that into BLOCKED', () => {
    expect(checkFor('E-01-consult-before-risk', 'key_step', 'invents a criterion')).toBeUndefined();
  });

  it('does not match a criterion of the right text but the wrong half', () => {
    // must_not and key_steps are different obligations; a check bound to one
    // must never be credited against the other.
    const keyStep = allCriteria.find((c) => c.specId === 'B-03-runbook-push-with-capability' && c.kind === 'key_step')!;
    expect(checkFor(keyStep.specId, 'must_not', keyStep.text)).toBeUndefined();
  });

  it('does not match across specs', () => {
    const b03 = allCriteria.find((c) => c.specId === 'B-03-runbook-push-with-capability')!;
    expect(checkFor('E-02-emission-on-completion', b03.kind, b03.text)).toBeUndefined();
  });
});
