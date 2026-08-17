/**
 * WP-13 · Eval spec loader — YAML eval specs → EvalSpec.
 *
 * House style is WP-08's law loader (`src/intelligence/law/loader.ts`), and the
 * rules are copied deliberately rather than reinvented:
 *
 *  - js-yaml for parsing, zod for validation (the pair already used in
 *    production for agent manifests and envelope validation).
 *  - A malformed spec is REJECTED with a recorded reason and its siblings
 *    still load. The loader NEVER throws: a harness that dies on one bad file
 *    reports nothing about the good ones, which is strictly worse than
 *    reporting one rejection.
 *  - Duplicate ids are rejected, in deterministic (alphabetical) file order,
 *    so which one loses is reproducible.
 *  - `.passthrough()`: the dialect carries fields this runner does not model
 *    (suite/moment/tier/stakes/alternate_prompts…). Keep them, don't reject.
 *
 * The one deviation from the law loader: these files are pure YAML, not
 * markdown-with-frontmatter, so there is no fence to split.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { Criterion, EvalSpec, SpecLoadError, SpecLoadResult } from './types';

const specSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    mode: z.array(z.string()).min(1),
    prompt: z.string().optional(),
    expected: z.object({
      task_completed: z.boolean().optional(),
      key_steps: z.array(z.string().min(1)),
      must_not: z.array(z.string().min(1)),
    }),
    scoring_weights: z.record(z.number()).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export function parseEvalSpec(relPath: string, raw: string): EvalSpec | SpecLoadError {
  let data: unknown;
  try {
    data = yaml.load(raw);
  } catch (err) {
    return { path: relPath, reason: `invalid YAML: ${(err as Error).message}` };
  }
  if (data === null || typeof data !== 'object') {
    return { path: relPath, reason: 'not a YAML mapping' };
  }

  const parsed = specSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      path: relPath,
      reason: `invalid spec: ${first.path.join('.') || '(root)'}: ${first.message}`,
    };
  }

  return { ...(parsed.data as unknown as EvalSpec), path: relPath };
}

export function loadEvalSpecs(dir: string): SpecLoadResult {
  const specs: EvalSpec[] = [];
  const errors: SpecLoadError[] = [];

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    return {
      specs,
      errors: [{ path: '', reason: `cannot read evals directory ${dir}: ${(err as Error).message}` }],
    };
  }

  const seen = new Map<string, string>(); // spec id → path that owns it
  for (const rel of files) {
    let spec: EvalSpec | SpecLoadError;
    try {
      spec = parseEvalSpec(rel, fs.readFileSync(path.join(dir, rel), 'utf-8'));
    } catch (err) {
      spec = { path: rel, reason: `unreadable: ${(err as Error).message}` };
    }
    if (!('expected' in spec)) {
      errors.push(spec);
      continue;
    }
    const dup = seen.get(spec.id);
    if (dup) {
      errors.push({ path: rel, reason: `spec id ${spec.id} already used by ${dup}` });
      continue;
    }
    seen.set(spec.id, rel);
    specs.push(spec);
  }

  return { specs, errors };
}

/**
 * Flatten a spec's `expected` block into addressable criteria.
 *
 * Both halves are criteria: a `must_not` is an obligation exactly as much as a
 * `key_step` is, and scoring only the positive half is how "it did the right
 * things AND also started the halted site" reads as a pass.
 */
export function criteriaOf(spec: EvalSpec): Criterion[] {
  const out: Criterion[] = [];
  spec.expected.key_steps.forEach((text, index) =>
    out.push({ id: `${spec.id}#key_step[${index}]`, specId: spec.id, kind: 'key_step', index, text })
  );
  spec.expected.must_not.forEach((text, index) =>
    out.push({ id: `${spec.id}#must_not[${index}]`, specId: spec.id, kind: 'must_not', index, text })
  );
  return out;
}
