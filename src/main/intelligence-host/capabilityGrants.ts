/**
 * WP-20b · Capability grants — the host side of P2, and the first producer of
 * `control.grant.issued` / `control.grant.revoked` anywhere in the tree.
 *
 * A grant says: *this capability is served by this reviewed document, pinned by
 * its hash.*
 *
 * WP-20f · THE DENY-FLIP (ruled 2026-08-18). WP-20b derived the live set from
 * the documents on disk: every STRICT runbook the registry served got an
 * enabled grant, and nothing was written anywhere to make that true. **That
 * code path is GONE.** Not filtered, not carved out — deleted. A grant now has
 * exactly two origins, and both of them are explicit acts someone performed:
 *
 *   1. **The materialized set** (`intelligence_grants_materialized`). Written
 *      ONCE, by the migration below, at the boot where the flip lands. It is a
 *      list of capability names — not a derivation, not a rule — and nothing
 *      ever appends to it afterwards.
 *   2. **The settings overlay** (`NexusSettings.capabilityGrants`). Switch one
 *      off, pin one to the document you reviewed, name one the materialized set
 *      does not cover. Only `capability` is required.
 *
 * WHY DELETING LAYER 1 IS THE POINT, and not merely a way to reach it. Ruling
 * point 3 — "new capabilities arrive DENIED; registering a capability and
 * enabling it are two different acts" — is obtained STRUCTURALLY this way: no
 * capability is ever granted because a document exists, so a strict runbook
 * that ships tomorrow has no path to a default. A filter over a surviving
 * derivation would have been a rule that some later default could out-vote.
 * The signature is the proof: `resolveCapabilityGrants` with no `materialized`
 * list returns NO grants, on a tree whose `law/` directory is full.
 *
 * WHY TWO CAPABILITIES ARE HARDER STILL. `cap.promote_environment` and
 * `cap.incident_remediation` are MANDATED-EXPLICIT (ruling point 1): the
 * migration never materializes them, and the materialized path refuses them
 * even if the stored list names one. Production consequence is never a default.
 * They remain fully grantable — by an explicit settings entry, which is the
 * ruling's own "a run needs an explicit grant made before it arms" — and a
 * served-but-ungranted one is DISCLOSED as `requires-explicit-grant` rather
 * than being quietly absent, so the row a user can act on exists.
 *
 * WHAT WAS AND WAS NOT FLIPPED. v0 grants are still ADDITIVE over the TOOL
 * SURFACE: holding a grant adds a procedure and WP-20d's sequencing; not
 * holding one leaves today's tool reach untouched. So denying these two
 * subtracts ceremony, it does not subtract reach — until "capability required
 * to reach gated tools" lands (WP-20g). Their production consequence rests
 * meanwhile on `isOperationAllowed`, which is a real gate and a different one.
 * Recorded here rather than left for a reader to discover.
 *
 * WHY STRICT ONLY, in what the migration materializes. A strict runbook has a
 * mandatory full-body ride: the turn carrier must deliver the whole hash-pinned
 * document before the run may proceed, which is what the ceiling bounds. Guided
 * runbooks have no such obligation (WP-20a ruling 2), and both shipped ones are
 * over 8 KB as whole documents — materializing them would hand a later delivery
 * path a payload the ceiling was written to prevent. An explicit settings grant
 * for a guided capability is still honoured: the rule is a default, not a ban.
 *
 * WHAT A DISARMED GRANT IS. Not an error and never a throw: a grant whose
 * pinned hash no longer matches the shipped file, whose runbook is not served,
 * or which the user switched off is reported as disarmed WITH ITS REASON, and
 * the capability behaves as though it were never granted. §6(b) is the sharp
 * one — a hash mismatch is INTEGRITY, not staleness, so it refuses on both
 * actor classes rather than warning and proceeding: the document on disk is not
 * the document that was reviewed.
 *
 * NON-FATAL BY CONSTRUCTION, like everything on this seam. No core, no law
 * registry, a throwing emitter, unreadable storage — each degrades to "no
 * grants" and none of them reaches the caller.
 */
import { Runbook, RunbookRegistry, RunbookStrictness } from '../../intelligence';
import type { IntelligenceCore } from './bootstrap';
import { STORAGE_KEYS } from '../../common/constants';
import type { CapabilityGrantSetting, NexusSettings } from '../../common/types';

/** Topics — architecture doc §4.2's `control.*` family, first producer here. */
export const GRANT_ISSUED_TOPIC = 'control.grant.issued';
export const GRANT_REVOKED_TOPIC = 'control.grant.revoked';

// /2 since the agent-addressing flip: payloads carry `grantee` (absent only
// on the flip's own revocations of v1 platform-wide grants).
export const GRANT_ISSUED_SCHEMA = 'grant.issued/2';
export const GRANT_REVOKED_SCHEMA = 'grant.revoked/2';

/**
 * WP-45 · WHY AN ISSUANCE HAPPENED, in a closed vocabulary.
 *
 * The WP-44 gate found the producer stamping `materialized` on EVERY first
 * issuance — including one a person makes at the Govern control. A
 * `control.grant.issued` that says `materialized` about a human act
 * misdescribes that act in the compliance record, which is the one thing this
 * event exists to get right.
 *
 *  - `materialized`       — WP-20f's migration converted a WP-20b derivation
 *                           into an explicit list. Nobody chose it that day;
 *                           the word says so.
 *  - `granted-at-control` — a person granted it, at the Govern matrix.
 *  - `law-review re-pin`  — a ratified law review re-issued it at the document's
 *                           new hash (see `LAW_REVIEW_REPIN`).
 *  - `repinned`           — the document under a grant changed and the grant
 *                           followed it MECHANICALLY, with no review behind the
 *                           move. Deliberately NOT in the ratified three: it is
 *                           what the producer says when it has nothing better to
 *                           say, and telling it apart from a reviewed re-pin is
 *                           the whole point of the vocabulary.
 */
export const GRANT_ISSUE_REASONS = [
  'materialized',
  'granted-at-control',
  'law-review re-pin',
  'repinned',
] as const;
export type GrantIssueReason = (typeof GRANT_ISSUE_REASONS)[number];

