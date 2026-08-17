/**
 * WP-15 · The divergence comparator — how far a working copy has drifted from
 * what it tracks, per flow, since the last sync.
 *
 * Audit A5: the shipped drift machinery is strictly TEMPORAL (one
 * `(entity, fact)` row against its own past; `DriftNotice` cannot even name
 * two entities). Copy-vs-upstream is a different computation, and it is
 * available only because fact keys are entity-independent — two entities'
 * twins are directly comparable, which `compare_sites` proves on the reader
 * side today.
 *
 * Four properties govern every line below.
 *
 * **1 · READ-SIDE. It never mints.** ADR-21 froze entity ids; a comparison
 * that calls `ensure()` would register an entity for whatever handle it was
 * passed and quietly split the history it exists to join. Everything here
 * resolves through links and aliases that already exist, and returns *nothing*
 * where a derivation would have returned something. This is not a style
 * preference — it is audit A7's defect, and the pin that guards it counts rows
 * in `entities`, `entity_aliases`, `entity_links`, `events` and `twin_facts`.
 *
 * **2 · The two flows carry different units** (model §3; the user-docs
 * pressure test, finding №3, is binding). Content flows DOWN and is measured
 * in TIME — a copy's database is a snapshot, and the only honest number is how
 * old it is. Code flows UP and is measured in ITEMS — plugins, themes, the
 * WordPress version. Mixing them in one figure ("4 behind") is the sentence
 * this shape exists to prevent.
 *
 * **3 · The anchor is a recorded fact or it is absent.** "Since the last sync
 * at T" comes from WP-14's `episodic.sync.*` events. No event means *no
 * recorded sync* — a distinct, valid answer, never a fabricated zero point and
 * never an unqualified "up to date".
 *
 * **4 · Three absences stay three answers.** No lineage (nothing says what
 * this copy tracks), lineage but no recorded sync, and a sync whose contents
 * could not be determined (`flow: 'unknown'`) are different situations with
 * different remedies. Collapsing any pair of them into "unknown" throws away
 * the only information the user could act on.
 *
 * Rendering lives OUTSIDE this module (`src/main/intelligence-host/
 * divergenceReport.ts`): the Controlled Vocabulary is a product surface, and
 * the seam keeps user-facing copy out of the core.
 */
import { Ledger } from '../ledger/ledger';
import { EntityService } from '../entity/entityService';
import { TwinStore, TwinFact } from '../folds/twinStore';
import { TrustClass } from '../envelope/types';

export interface DivergenceDeps {
  ledger: Ledger;
  twins: TwinStore;
  /** Optional exactly as everywhere else on this seam — absent means no lineage. */
  entities?: EntityService;
  now?: Date;
}

/**
 * WP-14's payload union plus the value the architect ruled in when adjudicating
 * it: a sync the producer could observe but not classify. Stated uncertainty
 * beats conservative silence — a reader seeing `unknown` can say "a sync
 * happened; what it included couldn't be determined", which is the true
 * sentence. Any value outside the union degrades here rather than escaping
 * into a caller's switch.
 */
export type SyncFlow = 'content' | 'code' | 'full' | 'unknown';

export type SyncDirection = 'up' | 'down' | 'unknown';

/** One side's stalest participating observation — same shape compare_sites uses. */
export interface SideObservation {
  observedAt: string;
  ageSeconds: number;
  sloSeconds: number;
  trust: TrustClass;
  fresh: boolean;
}

/** The zero point: the last sync this copy took part in. */
export interface SyncAnchor {
  eventId: string;
  /** `observed_at` — when the sync finished, not when the ledger heard about it. */
  at: string;
  ageSeconds: number;
  flow: SyncFlow;
  direction: SyncDirection;
  /** Absent when the event does not say — never defaulted to false. */
  includesDb?: boolean;
  /** The upstream the sync itself named, which may differ from the resolved one. */
  upstreamEntityId?: string;
}

