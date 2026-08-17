/**
 * WP-13 · JSON Schema validator tests.
 *
 * The most important case in this file is the LAST one: an unsupported keyword
 * must THROW. A validator that ignores keywords it does not understand passes
 * everything, and would certify the ledger against constraints it never
 * applied — which is worse than no validation, because it produces a green
 * result.
 */
import * as fs from 'fs';
import {
  UnsupportedSchemaKeyword,
  validateAgainstJsonSchema,
} from './jsonSchemaCheck';
import { ENVELOPE_SCHEMA_PATH } from './probes';

const schema = () => JSON.parse(fs.readFileSync(ENVELOPE_SCHEMA_PATH, 'utf-8'));

const VALID = {
  id: 'evt_01M06JDSTJ7VD9SRCTQH8N6HCB',
  recorded_at: '2026-08-16T12:00:00.000Z',
  observed_at: '2026-08-16T11:59:00.000Z',
  topic: 'state.plugin.observed',
  schema: 'plugin.observed/1',
  entity: { environment: 'ent_env_01M06JDSTJ7VD9SRCTQH8N6HCB' },
  actor: { id: 'act_wp_webhook', kind: 'system', via: 'sat_01M06JDSTJ7VD9SRCTQH8N6HCB' },
  source: { class: 'platform', system: 'wp-webhook', trust: 'observed' },
  access: { tenant: 'local' },
  payload: { slug: 'woocommerce' },
};

describe('validateAgainstJsonSchema — the envelope schema on disk', () => {
  it('accepts a well-formed envelope', () => {
    expect(validateAgainstJsonSchema(VALID, schema())).toEqual([]);
  });

  it('treats an undefined-valued optional key as absent, not as a type error', () => {
    // The ledger's row mapper writes `correlation: undefined`; JSON.stringify
    // drops it, so the interchange contract never sees it.
    const withUndefined = { ...VALID, correlation: undefined, causation: undefined };
    expect(validateAgainstJsonSchema(withUndefined, schema())).toEqual([]);
  });

  it.each([
    ['a bad id pattern', { ...VALID, id: 'event-1' }, 'id'],
    ['a two-segment topic', { ...VALID, topic: 'task.context_assembled' }, 'topic'],
    ['a non-entity-shaped entity ref', { ...VALID, entity: { site: 'myloop' } }, 'entity.site'],
    ['an unknown source class', { ...VALID, source: { ...VALID.source, class: 'vibes' } }, 'source.class'],
    ['a malformed date-time', { ...VALID, observed_at: '2026-13-99' }, 'observed_at'],
  ])('rejects %s', (_label, instance, at) => {
    const violations = validateAgainstJsonSchema(instance, schema());
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.at === at)).toBe(true);
  });

  it('rejects a missing required property', () => {
    const { access, ...withoutAccess } = VALID;
    expect(access).toBeDefined();
    const violations = validateAgainstJsonSchema(withoutAccess, schema());
    expect(violations).toContainEqual({
      at: '(root)',
      message: 'missing required property "access"',
    });
  });

  it('rejects an additional top-level property', () => {
    const violations = validateAgainstJsonSchema({ ...VALID, sneaky: 1 }, schema());
    expect(violations).toContainEqual({
      at: '(root)',
      message: 'additional property "sneaky" is not allowed',
    });
  });

  it('reports EVERY violation, not just the first', () => {
    const violations = validateAgainstJsonSchema({ ...VALID, id: 'nope', topic: 'bad' }, schema());
    expect(violations.map((v) => v.at).sort()).toEqual(['id', 'topic']);
  });
});

describe('validateAgainstJsonSchema — the safety rule', () => {
  it('THROWS on a schema keyword it does not implement', () => {
    expect(() => validateAgainstJsonSchema({ a: 'x' }, { properties: { a: { minLength: 5 } } })).toThrow(
      UnsupportedSchemaKeyword
    );
  });

  it('names the offending keyword so the fix is obvious', () => {
    expect(() => validateAgainstJsonSchema({}, { oneOf: [] })).toThrow(/"oneOf" is not implemented/);
  });

  it('throws on an unresolvable $ref rather than skipping the constraint', () => {
    expect(() => validateAgainstJsonSchema('x', { $ref: '#/$defs/missing' })).toThrow(
      UnsupportedSchemaKeyword
    );
  });

  it('throws on a format it cannot check', () => {
    expect(() => validateAgainstJsonSchema('x', { type: 'string', format: 'email' })).toThrow(
      /format "email" is not implemented/
    );
  });
});