/**
 * WP-45 · P4's RE-PIN — the law review, as a table the producer can apply.
 *
 * The attestation law review changed four documents, two of which carry live
 * grants. P4's promise is that **no grant silently survives a hash change and
 * none silently dies of one**, so the review re-issues those two at their new
 * hashes with a reason that names the review.
 *
 * PINNED FROM-AND-TO, NEVER "follow the document". Each row is one transition
 * between two exact hashes: the text the review READ, and the text it PRODUCED.
 * A grant pinned to any other hash is not covered — that grant was made against
 * text this review never read, and it disarms as `hash-mismatch` exactly as it
 * would have without this table. This is what keeps the row from generalising
 * into "a grant follows its runbook", which is the rule WP-20c's split ruling
 * exists to forbid.
 *
 * IDEMPOTENT ACROSS RESTARTS BY CONSTRUCTION, with no marker of its own. Once
 * the transition has been applied the grant's recorded hash IS `to`, so `from`
 * no longer matches and the row can never fire twice. That is strictly stronger
 * than a stored flag, which can be lost — and it adds no storage key, so the
 * protected `intelligence_grants_*` namespace is untouched.
 *
 * MEASURED, NOT ASSUMED. The review note proposed that a version bump would
 * DISARM both grants via the stale-pin rule. Driven as a test
 * (`lawReviewRePin.test.ts`), that is true only of a grant carrying an explicit
 * hash — the shape the Govern control writes. A purely MATERIALIZED grant
 * carries no hash pin, so it silently re-pins itself and stays granted. Both
 * paths are covered here: the re-pin names the act in the first case, and
 * restores the grant in the second.
 */
export interface LawReviewRePin {
  capability: string;
  runbookId: string;
  /** The hash the review read. */
  from: string;
  /** The hash the review produced. */
  to: string;
}

export const LAW_REVIEW_REPIN: readonly LawReviewRePin[] = [
  {
    capability: 'cap.incident_containment',
    runbookId: 'rb.incident-containment',
    from: 'sha256:fedec1dfb1a6b1e43ac978d356c3e75aad48be9b44ed05aca2f0e4f0b3e689df',
    to: 'sha256:d1c8740a3dd5e363300dd523cf80ea072d8b6ae1c56683e83d50309410558976',
  },
  {
    capability: 'cap.promotion_preflight',
    runbookId: 'rb.promotion-preflight',
    from: 'sha256:ae5a1678d2471c58d21a0c11f532245accb5e1511923113d694adff3673f3a86',
    to: 'sha256:4913c8b5ce94fc33d091efeb8d68cc8f395181cd6cbba54af60e2dcd8260801e',
  },
];

/** The re-pin row governing this exact transition, or nothing. */
export function lawReviewRePinFor(
  capability: string,
  fromHash: string | undefined,
  toHash: string
): LawReviewRePin | undefined {
  return LAW_REVIEW_REPIN.find(
    (r) => r.capability === capability && r.from === fromHash && r.to === toHash
  );
}

/**
 * The storage marker (pre-approved at the WP-20 phase-1 ruling, and listed in
 * CLAUDE.md's protected set as `intelligence_grants_*`). OWNED BY THIS MODULE:
 * nothing else reads or writes it.
 *
 * It holds what was last ISSUED, not what is currently configured — that is the
 * difference that makes the ledger record change rather than repetition, and it
 * is what gives a revocation an event to chain its causation to.
 */
export const GRANTS_STORAGE_KEY = 'intelligence_grants_state';

/**
 * WP-20f · the materialized grant set — the second marker in the pre-approved
 * `intelligence_grants_*` namespace, ruled at the WP-20f gate (option (a)).
 *
 * SEPARATE FROM `GRANTS_STORAGE_KEY` ON PURPOSE, and the separation is
 * load-bearing rather than tidy. That one holds what was last ISSUED; a stale
 * entry in it MEANS "revoke this". Folding the grant set into it would make one
 * entry mean both "this is granted" and "revoke this", and nothing would ever
 * be revoked again. Two facts, two records.
 *
 * OWNED BY THIS MODULE: nothing else reads or writes it.
 */
export const MATERIALIZED_STORAGE_KEY = 'intelligence_grants_materialized';

/**
 * WP-20f ruling point 1 · the capabilities that are NEVER granted by default.
 *
 * There is no legacy carve-out and no bypass: the migration does not write
 * them, and the materialized path refuses them even when the stored list names
 * one (which only tampering or a hand-edited marker can produce). The single
 * path to either is an explicit `NexusSettings.capabilityGrants` entry — a
 * grant a person made, which is exactly what the ruling asks for.
 *
 * Exported so the guard test can assert over the LIST rather than over two
 * string literals it re-types: a third mandated capability added here is
 * covered by the same pins, and a deletion from here fails them.
 */
export const MANDATED_EXPLICIT_CAPABILITIES: readonly string[] = [
  'cap.promote_environment',
  'cap.incident_remediation',
];

const MANDATED = new Set(MANDATED_EXPLICIT_CAPABILITIES);

/** Is this capability one the platform may never grant on its own? */
export function requiresExplicitGrant(capability: string): boolean {
  return MANDATED.has(capability);
}

/**
 * The grantee classes (fixes-082526, agent-addressed grants). Agents are
 * addressed by their own ids; these two are the built-in interactive
 * surfaces. BUILTINS is the materialization target — and agents are
 * DELIBERATELY not in it: bootstrap's first sync runs before agent
 * discovery, and under the fail-closed ruling an agent auto-receiving
 * grants at discovery would be looser than what upgrading machines get
 * (explicit re-grants). An agent holds only what a human granted it. Ever.
 */
export const CHAT_GRANTEE = 'chat';
export const MCP_CLIENT_GRANTEE = 'mcp-client';
export const BUILTIN_GRANTEES: readonly string[] = [CHAT_GRANTEE, MCP_CLIENT_GRANTEE];

/** `source.system` for both topics — one value, so a liveness reader sees one row. */
export const GRANTS_SYSTEM = 'law:capability-grants';
/** A user turning a grant off is a different source: their intent, not the shipped law's. */
export const GRANTS_SETTINGS_SYSTEM = 'settings:capability-grants';

/** The actor for a grant the platform materialized from shipped law. */
export const GRANT_MATERIALIZER_ACTOR = 'act_grant_materializer';

/** A live grant, fully resolved against the documents actually present. */
export interface ResolvedGrant {
  /** WHO holds it: an agent id, 'chat', or 'mcp-client'. The grant unit is (grantee, capability). */
  grantee: string;
  capability: string;
  runbookId: string;
  /** `sha256:…` over the canonical document — the pin, from the registry, never recomputed here. */
  runbookHash: string;
  strictness: RunbookStrictness;
  /** The runbook's own scope tokens, or the overriding ones from settings. Verbatim either way. */
  scope: { environments?: string[]; targetRefs?: string[] };
  /** Which layer put this grant in the live set. */
  source: 'shipped' | 'settings';
}

