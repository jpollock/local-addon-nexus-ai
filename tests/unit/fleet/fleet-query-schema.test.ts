/**
 * Schema-level tests for the documents the CLI actually sends.
 *
 * Every other fleet test calls the resolver function directly, which bypasses
 * GraphQL field selection. That is structurally unable to catch the class of
 * bug where the resolver returns a field the query never asks for: the CLI
 * read `health.factorsEvaluated`, the resolver returned it, and the query
 * omitted it — so it was `undefined` at runtime and the partial-basis
 * disclosure never printed. These tests execute the CLI's own query string
 * against the built schema, so the selection set is exercised.
 */
import { buildASTSchema, concatAST, graphql, parse } from 'graphql';
import { typeDefs } from '../../../src/main/graphql/schema';
import { SITE_HEALTH_QUERY } from '../../../src/cli/commands/fleet';

// The addon contributes `extend type Mutation` / `extend type Query` only —
// Local's GraphQL host owns the root types. Supply stub roots so the addon's
// SDL can be built standalone.
const ROOT_STUBS = parse('type Query { _base: String }\ntype Mutation { _base: String }');
const schema = buildASTSchema(concatAST([ROOT_STUBS, typeDefs]));

/** Minimal stand-in for a resolver result; only field selection is under test. */
function rootValueFor(health: Record<string, unknown> | null) {
  return {
    nexusFleetSiteHealth: () => ({ success: true, error: null, health }),
  };
}

const SCORED_HEALTH = {
  status: 'warning',
  score: 79,
  factorsEvaluated: ['security', 'performance'],
  issues: [{ severity: 'warning', message: 'PHP version unknown', category: 'security' }],
  plugins: { total: 12, active: 9, outdated: null },
  themes: { total: 3, active: 1, outdated: null },
  wordpress: { version: '6.8.0', updateAvailable: null },
};

describe('fleet site-health query — schema execution', () => {
  it('is a valid document against the built schema', async () => {
    const result = await graphql({
      schema,
      source: SITE_HEALTH_QUERY,
      rootValue: rootValueFor(SCORED_HEALTH),
      variableValues: { target: 'wpe:acct/install@production' },
    });

    expect(result.errors).toBeUndefined();
  });

  it('selects factorsEvaluated, so the CLI can disclose a partial basis', async () => {
    const result = await graphql({
      schema,
      source: SITE_HEALTH_QUERY,
      rootValue: rootValueFor(SCORED_HEALTH),
      variableValues: { target: 'wpe:acct/install@production' },
    });

    const health = (result.data as any)?.nexusFleetSiteHealth?.health;
    // Field selection, not the resolver, decides whether this key exists.
    expect(health).toHaveProperty('factorsEvaluated');
    expect(health.factorsEvaluated).toEqual(['security', 'performance']);
  });

  it('accepts a null score and status for an unscoreable target', async () => {
    const result = await graphql({
      schema,
      source: SITE_HEALTH_QUERY,
      rootValue: rootValueFor({
        status: null,
        score: null,
        factorsEvaluated: [],
        issues: [],
        plugins: null,
        themes: null,
        wordpress: { version: 'unknown', updateAvailable: null },
      }),
      variableValues: { target: 'ssh:hostinger-test@production' },
    });

    expect(result.errors).toBeUndefined();
    const health = (result.data as any)?.nexusFleetSiteHealth?.health;
    expect(health.score).toBeNull();
    expect(health.status).toBeNull();
    expect(health.factorsEvaluated).toEqual([]);
  });
});
