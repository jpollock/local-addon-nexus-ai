import { FleetCounts } from './FleetCounts';

/** Which population a measurement was taken over. */
export type CoverageScope = 'local' | 'wpe' | 'external' | 'installs';

export interface CoverageInput {
  /** How many members of `scope` were measured. */
  measured: number;
  scope: CoverageScope;
}

export interface CoverageRatio {
  numerator: number;
  denominator: number;
  percent: number;
  /** The scope label, so the number can never be rendered bare. */
  label: string;
}

/**
 * A coverage metric's numerator and denominator must span the same source set.
 * Measuring completeness over local sites and dividing by the fleet total is
 * what rendered "370/370" beside "367 sites".
 */
export function completenessRatio(input: CoverageInput, counts: FleetCounts): CoverageRatio {
  const population = counts[input.scope];
  const denominator = population.count;

  if (input.measured > denominator) {
    throw new Error(
      `Coverage numerator (${input.measured}) exceeds its own population ` +
        `"${input.scope}" (${denominator}) — the scopes do not match.`,
    );
  }

  return {
    numerator: input.measured,
    denominator,
    percent: denominator === 0 ? 0 : Math.round((input.measured / denominator) * 100),
    label: population.scope,
  };
}