export type DisarmReason =
  | 'disabled-by-settings'
  | 'hash-mismatch'
  | 'runbook-unavailable'
  /**
   * WP-20f · a MANDATED-EXPLICIT capability that no explicit grant covers.
   *
   * The one data-shape widening this packet makes, and point 1 is not honestly
   * recordable without it. On a machine upgrading across the flip, the two
   * mandated capabilities are in the issuance marker and are about to be
   * revoked; every existing reason would have misdescribed why. Without this
   * value the revocation would read `runbook-unavailable` — a plain falsehood
   * in the compliance record, since the runbook is right there and serving.
   *
   * It also gives the Settings matrix the honest row: not-granted WITH the
   * reason, rather than an absence a reader has to infer.
   */
  | 'requires-explicit-grant'
  /**
   * fixes-082526 · the agent-addressing flip. A grant (or legacy settings
   * entry) with no grantee grants NOBODY — the fail-closed ruling — and this
   * reason says so where a person can act. Distinct from
   * `requires-explicit-grant` so the two flips stay tellable-apart in every
   * surface that renders reasons.
   */
  | 'requires-agent-grant';

/** A grant that was configured and is NOT live, with the reason a user can act on. */
export interface DisarmedGrant {
  /** Absent = no grantee holds this capability at all (the disclosure rows). */
  grantee?: string;
  capability: string;
  runbookId?: string;
  reason: DisarmReason;
  /** Both hashes on a mismatch; the names on an unavailable runbook. A remedy needs the values. */
  detail?: string;
}

export interface GrantResolution {
  grants: ResolvedGrant[];
  disarmed: DisarmedGrant[];
}

interface MarkerEntry {
  /** v2: who holds it. Entries read from a v1 marker have none — the flip revokes them. */
  grantee: string;
  capability: string;
  runbookId: string;
  runbookHash: string;
  /** The `control.grant.issued` event this grant was announced by — a revocation chains to it. */
  eventId: string;
  issuedAt: string;
}

interface MarkerState {
  version: 2;
  grants: MarkerEntry[];
}

/** A v1 marker entry, as the flip reads it: platform-wide, no grantee. */
interface MarkerEntryV1 {
  capability: string;
  runbookId: string;
  runbookHash: string;
  eventId: string;
  issuedAt: string;
}

/** WP-20f · what the migration wrote, and the only thing that grants by default. v2: per grantee. */
interface MaterializedState {
  version: 2;
  /** When the flip landed on this machine. Recorded for the reader, never gated on. */
  migratedAt: string;
  grants: Array<{ grantee: string; capability: string }>;
}

interface MinimalStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

