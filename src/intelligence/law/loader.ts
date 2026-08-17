/**
 * law/ directory loader — markdown + YAML frontmatter → LawDocuments (WP-08).
 *
 * The intake gate of the policy & runbook repo (ADR-5, ADR-17). One rule
 * governs error handling: a malformed document is REJECTED with a recorded
 * error and its siblings still load — the loader never throws. A registry
 * silently built from a half-parsed policy file would be worse than no
 * registry at all, and a loader crash must never reach a caller that
 * predates the intelligence layer.
 *
 * YAML parsing uses js-yaml, the same parser AgentRegistry.ts already uses
 * in production for agent manifests; frontmatter validation uses zod, the
 * core's established validation pattern (envelope/validate.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { canonicalByteLength, canonicalDocumentText, documentHash } from './hash';
import {
  Constraint,
  CONSTRAINT_ORIGINS,
  ENFORCEMENT_CLASSES,
  LawDocument,
  LawLoadError,
  LawLoadResult,
} from './types';

const constraintSchema = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
  enforcement: z.enum(ENFORCEMENT_CLASSES),
  origin: z.enum(CONSTRAINT_ORIGINS),
});

const frontmatterSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['policy', 'runbook']),
    version: z.string().min(1),
    // `scope` means two different things in the two kinds, and only the policy
    // meaning is a string. A policy's scope is the namespace its constraints
    // inherit ('tenant'); a runbook's is where the procedure applies, authored
    // as a structured object — `{ environments: [...] }`, `{ reads, writes }`,
    // `{ sources, destinations, excluded }`. Accept both shapes here and hold
    // policy to the string below (WP-20a: requiring a string rejected all five
    // shipped runbooks, which no test had ever loaded).
    scope: z.union([z.string().min(1), z.record(z.unknown())]).optional(),
    owner: z.string().optional(),
    constraints: z.array(constraintSchema).optional(),
  })
  // ADR-17: runbook frontmatter carries fields this loader does not model
  // (capability, strictness, checkpoints…). Keep them, don't reject them.
  .passthrough();

/** Everything between the leading '---' fence and the next '---' line. */
function splitFrontmatter(raw: string): { frontmatter: string; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return undefined;
  return { frontmatter: match[1], body: match[2] };
}

/** Depth-first, alphabetical — deterministic order makes duplicate-id rejection reproducible. */
function walkMarkdownFiles(root: string, rel = ''): string[] {
  const abs = path.join(root, rel);
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relPath = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walkMarkdownFiles(root, relPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(relPath);
  }
  return out;
}

export function parseLawDocument(relPath: string, raw: string): LawDocument | LawLoadError {
  const split = splitFrontmatter(raw);
  if (!split) {
    return { path: relPath, reason: 'no frontmatter block (expected a leading --- fence)' };
  }

  let data: unknown;
  try {
    data = yaml.load(split.frontmatter);
  } catch (err) {
    return { path: relPath, reason: `invalid YAML frontmatter: ${(err as Error).message}` };
  }

  const parsed = frontmatterSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      path: relPath,
      reason: `invalid frontmatter: ${first.path.join('.') || '(root)'}: ${first.message}`,
    };
  }

  const fm = parsed.data;
  if (fm.kind === 'policy' && fm.scope !== undefined && typeof fm.scope !== 'string') {
    return { path: relPath, reason: 'invalid frontmatter: scope: expected a string for a policy document' };
  }
  // A non-string scope is not a constraint namespace, so the document keeps the
  // default; the authored object stays reachable on `frontmatter`.
  const scope = typeof fm.scope === 'string' ? fm.scope : 'tenant';
  const constraints: Constraint[] = (fm.constraints ?? []).map((c) => ({
    id: c.id,
    // Folded YAML scalars keep their newlines; normalise to single-space so
    // rule text compares stably regardless of source-file wrapping.
    rule: c.rule.replace(/\s+/g, ' ').trim(),
    enforcement: c.enforcement,
    origin: c.origin,
    docId: fm.id,
    docVersion: fm.version,
    scope,
  }));

  return {
    id: fm.id,
    kind: fm.kind,
    version: fm.version,
    scope,
    owner: fm.owner,
    path: relPath,
    constraints,
    body: split.body,
    frontmatter: data as Record<string, unknown>,
    // WP-20a: the loader is the only code that sees the raw bytes, so the pin
    // and its measurement are computed here and travel with the document.
    hash: documentHash(raw),
    canonicalBytes: canonicalByteLength(raw),
    canonicalText: canonicalDocumentText(raw),
  };
}

export function loadLawDirectory(dir: string): LawLoadResult {
  const documents: LawDocument[] = [];
  const errors: LawLoadError[] = [];

  let files: string[];
  try {
    files = walkMarkdownFiles(dir);
  } catch (err) {
    return {
      documents,
      errors: [{ path: '', reason: `cannot read law directory ${dir}: ${(err as Error).message}` }],
    };
  }

  const seenConstraintIds = new Map<string, string>(); // constraint id → doc path that owns it
  const seenDocIds = new Map<string, string>();

  for (const relPath of files) {
    let doc: LawDocument | LawLoadError;
    try {
      doc = parseLawDocument(relPath, fs.readFileSync(path.join(dir, relPath), 'utf-8'));
    } catch (err) {
      doc = { path: relPath, reason: `unreadable: ${(err as Error).message}` };
    }
    if (!('kind' in doc)) {
      errors.push(doc);
      continue;
    }

    const dupDoc = seenDocIds.get(doc.id);
    if (dupDoc) {
      errors.push({ path: relPath, reason: `document id ${doc.id} already used by ${dupDoc}` });
      continue;
    }
    const dupConstraint = doc.constraints.find((c) => seenConstraintIds.has(c.id));
    if (dupConstraint) {
      errors.push({
        path: relPath,
        reason: `constraint id ${dupConstraint.id} already used by ${seenConstraintIds.get(dupConstraint.id)}`,
      });
      continue;
    }

    seenDocIds.set(doc.id, relPath);
    for (const c of doc.constraints) seenConstraintIds.set(c.id, relPath);
    documents.push(doc);
  }

  return { documents, errors };
}