export type UpstreamVia = 'content_lineage' | 'site_environment';

export interface UpstreamCandidate {
  entityId: string;
  confidence: number;
  establishedBy: string;
}

/** Why a flow could not be measured. Each value is a different user sentence. */
export type ContentReason = 'no-lineage' | 'no-recorded-sync';

/**
 * Content divergence, in TIME. Deliberately carries no item count: nothing in
 * the twin substrate observes posts, pages or orders (the user-docs pressure
 * test, finding №5, says so explicitly), so an item figure here would be
 * invented. Deliberately one-directional too — content is authored on the
 * upstream and flows down, so a copy is behind by the age of its snapshot;
 * "ahead" would require per-item content observation this layer does not have.
 */
export interface ContentDivergence {
  upstreamEntityId?: string;
  /** The last sync that actually carried a database. */
  pulledAt?: string;
  behindSeconds?: number;
  reason?: ContentReason;
}

export type CodeItemStatus = 'only_on_copy' | 'only_on_upstream' | 'differs';
export type CodeDirection = 'ahead' | 'behind' | 'unknown';

export interface CodeItemSide {
  version?: string;
  active?: boolean;
}

export interface CodeItem {
  /** The twin fact key, or `wp.version` for the WordPress core version. */
  fact: string;
  copy?: CodeItemSide;
  upstream?: CodeItemSide;
  status: CodeItemStatus;
  direction: CodeDirection;
}

/**
 * Code divergence, in ITEMS. Carries no time-behind figure for the same reason
 * content carries no item count: the units are per-flow and mixing them
 * produces a number that means nothing.
 */
export interface CodeDivergence {
  upstreamEntityId?: string;
  /** How many code facts existed on either side — the denominator. */
  comparedFacts: number;
  items: CodeItem[];
  ahead: number;
  behind: number;
  /** Differs, but which side is newer cannot be established. */
  changed: number;
  copy?: SideObservation;
  upstream?: SideObservation;
  reason?: 'no-upstream';
}

export interface DivergenceReport {
  copyEntityId: string;
  siteEntityId?: string;
  upstream?: { entityId: string; via: UpstreamVia };
  /** Every environment of the copy's Site that could have been the upstream. */
  candidates: UpstreamCandidate[];
  /** True when candidates existed but none outranked the rest — a decline, not a failure. */
  ambiguous: boolean;
  anchor?: SyncAnchor;
  content: ContentDivergence;
  code: CodeDivergence;
}

/**
 * How many recent sync events to consider when locating the anchor. Ledger
 * order is by ULID (arrival); the anchor is the newest by `observed_at`, so a
 * window is needed rather than a single row. 100 syncs of one copy is far past
 * any plausible re-ordering.
 */
const SYNC_WINDOW = 100;

const KNOWN_FLOWS: readonly string[] = ['content', 'code', 'full'];

/** Code-flow twin facts. Users and content have no code-flow meaning. */
const CODE_FACT_PREFIXES: readonly string[] = ['plugin:', 'theme:'];

/**
 * The WordPress core version, lifted out of the `site.core` fact.
 *
 * `site.core` is compared field-by-field rather than whole: it bundles the
 * version (code, and comparable) with `name`/`domain` (identity, which differ
 * between a copy and its upstream BY CONSTRUCTION — reporting them would emit
 * a permanent false difference) and `php_version` (a property of the host, not
 * something a pull or a push moves).
 */
const WP_VERSION_KEY = 'wp.version';

export function divergence(copyEntityId: string, deps: DivergenceDeps): DivergenceReport {
  const now = deps.now ?? new Date();
  const entities = deps.entities;

  const siteEntityId = safely(() => entities?.siteOf(copyEntityId));
  const candidates = resolveCandidates(entities, copyEntityId, siteEntityId);
  const resolution = resolveUpstream(entities, copyEntityId, candidates);
  const anchor = resolveAnchor(deps.ledger, copyEntityId, now);

  return {
    copyEntityId,
    siteEntityId,
    upstream: resolution.upstream,
    candidates,
    ambiguous: resolution.ambiguous,
    anchor,
    content: contentDivergence(deps.ledger, copyEntityId, resolution.upstream?.entityId, now),
    code: codeDivergence(deps.twins, copyEntityId, resolution.upstream?.entityId, now),
  };
}

