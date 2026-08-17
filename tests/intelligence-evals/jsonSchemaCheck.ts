/**
 * WP-13 · A tiny JSON Schema validator, for one job only.
 *
 * E-02 requires that "every envelope validates against
 * event-envelope.schema.json" — the INTERCHANGE contract. The core validates
 * with zod (`envelope/validate.ts`), the IN-PROCESS contract. Checking the
 * ledger against the zod schema again would prove nothing: it is the schema
 * the events were already admitted by. The eval only means something if the
 * JSON file on disk is the thing doing the checking, so the two contracts
 * cannot drift apart unnoticed.
 *
 * Why not a library: `ajv` is present in node_modules only TRANSITIVELY, at
 * v6, which speaks draft-07 and not the draft 2020-12 this schema declares.
 * Depending on a transitive package is the same latent packaging defect the
 * owner just fixed by promoting js-yaml to `dependencies`, and the protocol
 * forbids adding a dependency without approval. So: a validator for the
 * keyword subset this schema actually uses.
 *
 * THE SAFETY RULE THAT MAKES THIS HONEST: any keyword the validator does not
 * implement is a THROWN error, not a skipped constraint. If someone adds
 * `minLength` or `oneOf` to the envelope schema, this file fails loudly rather
 * than quietly certifying events against a constraint it never applied. A
 * validator that silently ignores what it does not understand always passes,
 * which is indistinguishable from not validating at all.
 */

/** Keywords with no assertion behaviour — safe to ignore. */
const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'default',
  'examples',
  '$comment',
  'deprecated',
]);

/** Keywords this validator implements. Anything else throws. */
const SUPPORTED = new Set([
  'type',
  'required',
  'properties',
  'additionalProperties',
  'pattern',
  'enum',
  'format',
  '$ref',
  '$defs',
]);

export interface SchemaViolation {
  /** JSON pointer-ish path into the instance, e.g. `actor.via`. */
  at: string;
  message: string;
}

export class UnsupportedSchemaKeyword extends Error {}

type Schema = Record<string, unknown>;

/**
 * Validate `instance` against `schema`. Returns every violation found, so a
 * report can name all of them rather than the first.
 *
 * @throws UnsupportedSchemaKeyword if the schema uses a keyword this
 *         validator does not implement — see the file header.
 */
export function validateAgainstJsonSchema(instance: unknown, schema: Schema): SchemaViolation[] {
  const root = schema;
  const out: SchemaViolation[] = [];
  walk(instance, schema, '', root, out);
  return out;
}

function resolveRef(ref: string, root: Schema): Schema {
  if (!ref.startsWith('#/')) {
    throw new UnsupportedSchemaKeyword(`only local #/ refs are supported, got: ${ref}`);
  }
  let node: unknown = root;
  for (const segment of ref.slice(2).split('/')) {
    node = (node as Record<string, unknown>)?.[segment];
    if (node === undefined) throw new UnsupportedSchemaKeyword(`unresolvable $ref: ${ref}`);
  }
  return node as Schema;
}

function assertKeywordsSupported(schema: Schema): void {
  for (const key of Object.keys(schema)) {
    if (ANNOTATIONS.has(key) || SUPPORTED.has(key)) continue;
    throw new UnsupportedSchemaKeyword(
      `schema keyword "${key}" is not implemented by this validator — ` +
        `implement it or the constraint would be silently unenforced`
    );
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'object' | 'string' | 'number' | 'boolean'
}

// The schema declares `format: date-time`. Accepting anything Date.parse likes
// would admit "2026-13-99"; this is the RFC 3339 shape the envelope actually
// writes (toISOString), plus the offset form the zod validator also allows.
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function walk(value: unknown, schema: Schema, at: string, root: Schema, out: SchemaViolation[]): void {
  assertKeywordsSupported(schema);

  if (typeof schema.$ref === 'string') {
    walk(value, resolveRef(schema.$ref, root), at, root, out);
    return;
  }

  const where = at || '(root)';

  if (typeof schema.type === 'string' && typeOf(value) !== schema.type) {
    out.push({ at: where, message: `expected type ${schema.type}, got ${typeOf(value)}` });
    return; // further keywords assume the type held
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    out.push({ at: where, message: `${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}` });
  }

  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      out.push({ at: where, message: `"${value}" does not match ${schema.pattern}` });
    }
    if (schema.format === 'date-time' && !RFC3339.test(value)) {
      out.push({ at: where, message: `"${value}" is not an RFC 3339 date-time` });
    } else if (typeof schema.format === 'string' && schema.format !== 'date-time') {
      throw new UnsupportedSchemaKeyword(`format "${schema.format}" is not implemented`);
    }
  }

  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;

    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj) || obj[key] === undefined) {
        out.push({ at: where, message: `missing required property "${key}"` });
      }
    }

    for (const [key, child] of Object.entries(obj)) {
      // A key whose value is `undefined` is NOT a JSON property — JSON.stringify
      // drops it, and this schema is the INTERCHANGE contract, which governs the
      // serialized form. The ledger's row mapper writes `correlation: undefined`
      // for events that have none (ledger.ts rowToEnvelope), and treating that
      // as a present-but-wrongly-typed property would fail every uncorrelated
      // event in the ledger against a schema it actually satisfies.
      if (child === undefined) continue;
      const childPath = at ? `${at}.${key}` : key;
      if (props[key]) {
        walk(child, props[key], childPath, root, out);
        continue;
      }
      const extra = schema.additionalProperties;
      if (extra === false) {
        out.push({ at: where, message: `additional property "${key}" is not allowed` });
      } else if (extra && typeof extra === 'object') {
        walk(child, extra as Schema, childPath, root, out);
      }
      // `additionalProperties` absent or `true` — anything goes.
    }
  }
}
