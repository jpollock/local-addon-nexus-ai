/**
 * WP-20b · Capability grants — the host side of P2, and the first producer of
 * `control.grant.issued` / `control.grant.revoked` anywhere in the tree.
 *
 * A grant says: *this capability is served by this reviewed document, pinned by
 * its hash.* Two layers produce the live set, in this order:
 *
 *   1. **Shipped law.** Every STRICT runbook the registry SERVES gets a grant,
 *      enabled, scoped to the runbook's own declared scope. Nothing is written
 *      to settings to make that true — the shipped set is derived on every boot
 *      from the documents actually present, so a runbook refused by the ceiling
 *      or missing from `law/` simply has no grant.
 *   2. **The settings overlay** (`NexusSettings.capabilityGrants`). Switch one
 *      off, pin one to the document you reviewed, name one the shipped set does
 *      not cover. Only `capability` is required.
 *
 * WHY THE SHIPPED SET IS ENABLED, when a grant is the *restrictive* thing.
 * P2's inversion, ruled: today a chat model can call `bulk_plugin_update` with
 * no ceremony at all, so shipping the grant OFF would leave the unceremonious
 * path as the default and make the safe one opt-in. v0 grants are therefore
 * ADDITIVE — holding one adds a procedure and (at WP-20d) sequencing over that
 * capability's own tools; not holding one leaves today's tool reach untouched.
 * Making a capability *required* removes reach and is WP-20f, not this.
 *
 * WHY STRICT ONLY, in the shipped set. A strict runbook has a mandatory
 * full-body ride: the turn carrier must deliver the whole hash-pinned document
 * before the run may proceed, which is what the 8 KB ceiling bounds. Guided
 * runbooks have no such obligation (WP-20a ruling 2), and both shipped ones are
 * over 8 KB as whole documents — a shipped grant for them would hand a later
 * delivery path a payload the ceiling was written to prevent. An explicit
 * settings grant for a guided capability is still honoured: the rule is a
 * default, not a ban.
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

export const GRANT_ISSUED_SCHEMA = 'grant.issued/1';
export const GRANT_REVOKED_SCHEMA = 'grant.revoked/1';

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

/** `source.system` for both topics — one value, so a liveness reader sees one row. */
export const GRANTS_SYSTEM = 'law:capability-grants';
/** A user turning a grant off is a different source: their intent, not the shipped law's. */
export const GRANTS_SETTINGS_SYSTEM = 'settings:capability-grants';

/** The actor for a grant the platform materialized from shipped law. */
export const GRANT_MATERIALIZER_ACTOR = 'act_grant_materializer';

