/**
 * The policy & runbook repo, in memory (WP-08, ADR-5/ADR-17).
 *
 * A LawDocument is one markdown file with YAML frontmatter; policy documents
 * carry constraints, runbooks carry procedure (frontmatter kept raw for the
 * ADR-17 fields WP-09 will author). Constraints are the unit the future
 * assembler (WP-11) consumes.
 */

export const ENFORCEMENT_CLASSES = ['gateway', 'ambient'] as const;
/** gateway = checked in code at the tool layer; ambient = ships in context bundles, eval-tested. */
export type Enforcement = (typeof ENFORCEMENT_CLASSES)[number];

export const CONSTRAINT_ORIGINS = ['expertise', 'intent', 'regulation'] as const;
/** Who has authority to change the constraint (ops-default.md: operators / clients / nobody). */
export type ConstraintOrigin = (typeof CONSTRAINT_ORIGINS)[number];

export interface Constraint {
  /** Stable id, e.g. 'c.production-writes-off'. Unique across the whole registry. */
  id: string;
  /** Human-reviewed rule text. */
  rule: string;
  enforcement: Enforcement;
  origin: ConstraintOrigin;
  /** Owning document. */
  docId: string;
  docVersion: string;
  scope: string;
  /**
   * Present on mirrored constraints only: names the live settings surface the
   * constraint was generated from (v0: 'wpeOperationPermissions'). The
   * settings remain authoritative; the registry observes.
   */
  derivedFrom?: string;
  /** Mirrored live values for derived constraints (the divergence-check surface). */
  parameters?: Record<string, unknown>;
}

export interface LawDocument {
  id: string;
  kind: 'policy' | 'runbook';
  version: string;
  scope: string;
  owner?: string;
  /** Path relative to the law directory root. */
  path: string;
  constraints: Constraint[];
  /** Markdown prose after the frontmatter block. */
  body: string;
  /** The raw frontmatter, for fields the loader does not model (ADR-17 runbook contract). */
  frontmatter: Record<string, unknown>;
}

export interface LawLoadError {
  /** Path relative to the law directory root ('' when the directory itself is the problem). */
  path: string;
  reason: string;
}

export interface LawLoadResult {
  documents: LawDocument[];
  errors: LawLoadError[];
}