// ---------------------------------------------------------------------------
// Pair resolution — from the links, never from a name
// ---------------------------------------------------------------------------

/**
 * The environments of this copy's Site that could be an upstream: every
 * `has_environment` edge, minus the copy itself and minus every OTHER working
 * copy of the same Site.
 *
 * The working-copy exclusion is why WP-14 wrote `has_working_copy` alongside
 * the kept `has_environment` (audit A6): a copy appears in BOTH traversals, so
 * `environmentsOf` alone would offer a colleague's sandbox as an upstream to
 * measure production divergence against.
 */
function resolveCandidates(
  entities: EntityService | undefined,
  copyEntityId: string,
  siteEntityId: string | undefined
): UpstreamCandidate[] {
  if (!entities || !siteEntityId) return [];
  return (
    safely(() => {
      const copies = new Set(entities.workingCopiesOf(siteEntityId).map((c) => c.entityId));
      copies.add(copyEntityId);
      return entities
        .environmentsOf(siteEntityId)
        .filter((e) => !copies.has(e.entityId))
        .map((e) => ({
          entityId: e.entityId,
          confidence: e.confidence,
          establishedBy: e.establishedBy,
        }));
    }) ?? []
  );
}

/**
 * Content lineage first, the Site traversal second, decline third.
 *
 * `content_pulled_from` is an OBSERVED pull (`pull_lineage`, written by the
 * WP-14 producer only when a sync actually moved a database), so it outranks
 * any structural link however confident — a `user_link` says two things belong
 * together, not that content came from one of them.
 *
 * The traversal declines on a tie rather than picking. An unordered
 * "first row wins" over two equally-confident environments is not a lookup, it
 * is a coin toss, and the losing side of that toss is a report telling someone
 * their production install is 40 plugins behind.
 */
function resolveUpstream(
  entities: EntityService | undefined,
  copyEntityId: string,
  candidates: UpstreamCandidate[]
): { upstream?: { entityId: string; via: UpstreamVia }; ambiguous: boolean } {
  const lineage = entities
    ? safely(() => entities.linksOf(copyEntityId, 'content_pulled_from')[0])
    : undefined;
  if (lineage) {
    return { upstream: { entityId: lineage.entityId, via: 'content_lineage' }, ambiguous: false };
  }

  if (candidates.length === 0) return { ambiguous: false };
  if (candidates.length === 1) {
    return { upstream: { entityId: candidates[0].entityId, via: 'site_environment' }, ambiguous: false };
  }
  // `environmentsOf` orders by confidence DESC, so a strict win is visible at
  // the head of the list. This IS the site_links precedence the mirror encodes:
  // user_link 1.0 > host_connection 0.95 > name_heuristic 0.5.
  if (candidates[0].confidence > candidates[1].confidence) {
    return { upstream: { entityId: candidates[0].entityId, via: 'site_environment' }, ambiguous: false };
  }
  return { ambiguous: true };
}

// ---------------------------------------------------------------------------
// The anchor
// ---------------------------------------------------------------------------

function resolveAnchor(ledger: Ledger, copyEntityId: string, now: Date): SyncAnchor | undefined {
  const events = syncEvents(ledger, copyEntityId);
  const newest = newestByObservedAt(events);
  return newest ? toAnchor(newest, now) : undefined;
}

interface SyncEventRow {
  id: string;
  observedAt: string;
  topic: string;
  flow: SyncFlow;
  direction: SyncDirection;
  includesDb?: boolean;
  upstreamEntityId?: string;
}