interface MinimalLogger {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

/**
 * The live set, for consumers wired long after startup (WP-20c's delivery,
 * WP-20d's sequencer, and any surface that renders what is granted). Same
 * documented shortcut as `coreRegistry`, and the same contract: it is empty
 * until a sync has run, and empty is a legitimate answer.
 */
let liveGrants: ResolvedGrant[] = [];
let liveDisarmed: DisarmedGrant[] = [];

export function getCapabilityGrants(): ResolvedGrant[] {
  return liveGrants;
}

/** Grants that were configured and are not live, with their reasons. Rendered, never swallowed. */
export function getDisarmedCapabilityGrants(): DisarmedGrant[] {
  return liveDisarmed;
}

/**
 * The join arming reads: the documents behind the live grants.
 *
 * Never the whole registry — arming a procedure nobody granted would deliver
 * ceremony from a document no one reviewed into a run no one authorised.
 */
export function grantedRunbooks(runbooks: RunbookRegistry, grants: ResolvedGrant[]): Runbook[] {
  const out: Runbook[] = [];
  const seen = new Set<string>();
  for (const grant of grants) {
    // One document per capability however many grantees hold it — this feeds
    // arming/assembly, where the unit is the document, not the holder.
    if (seen.has(grant.capability)) continue;
    seen.add(grant.capability);
    const rb = runbooks.byCapability(grant.capability);
    // The hash is re-checked here as well as at resolution: this function is
    // what the gate and the assembler read, and a grant must never hand over a
    // document other than the one it pins.
    if (rb && rb.id === grant.runbookId && rb.hash === grant.runbookHash) out.push(rb);
  }
  return out;
}

/** The scope a grant carries when settings do not override it: the runbook's own, verbatim. */
function scopeFromRunbook(rb: Runbook): ResolvedGrant['scope'] {
  const raw = (rb.frontmatter as { scope?: unknown }).scope;
  if (!raw || typeof raw !== 'object') return {};
  const declared = (raw as { environments?: unknown }).environments;
  // Only `environments` is modelled, and only when it is authored as a list of
  // strings. Three of the five shipped runbooks declare it; the other two
  // declare `reads`/`writes` and `sources`/`destinations`/`excluded` (WP-20a
  // finding 5). Mapping those onto an environment list would be a guess, so a
  // runbook with a different scope vocabulary carries no environments at all —
  // absent, not wrong. Nothing gates on scope in v0.
  if (!Array.isArray(declared) || !declared.every((e) => typeof e === 'string')) return {};
  return { environments: [...(declared as string[])] };
}

/**
 * The capabilities a migration materializes: the strict runbooks the registry
 * SERVES, minus the mandated-explicit ones.
 *
 * Exported because the migration and every test that needs to stand on a
 * migrated machine must derive this the same way. A test that hand-built the
 * list would pass while the rule it is standing on changed underneath it.
 *
 * Note what it is NOT: it is not consulted at resolution. It runs once, its
 * output is persisted, and the persisted list is what grants thereafter — which
 * is the whole of ruling point 3.
 */
export function materializableCapabilities(runbooks: RunbookRegistry): string[] {
  return runbooks
    .runbooks({ strictness: 'strict' })
    .map((rb) => rb.capability)
    .filter((capability) => !MANDATED.has(capability));
}

/**
 * Resolve the configured grants against the documents actually present.
 *
 * Pure: no emission, no storage, no clock. `syncCapabilityGrants` is the side
 * effect, so this can be read by anything that only wants to know what is live.
 *
 * WP-20f · `materialized` HAS NO DEFAULT THAT GRANTS ANYTHING. Omit it and the
 * result is the settings overlay alone, on a tree whose `law/` is full. That is
 * the deny-flip expressed in the signature rather than in a rule: there is no
 * argument to this function that makes a document grant itself.
 */
export function resolveCapabilityGrants(opts: {
  runbooks: RunbookRegistry;
  settings?: Pick<NexusSettings, 'capabilityGrants'> | null;
  /** The persisted, explicit grant set — (grantee, capability) pairs. Absent = nothing is granted but settings. */
  materialized?: readonly { grantee: string; capability: string }[];
}): GrantResolution {
  const { runbooks } = opts;
  // Keyed (grantee, capability) — the grant unit since the agent-addressing
  // flip. A LEGACY entry with no grantee grants NOBODY (fail-closed ruling)
  // and is disclosed below rather than silently widened to everyone.
  const overrides = new Map<string, CapabilityGrantSetting & { grantee: string }>();
  const legacyEntries: CapabilityGrantSetting[] = [];
  for (const entry of opts.settings?.capabilityGrants ?? []) {
    if (!entry || typeof entry.capability !== 'string' || !entry.capability) continue;
    if (typeof entry.grantee === 'string' && entry.grantee) {
      overrides.set(`${entry.grantee}|${entry.capability}`, entry as CapabilityGrantSetting & { grantee: string });
    } else {
      legacyEntries.push(entry);
    }
  }

  const grants: ResolvedGrant[] = [];
  const disarmed: DisarmedGrant[] = [];

  // Layer 1: the materialized set — (grantee, capability) pairs an explicit,
  // recorded act granted. Deduped, because a marker is storage and storage
  // can repeat.
  const seenPairs = new Set<string>();
  for (const pair of opts.materialized ?? []) {
    if (!pair || typeof pair.grantee !== 'string' || typeof pair.capability !== 'string') continue;
    const key = `${pair.grantee}|${pair.capability}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    // Ruling point 1, enforced HERE and not only at the migration. The
    // migration is what should never write these; this is what makes it
    // impossible for a hand-edited or tampered marker to grant one anyway.
    // Two independent refusals, because a single one is a bypass waiting for a
    // bug — and the guard test drives exactly this case.
    if (MANDATED.has(pair.capability)) continue;
    const rb = runbooks.byCapability(pair.capability);
    if (!rb) {
      // Materialized once, and the document has since gone (removed, renamed,
      // or refused by the ceiling). Disclosed, never silently dropped.
      disarmed.push({
        grantee: pair.grantee,
        capability: pair.capability,
        reason: 'runbook-unavailable',
        detail: `no loaded runbook serves ${pair.capability}`,
      });
      continue;
    }
    admit(pair.grantee, rb, 'shipped', overrides.get(key));
    overrides.delete(key);
  }

  // Layer 2: whatever settings name that the materialized set did not cover.
  for (const [, entry] of overrides) {
    const rb = runbooks.byCapability(entry.capability);
    if (!rb) {
      // The runbook may be absent, or refused by the registry (over the
      // ceiling, unhonourable contract). Either way the capability cannot be
      // served, and saying so is §6(a)'s disclosure obligation.
      disarmed.push({
        grantee: entry.grantee,
        capability: entry.capability,
        ...(entry.runbookId ? { runbookId: entry.runbookId } : {}),
        reason: 'runbook-unavailable',
        detail: `no loaded runbook serves ${entry.capability}`,
      });
      continue;
    }
    admit(entry.grantee, rb, 'settings', entry);
  }

  // The fail-closed disclosure for LEGACY entries: a grant with no grantee
  // grants nobody, and the row says exactly what to do about it.
  for (const entry of legacyEntries) {
    if (disarmed.some((d) => d.capability === entry.capability && !d.grantee)) continue;
    disarmed.push({
      capability: entry.capability,
      ...(entry.runbookId ? { runbookId: entry.runbookId } : {}),
      reason: 'requires-agent-grant',
      detail:
        `${entry.capability} was granted before grants named a holder. Re-grant it to a ` +
        `specific agent, chat, or mcp-client — a grant with no grantee grants nobody.`,
    });
  }

  // WP-20f point 1's DISCLOSURE. A mandated capability the registry serves and
  // no grant covers is reported, with the reason, rather than being absent.
  //
  // Two things depend on this row existing. The Settings matrix needs a row
  // someone can act on — "not granted, and here is why" is a fact; silence is
  // not. And on a machine crossing the flip, `emitChanges` looks the reason up
  // HERE when it revokes the grant WP-20b had derived; without the row the
  // revocation would go out saying `runbook-unavailable` about a runbook that
  // is present and serving.
  // fixes-082526 · the flip's own disclosure: a SERVABLE strict capability no
  // grantee holds at all is reported with the flip reason, so a machine that
  // just crossed the flip (everything revoked) renders actionable rows rather
  // than an absence. Mandated capabilities keep their sharper reason below.
  for (const rb of runbooks.runbooks({ strictness: 'strict' })) {
    if (MANDATED.has(rb.capability)) continue;
    if (grants.some((g) => g.capability === rb.capability)) continue;
    if (disarmed.some((d) => d.capability === rb.capability)) continue;
    disarmed.push({
      capability: rb.capability,
      runbookId: rb.id,
      reason: 'requires-agent-grant',
      detail:
        `no grantee holds ${rb.capability}. Grant it to a specific agent, chat, or ` +
        `mcp-client to arm its procedure.`,
    });
  }

  for (const capability of MANDATED_EXPLICIT_CAPABILITIES) {
    // A capability an explicit settings grant DID cover is not disclosed as
    // ungranted, and one settings already disarmed keeps its sharper reason —
    // a hash mismatch says more than "needs a grant" and must not be overwritten.
    if (grants.some((g) => g.capability === capability)) continue;
    if (disarmed.some((d) => d.capability === capability)) continue;
    const rb = runbooks.byCapability(capability);
    // Not served on this machine: there is nothing to grant and nothing to say.
    if (!rb) continue;
    disarmed.push({
      capability,
      runbookId: rb.id,
      reason: 'requires-explicit-grant',
      detail:
        `${capability} is never granted by default — production consequence is not a default. ` +
        `Grant it explicitly against ${rb.id} to arm its procedure.`,
    });
  }

  return { grants, disarmed };

  function admit(grantee: string, rb: Runbook, source: ResolvedGrant['source'], entry?: CapabilityGrantSetting): void {
    if (entry?.enabled === false) {
      disarmed.push({ grantee, capability: rb.capability, runbookId: rb.id, reason: 'disabled-by-settings' });
      return;
    }
    if (entry?.runbookId && entry.runbookId !== rb.id) {
      // A grant naming another document is not a grant for this one. Silently
      // re-pointing it at whatever serves the capability today would transfer
      // an authority that was reviewed against a different file — which is
      // exactly how a standing grant would survive a runbook SPLIT and arm half
      // a procedure nobody reviewed in its split form (WP-20c gate ruling 1).
      //
      // Classed as INTEGRITY, not availability, and the word is the ruled one:
      // a runbook does serve this capability, it is simply not the reviewed one.
      // `runbook-unavailable` is reserved for "nothing serves this at all".
      disarmed.push({
        grantee,
        capability: rb.capability,
        runbookId: entry.runbookId,
        reason: 'hash-mismatch',
        detail: `the grant names ${entry.runbookId}; ${rb.capability} is served by ${rb.id}`,
      });
      return;
    }
    if (entry?.runbookHash && entry.runbookHash !== rb.hash) {
      // §6(b): integrity, not staleness. Both hashes, because the remedy is to
      // re-grant against the current file and a message naming neither cannot
      // be acted on.
      disarmed.push({
        grantee,
        capability: rb.capability,
        runbookId: rb.id,
        reason: 'hash-mismatch',
        detail: `granted against ${entry.runbookHash}; ${rb.path} is now ${rb.hash}`,
      });
      return;
    }
    grants.push({
      grantee,
      capability: rb.capability,
      runbookId: rb.id,
      runbookHash: rb.hash,
      strictness: rb.strictness,
      scope: entry?.scope ? { ...entry.scope } : scopeFromRunbook(rb),
      source,
    });
  }
}

/**
 * Materialize the live grant set, emit what CHANGED, and remember it.
 *
 * Called at bootstrap and again on every settings write (`onSettingsUpdated`),
 * so a grant switched off is revoked at the moment it is switched off rather
 * than at the next boot — which is also what keeps `observed_at` honest.
 *
 * Emits nothing when nothing changed. That is the ledger's own discipline
 * (`changeGate`'s reason, applied by hand because a grant folds into no twin
 * and has no current value to compare): a boot that re-derives the same grant
 * set must not append a second issuance.
 */
export function syncCapabilityGrants(opts: {
  core: IntelligenceCore | undefined;
  storage: MinimalStorage;
  logger: MinimalLogger;
  /**
   * WP-45 · why THIS sync's issuances happened, per capability, from the
   * caller that knows. The Govern control passes `granted-at-control` for the
   * one capability it acted on; nothing else passes anything, and an absent
   * entry falls back to what the producer can derive. Scoped per capability
   * rather than per call because one sync re-resolves the WHOLE set: a single
   * reason for the call would stamp the caller's word onto every other grant
   * that happened to change in the same pass.
   */
  issueReasons?: ReadonlyMap<string, GrantIssueReason>;
  /** Injected for tests; production passes nothing. */
  now?: Date;
}): GrantResolution {
  const { core, storage, logger } = opts;
  const empty: GrantResolution = { grants: [], disarmed: [] };
  try {
    const runbooks = core?.law?.runbooks;
    if (!core || !runbooks) {
      // No core, or the law registry did not come up. Both are already
      // disclosed by the health surface; here they simply mean no grants, which
      // is exactly today's behaviour (design note §6(d)).
      liveGrants = [];
      liveDisarmed = [];
      return empty;
    }

    // One clock reading for the whole sync: the migration record and the events
    // that announce it describe the same moment, and two `new Date()` calls
    // would let them disagree by a millisecond for no reason.
    const now = opts.now ?? new Date();
    // fixes-082526 · THE FAIL-CLOSED FLIP, before anything else reads a
    // marker: every platform-wide (v1) grant is revoked with the flip's own
    // reason, chained to the act it ends, and BOTH markers convert to v2 —
    // the materialized record included, or the very next line would re-grant
    // everything the flip just revoked (its presence short-circuits
    // re-materialization, and its v1 payload was the grant list).
    applyAgentAddressingFlip(core, storage, now, logger);
    // WP-45 · P4. Before anything resolves: any settings grant still pinned to a
    // hash the ratified law review READ is moved to the hash it PRODUCED. Done
    // here rather than in the resolver because the resolver is pure by contract
    // and this writes; done before it rather than after because otherwise the
    // grant disarms as `hash-mismatch` and there is nothing left to re-pin.
    applyLawReviewRePin(storage, logger);
    const materialized = materializeShippedGrants(runbooks, storage, now, logger);
    const resolution = resolveCapabilityGrants({
      runbooks,
      settings: readSettings(storage),
      materialized,
    });
    liveGrants = resolution.grants;
    liveDisarmed = resolution.disarmed;

    for (const d of resolution.disarmed) {
      logger.info(
        `[Intelligence] capability grant disarmed ${d.capability} (${d.reason})` +
          (d.detail ? `: ${d.detail}` : '')
      );
    }

    emitChanges(core, storage, resolution, now, logger, opts.issueReasons);
    return resolution;
  } catch (err) {
    // A grant surface that could break startup would be a worse failure than
    // the absent procedure it is trying to describe.
    logger.error(`[Intelligence] capability grant sync failed (non-fatal): ${(err as Error).message}`);
    return { grants: liveGrants, disarmed: liveDisarmed };
  }
}

/**
 * WP-45 · P4's re-pin, on the SETTINGS overlay — the half that would otherwise
 * die rather than survive.
 *
 * There are two grant shapes and the hash change lands on them differently, as
 * `lawReviewRePin.test.ts` drives:
 *
 *  - A **materialized** grant carries no hash pin, so it re-pins itself and
 *    stays granted. Nothing to restore; the only defect is that the ledger
 *    would call a reviewed re-pin `repinned`, which `emitChanges` fixes.
 *  - A grant made **at the Govern control** carries the hash it was made
 *    against, so a version bump disarms it as `hash-mismatch` — correct in
 *    general, and wrong here: the review IS the review of the new text.
 *
 * So this upgrades exactly the second shape, and only across a transition the
 * review actually performed. Anything else keeps `hash-mismatch`, which is the
 * behaviour that makes a grant mean "reviewed against THIS text".
 *
 * WRITES NOTHING WHEN NOTHING MATCHES — the common case by far, since the table
 * is spent the moment it applies. Best-effort like every other write here: a
 * failed rewrite leaves the grant disarmed with an actionable reason, which is
 * the right direction for this failure to fall.
 */
function applyLawReviewRePin(storage: MinimalStorage, logger: MinimalLogger): void {
  try {
    const settings = readSettings(storage);
    const entries = Array.isArray(settings?.capabilityGrants) ? settings!.capabilityGrants : [];
    if (entries.length === 0) return;

    let changed = false;
    const next = entries.map((entry) => {
      if (!entry?.runbookHash) return entry;
      // Matched on `from` alone: the `to` is what this is about to WRITE, so
      // requiring it as an input would be circular. `lawReviewRePinFor` is the
      // emitter's matcher, where both ends are already known facts.
      const pin = LAW_REVIEW_REPIN.find(
        (r) => r.capability === entry.capability && r.from === entry.runbookHash
      );
      if (!pin) return entry;
      changed = true;
      logger.info(
        `[Intelligence] law-review re-pin: ${entry.capability} moved from ${pin.from} to ${pin.to}`
      );
      return { ...entry, runbookId: pin.runbookId, runbookHash: pin.to };
    });

    if (!changed) return;
    storage.set(STORAGE_KEYS.SETTINGS, { ...(settings ?? {}), capabilityGrants: next });
  } catch (err) {
    logger.error(`[Intelligence] law-review re-pin failed (non-fatal): ${(err as Error).message}`);
  }
}

/**
 * WP-20f · THE MIGRATION — run once, at the boot where the flip lands.
 *
 * It converts the capabilities WP-20b had been granting implicitly, every boot,
 * from a derivation into an explicit persisted list. Ruling point 2: what
 * remains enabled becomes a grant someone can see and revoke, never a default
 * nobody chose. The `control.grant.issued` events that announce them are
 * emitted by `emitChanges` below — WP-20b's producer, unchanged, with the
 * `reason: 'materialized'` it already used for a first issuance.
 *
 * TRIGGER: here, inside the sync that bootstrap and `onSettingsUpdated` already
 * call. No new call site, so no edit to `index.ts` and no integration lock.
 *
 * IDEMPOTENT, on three independent layers — each one sufficient alone:
 *
 *  1. **The record's PRESENCE**, not a timestamp and not a count. A stored
 *     record short-circuits, so the derivation runs exactly once per machine.
 *     Presence is deliberately not "a non-empty list": a registry that served
 *     no strict runbook at migration time materialized nothing, and that is a
 *     completed migration, not a missing one.
 *  2. **Nothing ever appends.** There is no union, no top-up, no re-derive on a
 *     later boot. This is what makes a capability shipped tomorrow arrive
 *     DENIED — point 3 — rather than being swept in by the next sync.
 *  3. **The pre-existing event gate**, untouched: `emitChanges` compares
 *     `(capability, runbookId, runbookHash)` against `GRANTS_STORAGE_KEY` and
 *     emits nothing for an unchanged triple. Lose the materialized record alone
 *     and the derivation re-runs to the identical set while this layer still
 *     suppresses every duplicate event.
 *
 * DISCLOSED FAILURE DIRECTION (ratified as disclosed at the WP-20f gate): lose
 * BOTH markers and the machine is indistinguishable from a fresh install, so
 * the migration re-derives over whatever is shipped THEN — a capability added
 * after this packet would be materialized as though it were day-one. The
 * event-sourced repair is to rebuild the set from the ledger's own
 * `control.grant.issued`/`revoked` history (architecture.md: "the grant table
 * is itself a fold view"). That is a grant FOLD and a registered follow-on, not
 * this packet.
 */
function materializeShippedGrants(
  runbooks: RunbookRegistry,
  storage: MinimalStorage,
  now: Date,
  logger: MinimalLogger
): Array<{ grantee: string; capability: string }> {
  const stored = readMaterialized(storage);
  if (stored) {
    // Layer 1 of the dedup key. Tampering is the only way a mandated capability
    // reaches this list, and the resolver refuses it regardless — but a marker
    // that says something false should not say it silently.
    const mandated = stored.grants.filter((g) => MANDATED.has(g.capability));
    if (mandated.length > 0) {
      logger.warn?.(
        `[Intelligence] materialized grant record names ${mandated.map((g) => g.capability).join(', ')}, ` +
          'which are never granted by default — ignored; grant them explicitly in settings if intended.'
      );
    }
    return stored.grants;
  }

  // Fresh install: the WP-20f out-of-box set, per BUILTIN grantee — the
  // human-in-the-loop surfaces only. Agents are deliberately absent (see
  // BUILTIN_GRANTEES): an agent holds only what a human granted it.
  const capabilities = materializableCapabilities(runbooks);
  const grants = BUILTIN_GRANTEES.flatMap((grantee) =>
    capabilities.map((capability) => ({ grantee, capability })));
  const record: MaterializedState = {
    version: 2,
    migratedAt: now.toISOString(),
    grants,
  };
  try {
    storage.set(MATERIALIZED_STORAGE_KEY, record);
  } catch {
    // Best effort, and the direction this falls in is the safe one: an unwritten
    // record re-derives the SAME set next boot, where the event gate suppresses
    // the duplicate issuance. Refusing to grant because a marker would not write
    // would cost the user their procedures over a storage fault.
  }
  logger.info(
    `[Intelligence] capability grants materialized (${capabilities.length} × ` +
      `${BUILTIN_GRANTEES.join('/')}): ${capabilities.join(', ') || 'none'}. ` +
      `Never by default: ${MANDATED_EXPLICIT_CAPABILITIES.join(', ')}. Agents: explicit grants only.`
  );
  return grants;
}

function readMaterialized(storage: MinimalStorage): MaterializedState | null {
  try {
    const raw = storage.get(MATERIALIZED_STORAGE_KEY) as
      | (Partial<MaterializedState> & { capabilities?: unknown })
      | null;
    // PRESENCE, not content: an empty list is a completed migration. Only the
    // v2 shape counts — a v1 record is the FLIP's input, never this reader's
    // (the flip runs first and converts it; reading v1 here would re-grant
    // what the flip revoked).
    if (raw && raw.version === 2 && Array.isArray(raw.grants)) {
      return {
        version: 2,
        migratedAt: typeof raw.migratedAt === 'string' ? raw.migratedAt : '',
        grants: raw.grants.filter(
          (g): g is { grantee: string; capability: string } =>
            !!g && typeof (g as { grantee?: unknown }).grantee === 'string' &&
            typeof (g as { capability?: unknown }).capability === 'string'
        ),
      };
    }
  } catch {
    /* unreadable = absent; see the disclosed failure direction above */
  }
  return null;
}

function readSettings(storage: MinimalStorage): Pick<NexusSettings, 'capabilityGrants'> | null {
  try {
    const raw = storage.get(STORAGE_KEYS.SETTINGS);
    return raw && typeof raw === 'object' ? (raw as NexusSettings) : null;
  } catch {
    // Unreadable settings cost the overlay, not the shipped set: the shipped
    // grants come from documents on disk and are still correct.
    return null;
  }
}

/**
 * WP-44 · what the issuance marker holds, for the surface that renders it.
 *
 * The Govern matrix's granted rows must state WHICH ACT made the grant, from
 * the grant's own `control.grant.issued` event — pin 5. That event id lives in
 * this module's marker and nowhere else, so the alternative to this accessor is
 * the matrix reading `GRANTS_STORAGE_KEY` itself. It must not: the marker is
 * documented OWNED BY THIS MODULE, and a second reader that learns its shape is
 * how a storage key acquires two owners with different ideas of what it means.
 *
 * READ-ONLY BY CONSTRUCTION. It returns a fresh map of plain values; there is no
 * write path here and the matrix has no business writing one. A grant changes by
 * going through `syncCapabilityGrants` like every other grant change, so the
 * event that announces it is emitted by the one producer that may emit it.
 */
export function readGrantIssuance(storage: MinimalStorage): Map<string, { eventId: string; issuedAt: string }> {
  const out = new Map<string, { eventId: string; issuedAt: string }>();
  for (const entry of readMarker(storage).grants) {
    if (entry && typeof entry.capability === 'string' && typeof entry.eventId === 'string') {
      // INTERIM (agent-addressing phase 1): still keyed per CAPABILITY for the
      // matrix's one-row-per-capability rendering — FIRST entry wins, which is
      // marker order, which is BUILTIN_GRANTEES order, so the act shown is
      // deterministic (the chat act). The per-grantee acts become their own
      // rows in phase 3's surfaces.
      if (out.has(entry.capability)) continue;
      out.set(entry.capability, {
        eventId: entry.eventId,
        issuedAt: typeof entry.issuedAt === 'string' ? entry.issuedAt : '',
      });
    }
  }
  return out;
}

/**
 * The act per (grantee, capability) — phase 3's accessor, keyed
 * `grantee|capability`. `readGrantIssuance` above stays capability-keyed
 * (first-wins) for the one-row-per-capability matrix; per-grantee surfaces
 * cite their OWN act through this instead, because a row that cites another
 * holder's act misattributes the decision.
 */
export function readGrantIssuanceByPair(
  storage: MinimalStorage
): Map<string, { eventId: string; issuedAt: string }> {
  const out = new Map<string, { eventId: string; issuedAt: string }>();
  for (const entry of readMarker(storage).grants) {
    if (entry && typeof entry.capability === 'string' && typeof entry.eventId === 'string') {
      out.set(`${entry.grantee}|${entry.capability}`, {
        eventId: entry.eventId,
        issuedAt: typeof entry.issuedAt === 'string' ? entry.issuedAt : '',
      });
    }
  }
  return out;
}

function readMarker(storage: MinimalStorage): MarkerState {
  try {
    const raw = storage.get(GRANTS_STORAGE_KEY) as (Partial<MarkerState> & { version?: number }) | null;
    // v2 only: a v1 marker is the FLIP's input (applyAgentAddressingFlip runs
    // before every read of this), and its entries carry no grantee. Reading
    // them here would resurrect platform-wide grants under a missing key.
    if (raw && raw.version === 2 && Array.isArray(raw.grants)) {
      return { version: 2, grants: raw.grants as MarkerEntry[] };
    }
  } catch {
    /* an unreadable marker is treated as empty — see emitChanges for the cost */
  }
  return { version: 2, grants: [] };
}

/**
 * fixes-082526 · THE FAIL-CLOSED FLIP (owner rulings 1/1a, 2026-08-26).
 *
 * Runs at the top of every sync and is a no-op on a v2 machine. On a machine
 * whose markers are v1 — platform-wide grants, no grantee anywhere — it:
 *
 *  1. emits one `control.grant.revoked` per v1 issuance-marker entry, reason
 *     `requires-agent-grant`, `causation` chained to the act it ends. The
 *     revocations ARE the compliance record of the flip; silence is forbidden
 *     (the WP-20f precedent: mandated capabilities were revoked on upgrade
 *     with the reason recorded);
 *  2. writes BOTH markers as v2-empty. The materialized record especially:
 *     its presence short-circuits re-materialization, so leaving it v1 would
 *     have the very next sync re-grant everything this just revoked.
 *
 * Nothing is re-granted here. Re-grants are explicit human acts — settings
 * entries naming a grantee — which is the whole of the ruling.
 */
function applyAgentAddressingFlip(
  core: IntelligenceCore,
  storage: MinimalStorage,
  now: Date,
  logger: MinimalLogger
): void {
  try {
    const rawMarker = storage.get(GRANTS_STORAGE_KEY) as
      | { version?: number; grants?: MarkerEntryV1[] }
      | null;
    const rawMaterialized = storage.get(MATERIALIZED_STORAGE_KEY) as
      | { version?: number; migratedAt?: string; capabilities?: string[] }
      | null;

    const markerIsV1 = !!rawMarker && Array.isArray(rawMarker.grants) && rawMarker.version !== 2;
    const materializedIsV1 =
      !!rawMaterialized && Array.isArray(rawMaterialized.capabilities) && rawMaterialized.version !== 2;
    if (!markerIsV1 && !materializedIsV1) return;

    const v1Entries = markerIsV1 ? rawMarker!.grants! : [];
    for (const entry of v1Entries) {
      if (!entry || typeof entry.capability !== 'string') continue;
      emit(core, logger, {
        topic: GRANT_REVOKED_TOPIC,
        schema: GRANT_REVOKED_SCHEMA,
        observedAt: now.toISOString(),
        actor: { id: GRANT_MATERIALIZER_ACTOR, kind: 'system' },
        source: { class: 'platform', system: GRANTS_SYSTEM, trust: 'observed' },
        ...(entry.eventId ? { causation: entry.eventId } : {}),
        payload: {
          capability: entry.capability,
          runbook_id: entry.runbookId,
          runbook_hash: entry.runbookHash,
          reason: 'requires-agent-grant',
          detail:
            'grants became agent-addressed: a platform-wide grant names no holder and is ' +
            'revoked. Re-grant this capability to a specific agent, chat, or mcp-client.',
        },
      });
    }

    try {
      storage.set(GRANTS_STORAGE_KEY, { version: 2, grants: [] } satisfies MarkerState);
      storage.set(MATERIALIZED_STORAGE_KEY, {
        version: 2,
        migratedAt: now.toISOString(),
        grants: [],
      } satisfies MaterializedState);
    } catch {
      // Best effort with a safe failure direction: unconverted markers repeat
      // the flip next sync, where the emissions repeat too — noisy, never
      // wrong-way (nothing re-grants from a v1 record, readMaterialized and
      // readMarker both refuse the shape).
    }

    logger.info(
      `[Intelligence] agent-addressing flip: revoked ${v1Entries.length} platform-wide grant(s); ` +
        're-grant per agent/chat/mcp-client in Settings.'
    );
  } catch (err) {
    logger.error(`[Intelligence] agent-addressing flip failed (non-fatal): ${(err as Error).message}`);
  }
}

function emitChanges(
  core: IntelligenceCore,
  storage: MinimalStorage,
  resolution: GrantResolution,
  now: Date,
  logger: MinimalLogger,
  issueReasons?: ReadonlyMap<string, GrantIssueReason>
): void {
  const previous = readMarker(storage);
  // The grant unit is (grantee, capability) — one key, both halves, or a
  // grant moved between grantees would read as "unchanged".
  const keyOf = (g: { grantee: string; capability: string }) => `${g.grantee}|${g.capability}`;
  const priorByKey = new Map(previous.grants.map((g) => [keyOf(g), g]));
  const next: MarkerEntry[] = [];

  for (const grant of resolution.grants) {
    const prior = priorByKey.get(keyOf(grant));
    priorByKey.delete(keyOf(grant));

    const unchanged =
      prior && prior.runbookId === grant.runbookId && prior.runbookHash === grant.runbookHash;
    if (unchanged) {
      next.push(prior!);
      continue;
    }

    // A re-pin is an ISSUANCE, not a revocation followed by one: the capability
    // was never withdrawn, only the document it points at changed. Chained to
    // the grant it supersedes so the trail reads in order.
    const repinned = Boolean(prior);
    // WP-45 · the reason, in precedence order, most-specific first:
    //  1. what the CALLER knows and the producer cannot see — a person acting
    //     at the Govern control;
    //  2. the ratified law review, matched on the exact hash transition;
    //  3. what the producer can derive on its own, which is the least it can
    //     say rather than the most.
    const reason: GrantIssueReason =
      issueReasons?.get(grant.capability) ??
      (lawReviewRePinFor(grant.capability, prior?.runbookHash, grant.runbookHash)
        ? 'law-review re-pin'
        : repinned
          ? 'repinned'
          : 'materialized');
    const id = emit(core, logger, {
      topic: GRANT_ISSUED_TOPIC,
      schema: GRANT_ISSUED_SCHEMA,
      observedAt: now.toISOString(),
      actor: { id: GRANT_MATERIALIZER_ACTOR, kind: 'system' },
      // The grant's authority comes from the reviewed document, which is
      // authored expertise — not from a platform observation and not from the
      // user's intent.
      source: { class: 'expertise', system: GRANTS_SYSTEM, trust: 'authored' },
      ...(prior ? { causation: prior.eventId } : {}),
      payload: {
        grantee: grant.grantee,
        capability: grant.capability,
        runbook_id: grant.runbookId,
        runbook_hash: grant.runbookHash,
        strictness: grant.strictness,
        scope: grant.scope,
        grant_source: grant.source,
        reason,
        ...(repinned ? { previous_runbook_hash: prior!.runbookHash } : {}),
      },
    });

    // An emission that FAILED leaves this grant out of the marker on purpose,
    // so the next sync announces it again. Recording it as announced would
    // suppress the retry forever and leave a live grant with no record of ever
    // having been issued — the trail would then be unable to explain where the
    // ceremony came from, which is the one thing these events are for.
    if (id) {
      next.push({
        grantee: grant.grantee,
        capability: grant.capability,
        runbookId: grant.runbookId,
        runbookHash: grant.runbookHash,
        eventId: id,
        issuedAt: now.toISOString(),
      });
    }
  }

  // Whatever the marker still holds was granted and is not live any more.
  for (const stale of priorByKey.values()) {
    const disarm = resolution.disarmed.find(
      (d) => d.capability === stale.capability && (d.grantee === undefined || d.grantee === stale.grantee)
    );
    // No disarm record means the grant vanished with its document — nothing
    // configured it, so nothing reported it disarmed.
    const reason: DisarmReason = disarm?.reason ?? 'runbook-unavailable';
    const byUser = reason === 'disabled-by-settings';
    emit(core, logger, {
      topic: GRANT_REVOKED_TOPIC,
      schema: GRANT_REVOKED_SCHEMA,
      observedAt: now.toISOString(),
      // A user switching a grant off is a human act on elicited intent. A
      // document that changed or vanished is neither: attributing it to
      // whoever happened to be logged in would put a person's name on a
      // platform event.
      actor: byUser
        ? core.identity?.actor() ?? { id: 'act_local_operator', kind: 'human' }
        : { id: GRANT_MATERIALIZER_ACTOR, kind: 'system' },
      source: byUser
        ? { class: 'intent', system: GRANTS_SETTINGS_SYSTEM, trust: 'elicited' }
        : { class: 'platform', system: GRANTS_SYSTEM, trust: 'observed' },
      // The issuance this answers. Without it, "revoked" is a fact with no
      // subject: which grant, granted when, against which document.
      ...(stale.eventId ? { causation: stale.eventId } : {}),
      payload: {
        grantee: stale.grantee,
        capability: stale.capability,
        runbook_id: stale.runbookId,
        runbook_hash: stale.runbookHash,
        reason,
        ...(disarm?.detail ? { detail: disarm.detail } : {}),
      },
    });
  }

  try {
    storage.set(GRANTS_STORAGE_KEY, { version: 2, grants: next } as MarkerState);
  } catch {
    // The marker is best-effort. The cost of losing it is a duplicate issuance
    // on the next boot, not a wrong grant — which is the right direction for
    // this failure to fall.
  }
}

/**
 * One emission, individually wrapped. A grant is configuration: recording it is
 * how the trail explains why ceremony appeared, and losing that record must
 * never cost the grant itself.
 */
function emit(
  core: IntelligenceCore,
  logger: MinimalLogger,
  draft: {
    topic: string;
    schema: string;
    observedAt: string;
    actor: { id: string; kind: 'human' | 'agent' | 'ability' | 'system' };
    source: { class: 'expertise' | 'intent' | 'platform'; system: string; trust: 'authored' | 'elicited' | 'observed' };
    causation?: string;
    payload: Record<string, unknown>;
  }
): string | undefined {
  try {
    const event = core.emitter.emit({
      observed_at: draft.observedAt,
      topic: draft.topic,
      schema: draft.schema,
      // A grant is about a capability, not an entity. An empty entity map is the
      // honest answer; inventing a site would misattribute it.
      entity: {},
      actor: draft.actor,
      source: draft.source,
      ...(draft.causation ? { causation: draft.causation } : {}),
      payload: draft.payload,
    });
    return event.id;
  } catch (err) {
    logger.error(`[Intelligence] ${draft.topic} emission failed (non-fatal): ${(err as Error).message}`);
    return undefined;
  }
}
