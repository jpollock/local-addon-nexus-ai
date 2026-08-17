/**
 * RunbookRegistry — the procedure index (WP-20a, ADR-17 + its third amendment).
 *
 * A separate index over the `kind: 'runbook'` documents, not a filter over
 * `ConstraintRegistry`: that one discards `body` and `frontmatter`
 * (`registry.ts:36`), which are exactly what a procedure IS. 20b (grants and
 * arming) and 20c (delivery) read this surface; nothing here delivers, arms,
 * grants or sequences anything.
 *
 * THREE RULES GOVERN EVERY REFUSAL BELOW.
 *
 * 1. **Recorded, never thrown, never silent.** The loader's WP-08 discipline:
 *    a document whose runbook contract cannot be honoured is refused with a
 *    reason, its siblings still load, and the policy set — which shares
 *    `loadLawDirectory` — is untouched. That the runbook rules live HERE rather
 *    than in the shared loader is the structural form of that guarantee.
 * 2. **An undeclared checkpoint is `narrative`.** `attest` is what lets a UI
 *    tell a checkpoint the platform proved from one it merely heard about
 *    (design note §4/§7). Defaulting to any verifiable class would manufacture
 *    a verification claim out of an omission.
 * 3. **The ceiling refuses; it never trims.** §6.2 forbids trimming a
 *    procedure, so declining to load is the only honest answer to one that
 *    would not fit the turn.
 *
 * WHAT THE CEILING MEASURES, and a discrepancy in the governing text that a
 * reader deserves to see rather than discover:
 *
 * The design note calls it a "body ceiling" and then cites, as documents that
 * exceed it, `incident-response.md` (15.8 KB) and `staging-promotion.md`
 * (10.5 KB) — which are FILE sizes. Measured on the tree, those two files'
 * prose bodies are 7,828 and 4,496 bytes: under 8 KB, both of them. Read
 * literally as a body-only rule the ceiling would refuse nothing at all (the
 * largest body among the five is 7.8 KB), and the ruling that those two get
 * split in 20c would have nothing behind it.
 *
 * So the ceiling is measured over the CANONICAL DOCUMENT — frontmatter and body
 * together — which is also what the note's own token arithmetic uses (it prices
 * the anchor runbook's arming turn at 1,215 tokens, i.e. 4,858 bytes / 4, the
 * whole file) and what the delivered payload actually is: for these runbooks the
 * obligations that make a procedure a procedure (checkpoints, aborts,
 * communication) live in the frontmatter, and a ceiling that ignores them
 * measures the smaller half of what rides the turn. This reproduces the ruled
 * outcome exactly — three loaded, `rb.incident-response` and
 * `rb.staging-promotion` refused — and it is the reading recorded in the
 * WP-20a packet notes for ratification.
 *
 * The ceiling applies to `strictness: strict` only, per the note's own
 * qualifier. Consequence, measured and stated so it is not a surprise: the two
 * GUIDED runbooks are 8,967 and 8,359 canonical bytes — both over 8 KB — and
 * both load. Widening the ceiling to guided runbooks would refuse four of five
 * shipped documents, so it is a ruling, not a tidy-up.
 */
import { z } from 'zod';
import {
  ATTEST_CLASSES,
  LawDocument,
  Runbook,
  RunbookArmingPredicate,
  RunbookCheckpoint,
  RunbookEvidence,
  RunbookLoadError,
  RunbookStrictness,
  RunbookTool,
  RUNBOOK_STRICTNESS,
  TOOL_MODES,
  TOOL_SCOPES,
} from './types';

/**
 * 8 KiB ≈ 2k tokens at the assembler's own estimator. Ruled at WP-20 phase 1
 * (escalation 5: "8 KB + split", over 16 KB) — a 16 KB strict runbook rides a
 * turn at 4k tokens, at which point the ceiling stops meaning anything.
 */
export const STRICT_RUNBOOK_CEILING_BYTES = 8 * 1024;

const toolSchema = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      mode: z.enum(TOOL_MODES).optional(),
      no_auto_start: z.boolean().optional(),
    })
    .passthrough(),
]);