/** A live grant, fully resolved against the documents actually present. */
export interface ResolvedGrant {
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

export type DisarmReason = 'disabled-by-settings' | 'hash-mismatch' | 'runbook-unavailable';

/** A grant that was configured and is NOT live, with the reason a user can act on. */
export interface DisarmedGrant {
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
  capability: string;
  runbookId: string;
  runbookHash: string;
  /** The `control.grant.issued` event this grant was announced by — a revocation chains to it. */
  eventId: string;
  issuedAt: string;
}

interface MarkerState {
  version: 1;
  grants: MarkerEntry[];
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
  for (const grant of grants) {
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
 * Resolve the configured grants against the documents actually present.
 *
 * Pure: no emission, no storage, no clock. `syncCapabilityGrants` is the side
 * effect, so this can be read by anything that only wants to know what is live.
 */
export function resolveCapabilityGrants(opts: {
  runbooks: RunbookRegistry;
  settings?: Pick<NexusSettings, 'capabilityGrants'> | null;
}): GrantResolution {
  const { runbooks } = opts;
  const overrides = new Map<string, CapabilityGrantSetting>();
  for (const entry of opts.settings?.capabilityGrants ?? []) {
    if (entry && typeof entry.capability === 'string' && entry.capability) {
      overrides.set(entry.capability, entry);
    }
  }

  const grants: ResolvedGrant[] = [];
  const disarmed: DisarmedGrant[] = [];

  // Layer 1: the shipped set — every strict runbook the registry serves.
  const shipped = runbooks.runbooks({ strictness: 'strict' });
  for (const rb of shipped) {
    admit(rb, 'shipped', overrides.get(rb.capability));
    overrides.delete(rb.capability);
  }

  // Layer 2: whatever settings name that the shipped set did not cover.
  for (const [capability, entry] of overrides) {
    const rb = runbooks.byCapability(capability);
    if (!rb) {
      // The runbook may be absent, or refused by the registry (over the
      // ceiling, unhonourable contract). Either way the capability cannot be
      // served, and saying so is §6(a)'s disclosure obligation.
      disarmed.push({
        capability,
        ...(entry.runbookId ? { runbookId: entry.runbookId } : {}),
        reason: 'runbook-unavailable',
        detail: `no loaded runbook serves ${capability}`,
      });
      continue;
    }
    admit(rb, 'settings', entry);
  }

  return { grants, disarmed };

  function admit(rb: Runbook, source: ResolvedGrant['source'], entry?: CapabilityGrantSetting): void {
    if (entry?.enabled === false) {
      disarmed.push({ capability: rb.capability, runbookId: rb.id, reason: 'disabled-by-settings' });
      return;
    }
    if (entry?.runbookId && entry.runbookId !== rb.id) {
      // A grant naming another document is not a grant for this one. Silently
      // re-pointing it at whatever serves the capability today would transfer
      // an authority that was reviewed against a different file.
      disarmed.push({
        capability: rb.capability,
        runbookId: entry.runbookId,
        reason: 'runbook-unavailable',
        detail: `the grant names ${entry.runbookId}; ${rb.capability} is served by ${rb.id}`,
      });
      return;
    }
    if (entry?.runbookHash && entry.runbookHash !== rb.hash) {
      // §6(b): integrity, not staleness. Both hashes, because the remedy is to
      // re-grant against the current file and a message naming neither cannot
      // be acted on.
      disarmed.push({
        capability: rb.capability,
        runbookId: rb.id,
        reason: 'hash-mismatch',
        detail: `granted against ${entry.runbookHash}; ${rb.path} is now ${rb.hash}`,
      });
      return;
    }
    grants.push({
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

    const resolution = resolveCapabilityGrants({ runbooks, settings: readSettings(storage) });
    liveGrants = resolution.grants;
    liveDisarmed = resolution.disarmed;

    for (const d of resolution.disarmed) {
      logger.info(
        `[Intelligence] capability grant disarmed ${d.capability} (${d.reason})` +
          (d.detail ? `: ${d.detail}` : '')
      );
    }

    emitChanges(core, storage, resolution, opts.now ?? new Date(), logger);
    return resolution;
  } catch (err) {
    // A grant surface that could break startup would be a worse failure than
    // the absent procedure it is trying to describe.
    logger.error(`[Intelligence] capability grant sync failed (non-fatal): ${(err as Error).message}`);
    return { grants: liveGrants, disarmed: liveDisarmed };
  }
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

function readMarker(storage: MinimalStorage): MarkerState {
  try {
    const raw = storage.get(GRANTS_STORAGE_KEY) as MarkerState | null;
    if (raw && Array.isArray(raw.grants)) return { version: 1, grants: raw.grants };
  } catch {
    /* an unreadable marker is treated as empty — see emitChanges for the cost */
  }
  return { version: 1, grants: [] };
}

function emitChanges(
  core: IntelligenceCore,
  storage: MinimalStorage,
  resolution: GrantResolution,
  now: Date,
  logger: MinimalLogger
): void {
  const previous = readMarker(storage);
  const priorByCapability = new Map(previous.grants.map((g) => [g.capability, g]));
  const next: MarkerEntry[] = [];

  for (const grant of resolution.grants) {
    const prior = priorByCapability.get(grant.capability);
    priorByCapability.delete(grant.capability);

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
        capability: grant.capability,
        runbook_id: grant.runbookId,
        runbook_hash: grant.runbookHash,
        strictness: grant.strictness,
        scope: grant.scope,
        grant_source: grant.source,
        reason: repinned ? 'repinned' : 'materialized',
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
        capability: grant.capability,
        runbookId: grant.runbookId,
        runbookHash: grant.runbookHash,
        eventId: id,
        issuedAt: now.toISOString(),
      });
    }
  }

  // Whatever the marker still holds was granted and is not live any more.
  for (const stale of priorByCapability.values()) {
    const disarm = resolution.disarmed.find((d) => d.capability === stale.capability);
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
        capability: stale.capability,
        runbook_id: stale.runbookId,
        runbook_hash: stale.runbookHash,
        reason,
        ...(disarm?.detail ? { detail: disarm.detail } : {}),
      },
    });
  }

  try {
    storage.set(GRANTS_STORAGE_KEY, { version: 1, grants: next } as MarkerState);
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
