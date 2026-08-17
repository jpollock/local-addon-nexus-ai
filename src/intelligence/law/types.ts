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
  /**
   * `sha256:<hex>` over the document's canonical text — the value a capability
   * grant pins (WP-20a). See `law/hash.ts` for the exact input; it is the WHOLE
   * document, not the body, with line endings normalised.
   */
  hash: string;
  /** Byte length of that same canonical text. The runbook ceiling measures this. */
  canonicalBytes: number;
}

/* ------------------------------------------------------------------ *
 * The runbook contract (ADR-17 + its third amendment, WP-20a).
 * ------------------------------------------------------------------ */

export const RUNBOOK_STRICTNESS = ['strict', 'guided'] as const;
/** strict = gateway-sequenced checkpoints; guided = ordered advice the actor may adapt. */
export type RunbookStrictness = (typeof RUNBOOK_STRICTNESS)[number];

export const ATTEST_CLASSES = ['event', 'manifest', 'narrative'] as const;
/**
 * How a checkpoint can be shown to have happened (design note §4/P4):
 *
 * - `event`    — a ledger event attests it. The strongest, and the only class a
 *                UI may render as verified.
 * - `manifest` — the assembler's own bundle manifest attests the SUPPLY side
 *                (e.g. the episodic retrieval it ran). Whether the actor read
 *                it is not attested.
 * - `narrative` — the platform only heard about it. **The default for any
 *                checkpoint that does not declare otherwise**, because the
 *                alternative is a verification claim manufactured by a default.
 */
export type AttestClass = (typeof ATTEST_CLASSES)[number];

export const TOOL_SCOPES = ['advisory', 'exclusive'] as const;
/**
 * `advisory` (default) — the declared tools are DISCLOSURE: the procedure names
 * what it expects, and nothing is hidden from the actor. `exclusive` ships as a
 * declared mechanism only in v0; narrowing the tool surface is a separate,
 * measured behaviour change (design note §5).
 */
export type ToolScope = (typeof TOOL_SCOPES)[number];

export const TOOL_MODES = ['live', 'cache'] as const;
/** The cache/live obligation a runbook can attach to a tool. Carried as text in v0, not enforced. */
export type ToolMode = (typeof TOOL_MODES)[number];

/** One entry of a runbook's declared tool surface. Authored as a bare name or an object. */
export interface RunbookTool {
  name: string;
  /** Declared obligation to read live rather than from cache. Not enforced in v0. */
  mode?: ToolMode;
  /**
   * The lifecycle constraint ADR-17's third amendment names: this tool must not
   * be reached by a path that starts a halted site. Not enforced in v0; 20b owns
   * the enforcement, and the platform's own auto-start is the reason the field
   * exists (design note §5).
   */
  noAutoStart?: boolean;
}

/** What would attest an `event`-class checkpoint, as a ledger selector. */
export interface RunbookEvidence {
  /** Event topic, e.g. 'task.rationale.recorded'. Required when attest is 'event'. */
  topic?: string;
  /** The tool whose execution attests it, e.g. 'wpe_backup_and_verify'. */
  tool?: string;
  /** For approval-shaped evidence: which decision counts. */
  decision?: string;
  /** True when one outcome per resolved target is expected. */
  perTarget?: boolean;
}

export interface RunbookCheckpoint {
  /** Stable id (ADR-17): gateway attestation needs step identity. Unique within the runbook. */
  id: string;
  attest: AttestClass;
  evidence?: RunbookEvidence;
  /** Tools this checkpoint expects; empty when the runbook declares none for it. */
  tools: RunbookTool[];
}

/** The lexical arming predicate 20b evaluates over the user's turn text (design note §1, path A). */
export interface RunbookArmingPredicate {
  verbs: string[];
  subjects: string[];
}

export interface Runbook {
  id: string;
  version: string;
  /** The capability a grant names, e.g. 'cap.bulk_plugin_update'. */
  capability: string;
  strictness: RunbookStrictness;
  /** Path relative to the law directory root. */
  path: string;
  /** The pin a grant carries — see LawDocument.hash. */
  hash: string;
  /** Canonical byte length; for strict runbooks this is what the ceiling refused or admitted. */
  canonicalBytes: number;
  /** Ordered, ids unique. Strict runbooks only; guided runbooks carry none. */
  checkpoints: RunbookCheckpoint[];
  /** Ordered step ids. Guided runbooks enumerate these instead of checkpoints. */
  steps: string[];
  /** Document-level declared tool surface. */
  tools: RunbookTool[];
  toolScope: ToolScope;
  armsOn?: RunbookArmingPredicate;
  /** Markdown prose after the frontmatter block — the procedure a turn carries. */
  body: string;
  /** The raw frontmatter, kept for fields no packet models yet. */
  frontmatter: Record<string, unknown>;
}

export const RUNBOOK_REFUSAL_CODES = ['invalid-frontmatter', 'over-ceiling', 'duplicate-capability'] as const;
export type RunbookRefusalCode = (typeof RUNBOOK_REFUSAL_CODES)[number];

/**
 * A runbook the registry declined to serve. Deliberately NOT folded into the
 * loader's `LawLoadError` list: the loader's errors mean "this file is not a law
 * document at all", while these mean "this document loaded, and its runbook
 * contract cannot be honoured". Conflating them would make a refused runbook
 * look like a corrupt policy file.
 */
export interface RunbookLoadError extends LawLoadError {
  code: RunbookRefusalCode;
  /** The runbook's declared id, when it got far enough to have one. */
  runbookId?: string;
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