const checkpointSchema = z
  .object({
    id: z.string().min(1),
    attest: z.enum(ATTEST_CLASSES).optional(),
    evidence: z
      .object({
        topic: z.string().min(1).optional(),
        tool: z.string().min(1).optional(),
        decision: z.string().min(1).optional(),
        per_target: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    tools: z.array(toolSchema).optional(),
  })
  .passthrough();

const stepSchema = z.object({ id: z.string().min(1) }).passthrough();

/**
 * Only the runbook contract is modelled here; identity (id/kind/version) is the
 * loader's, and everything else passes through onto `frontmatter` — the same
 * house rule ADR-17 gave the loader, for the same reason: a field this packet
 * does not model is not a field it may destroy.
 */
const runbookFrontmatterSchema = z
  .object({
    capability: z.string().min(1),
    strictness: z.enum(RUNBOOK_STRICTNESS),
    checkpoints: z.array(checkpointSchema).optional(),
    steps: z.array(stepSchema).optional(),
    tools: z.array(toolSchema).optional(),
    tool_scope: z.enum(TOOL_SCOPES).optional(),
    arms_on: z
      .object({
        verbs: z.array(z.string().min(1)).min(1),
        subjects: z.array(z.string().min(1)).min(1),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type ParsedTool = z.infer<typeof toolSchema>;

function toRunbookTool(entry: ParsedTool): RunbookTool {
  if (typeof entry === 'string') return { name: entry };
  const tool: RunbookTool = { name: entry.name };
  if (entry.mode !== undefined) tool.mode = entry.mode;
  if (entry.no_auto_start !== undefined) tool.noAutoStart = entry.no_auto_start;
  return tool;
}

function toEvidence(raw: NonNullable<z.infer<typeof checkpointSchema>['evidence']>): RunbookEvidence {
  const evidence: RunbookEvidence = {};
  if (raw.topic !== undefined) evidence.topic = raw.topic;
  if (raw.tool !== undefined) evidence.tool = raw.tool;
  if (raw.decision !== undefined) evidence.decision = raw.decision;
  if (raw.per_target !== undefined) evidence.perTarget = raw.per_target;
  return evidence;
}

export interface RunbookFilter {
  strictness?: RunbookStrictness;
  capability?: string;
}

export class RunbookRegistry {
  private readonly ordered: Runbook[] = [];
  private readonly byIdIndex = new Map<string, Runbook>();
  private readonly byCapabilityIndex = new Map<string, Runbook>();
  private readonly refusals: RunbookLoadError[] = [];

  private constructor() {}

  static build(opts: { documents: LawDocument[] }): RunbookRegistry {
    const reg = new RunbookRegistry();
    for (const doc of opts.documents) {
      // A policy document is not a failed runbook. Skipped, not refused.
      if (doc.kind !== 'runbook') continue;
      reg.admit(doc);
    }
    return reg;
  }

  private refuse(doc: LawDocument, code: RunbookLoadError['code'], reason: string): void {
    this.refusals.push({ path: doc.path, code, runbookId: doc.id, reason });
  }

  private admit(doc: LawDocument): void {
    const parsed = runbookFrontmatterSchema.safeParse(doc.frontmatter);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      this.refuse(
        doc,
        'invalid-frontmatter',
        `invalid runbook contract: ${first.path.join('.') || '(root)'}: ${first.message}`
      );
      return;
    }
    const fm = parsed.data;
    const strictness = fm.strictness;
    const declaredCheckpoints = fm.checkpoints ?? [];

    // ADR-17: a strict runbook is gateway-sequenced, and a sequence needs steps
    // with identity. One without checkpoints cannot be sequenced, so serving it
    // as strict would promise ceremony no code could deliver.
    if (strictness === 'strict' && declaredCheckpoints.length === 0) {
      this.refuse(doc, 'invalid-frontmatter', 'a strict runbook must enumerate ordered checkpoints (ADR-17)');
      return;
    }
    // The word is reserved (ADR-17 amendment 2): guided runbooks enumerate
    // steps. A guided runbook carrying checkpoints would read to the sequencer
    // as sequenceable when the actor is licensed to adapt.
    if (strictness === 'guided' && declaredCheckpoints.length > 0) {
      this.refuse(
        doc,
        'invalid-frontmatter',
        'a guided runbook must enumerate steps, not checkpoints — "checkpoint" is reserved for gateway-sequenced strict execution (ADR-17)'
      );
      return;
    }

    const checkpoints: RunbookCheckpoint[] = [];
    for (const raw of declaredCheckpoints) {
      if (checkpoints.some((c) => c.id === raw.id)) {
        this.refuse(doc, 'invalid-frontmatter', `duplicate checkpoint id ${raw.id} — sequencing needs step identity`);
        return;
      }
      // Rule 2: the default is narrative. Never anything a UI may tick.
      const attest = raw.attest ?? 'narrative';
      const evidence = raw.evidence ? toEvidence(raw.evidence) : undefined;
      // An event-attested checkpoint with nothing to look for is a verification
      // claim with no query behind it — the exact shape that renders a green
      // tick over an unchecked step.
      if (attest === 'event' && !evidence?.topic) {
        this.refuse(
          doc,
          'invalid-frontmatter',
          `checkpoint ${raw.id} declares attest: event but names no evidence topic — an event attestation needs a ledger topic to verify against`
        );
        return;
      }
      checkpoints.push({
        id: raw.id,
        attest,
        ...(evidence ? { evidence } : {}),
        tools: (raw.tools ?? []).map(toRunbookTool),
      });
    }

    if (strictness === 'strict' && doc.canonicalBytes > STRICT_RUNBOOK_CEILING_BYTES) {
      this.refuse(
        doc,
        'over-ceiling',
        `strict runbook is ${doc.canonicalBytes} bytes, over the ${STRICT_RUNBOOK_CEILING_BYTES}-byte ceiling for strict runbooks. ` +
          'A procedure is never delivered in part, so this one is refused rather than shortened: ' +
          'split it into runbooks that each fit the ceiling, each with its own capability and grant.'
      );
      return;
    }

    const holder = this.byCapabilityIndex.get(fm.capability);
    if (holder) {
      // Load order is deterministic (the loader walks depth-first,
      // alphabetically), so first-wins is reproducible rather than a coin toss —
      // the same discipline the loader applies to a duplicate constraint id.
      this.refuse(
        doc,
        'duplicate-capability',
        `capability ${fm.capability} is already served by ${holder.id} (${holder.path})`
      );
      return;
    }

    const armsOn: RunbookArmingPredicate | undefined = fm.arms_on
      ? { verbs: [...fm.arms_on.verbs], subjects: [...fm.arms_on.subjects] }
      : undefined;

    const runbook: Runbook = {
      id: doc.id,
      version: doc.version,
      capability: fm.capability,
      strictness,
      path: doc.path,
      hash: doc.hash,
      canonicalBytes: doc.canonicalBytes,
      checkpoints,
      steps: (fm.steps ?? []).map((s) => s.id),
      tools: (fm.tools ?? []).map(toRunbookTool),
      toolScope: fm.tool_scope ?? 'advisory',
      ...(armsOn ? { armsOn } : {}),
      body: doc.body,
      frontmatter: doc.frontmatter,
    };

    this.ordered.push(runbook);
    this.byIdIndex.set(runbook.id, runbook);
    this.byCapabilityIndex.set(runbook.capability, runbook);
  }

  byId(id: string): Runbook | undefined {
    return this.byIdIndex.get(id);
  }

  byCapability(capability: string): Runbook | undefined {
    return this.byCapabilityIndex.get(capability);
  }

  runbooks(filter?: RunbookFilter): Runbook[] {
    return this.ordered.filter(
      (r) =>
        (!filter?.strictness || r.strictness === filter.strictness) &&
        (!filter?.capability || r.capability === filter.capability)
    );
  }

  /** Runbooks that loaded as documents but were refused as procedures. Never empty silently. */
  errors(): RunbookLoadError[] {
    return [...this.refusals];
  }
}