function syncEvents(ledger: Ledger, copyEntityId: string): SyncEventRow[] {
  return (
    safely(() =>
      ledger
        .query({
          topicPrefix: 'episodic.sync.',
          entityId: copyEntityId,
          order: 'desc',
          limit: SYNC_WINDOW,
        })
        .map((e) => {
          const payload = e.payload as Record<string, unknown>;
          const flow = typeof payload.flow === 'string' ? payload.flow : '';
          const direction = payload.direction;
          return {
            id: e.id,
            observedAt: e.observed_at,
            topic: e.topic,
            // Anything the union does not name is `unknown`. A reader must
            // never receive a flow value it cannot render.
            flow: (KNOWN_FLOWS.includes(flow) ? flow : 'unknown') as SyncFlow,
            direction: (direction === 'up' || direction === 'down'
              ? direction
              : 'unknown') as SyncDirection,
            // Absent stays absent. Defaulting to false would say "this pull
            // carried no database", which is a claim, not a gap.
            includesDb:
              typeof payload.includes_db === 'boolean' ? payload.includes_db : undefined,
            upstreamEntityId: e.entity.environment,
          };
        })
    ) ?? []
  );
}

function newestByObservedAt(events: SyncEventRow[]): SyncEventRow | undefined {
  return events.reduce<SyncEventRow | undefined>(
    (best, e) => (!best || e.observedAt > best.observedAt ? e : best),
    undefined
  );
}

function toAnchor(e: SyncEventRow, now: Date): SyncAnchor {
  return {
    eventId: e.id,
    at: e.observedAt,
    ageSeconds: ageSeconds(e.observedAt, now),
    flow: e.flow,
    direction: e.direction,
    includesDb: e.includesDb,
    upstreamEntityId: e.upstreamEntityId,
  };
}

// ---------------------------------------------------------------------------
// Content — time
// ---------------------------------------------------------------------------

function contentDivergence(
  ledger: Ledger,
  copyEntityId: string,
  upstreamEntityId: string | undefined,
  now: Date
): ContentDivergence {
  if (!upstreamEntityId) return { reason: 'no-lineage' };

  // Only a PULL that carried a database made this copy's content equal to the
  // upstream's. A push sends content the other way and does not reset the
  // snapshot's age; a files-only pull moved no content at all; and a sync whose
  // contents could not be determined cannot be claimed as either.
  const pull = newestByObservedAt(
    syncEvents(ledger, copyEntityId).filter(
      (e) => e.topic === 'episodic.sync.pulled' && e.includesDb === true
    )
  );
  if (!pull) return { upstreamEntityId, reason: 'no-recorded-sync' };

  return {
    upstreamEntityId,
    pulledAt: pull.observedAt,
    behindSeconds: ageSeconds(pull.observedAt, now),
  };
}

// ---------------------------------------------------------------------------
// Code — items
// ---------------------------------------------------------------------------

interface CodeSide {
  version?: string;
  active?: boolean;
  fact: TwinFact;
}

function codeDivergence(
  twins: TwinStore,
  copyEntityId: string,
  upstreamEntityId: string | undefined,
  now: Date
): CodeDivergence {
  if (!upstreamEntityId) {
    return { comparedFacts: 0, items: [], ahead: 0, behind: 0, changed: 0, reason: 'no-upstream' };
  }

  const copy = codeFacts(twins, copyEntityId);
  const upstream = codeFacts(twins, upstreamEntityId);
  const keys = [...new Set([...copy.keys(), ...upstream.keys()])].sort();

  const items: CodeItem[] = [];
  for (const key of keys) {
    const a = copy.get(key);
    const b = upstream.get(key);
    if (a && b) {
      if (a.version === b.version && a.active === b.active) continue;
      items.push({
        fact: key,
        copy: { version: a.version, active: a.active },
        upstream: { version: b.version, active: b.active },
        status: 'differs',
        // Activation state is not a direction: a plugin switched off in a copy
        // is neither ahead of nor behind the same version upstream.
        direction: directionOf(a.version, b.version),
      });
    } else if (a) {
      items.push({
        fact: key,
        copy: { version: a.version, active: a.active },
        status: 'only_on_copy',
        direction: 'ahead',
      });
    } else if (b) {
      items.push({
        fact: key,
        upstream: { version: b.version, active: b.active },
        status: 'only_on_upstream',
        direction: 'behind',
      });
    }
  }

  return {
    upstreamEntityId,
    comparedFacts: keys.length,
    items,
    ahead: items.filter((i) => i.direction === 'ahead').length,
    behind: items.filter((i) => i.direction === 'behind').length,
    changed: items.filter((i) => i.direction === 'unknown').length,
    copy: stalest([...copy.values()], twins, now),
    upstream: stalest([...upstream.values()], twins, now),
  };
}

/**
 * One entity's code-flow facts, keyed for comparison.
 *
 * A fact marked `removed` is NOT present: the twin keeps the row so the
 * history survives, but the plugin is gone, and counting it as present would
 * report two sides as matching while one of them has no such plugin at all.
 */
function codeFacts(twins: TwinStore, entityId: string): Map<string, CodeSide> {
  const out = new Map<string, CodeSide>();
  const facts = safely(() => twins.forEntity(entityId)) ?? [];
  for (const fact of facts) {
    const value = (fact.value ?? {}) as Record<string, unknown>;
    if (CODE_FACT_PREFIXES.some((p) => fact.fact.startsWith(p))) {
      if (value.removed === true) continue;
      out.set(fact.fact, {
        version: str(value.version),
        active: typeof value.active === 'boolean' ? value.active : undefined,
        fact,
      });
    } else if (fact.fact === 'site.core') {
      const wp = str(value.wp_version);
      if (wp) out.set(WP_VERSION_KEY, { version: wp, fact });
    }
  }
  return out;
}

/**
 * The stalest participating observation on one side — a comparison is only as
 * trustworthy as its oldest input (the rule `compare_sites` established).
 */
function stalest(sides: CodeSide[], twins: TwinStore, now: Date): SideObservation | undefined {
  if (sides.length === 0) return undefined;
  const oldest = sides.reduce((acc, s) =>
    Date.parse(s.fact.observedAt) < Date.parse(acc.fact.observedAt) ? s : acc
  );
  const f = twins.freshness(oldest.fact, now);
  return {
    observedAt: oldest.fact.observedAt,
    ageSeconds: f.ageSeconds,
    sloSeconds: f.sloSeconds,
    trust: oldest.fact.sourceTrust,
    fresh: f.fresh,
  };
}

/**
 * Which side is newer, when that is knowable. Only plain dotted-numeric
 * versions are compared; anything else (`nightly-b`, `1.0.0-rc2`, a git ref)
 * returns `unknown` and is reported as *changed*. Guessing an order for
 * version strings that do not have one produces a confident "you are behind"
 * about a build that is actually ahead.
 */
function directionOf(a: string | undefined, b: string | undefined): CodeDirection {
  const cmp = compareNumericVersions(a, b);
  if (cmp === undefined || cmp === 0) return 'unknown';
  return cmp > 0 ? 'ahead' : 'behind';
}

const NUMERIC_VERSION = /^v?\d+(\.\d+)*$/;

export function compareNumericVersions(
  a: string | undefined,
  b: string | undefined
): number | undefined {
  if (!a || !b) return undefined;
  if (!NUMERIC_VERSION.test(a) || !NUMERIC_VERSION.test(b)) return undefined;
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function ageSeconds(iso: string, now: Date): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
}

/**
 * A comparator is a diagnostic. A faulty entity service, a locked database or
 * a malformed row must cost the reader that ONE input, never the answer — the
 * non-fatality promise that governs this whole seam.
 */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
