/**
 * WP-14 · The sync producer — pulls and pushes become ledger events, and the
 * lineage record stops being a claim.
 *
 * Audit A4: nothing emitted a pull/push event, so the model's "the sync history
 * IS the lineage record" was true only of Local's own store, outside the layer.
 * Worse, for the WP Engine flow Local keeps no durable sync history at all —
 * status + a banner, both ephemeral. Unobserved, a pull leaves no trace
 * anywhere. This module is the observer.
 *
 * SEAM (scouted, recorded in WORK_PACKETS): `OperationTracker`, which taps
 * Local's own IPC and therefore sees UI-initiated syncs as well as tool-
 * initiated ones — the tool handlers enrich the `register()` call they already
 * make, so a caller's authoritative facts are used where they exist and
 * inferred only where they do not.
 *
 * Two rules this file exists to keep:
 *
 *   1. **Only a sync that WORKED writes lineage.** Local reports success and
 *      failure with the identical status; the banner id is the discriminator
 *      (see `TERMINAL_BANNERS`). Recording a failed pull as content lineage
 *      would tell every later reader the copy holds production's content when
 *      it does not — the most damaging fabrication available here.
 *   2. **Ids are FROZEN (ADR-21).** Nothing below derives a new entity for a
 *      site the layer already knows. The working copy and the Site come from
 *      the same `provisionalEntity` helpers every other producer uses (so the
 *      ids are the pre-existing ones by construction), and the UPSTREAM is
 *      RESOLVED through sanctioned aliases only — never derived from an
 *      install name, which is exactly audit A7's defect. An upstream that
 *      cannot be resolved is OMITTED, not invented (the WP-16 precedent:
 *      absent is honest, wrong is not).
 */
import type { IntelligenceCore } from './bootstrap';
import type { SyncDetail, SyncObservation } from '../operation-tracker';
import { environmentEntityId, siteEntityId } from './provisionalEntity';

interface MinimalLogger {
  info: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

/** The one query this module runs against graph.db. */
interface GraphDbLike {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

/** What Local's site record knows about the upstream, for the UI-initiated path. */
export interface HostConnectionRef {
  /** The WPE *site* UUID (`hostConnections[].remoteSiteId`). */
  wpeSiteId?: string;
  /** `hostConnections[].remoteSiteEnv`. */
  environment?: string;
}

export interface SyncProducerDeps {
  core: IntelligenceCore;
  logger: MinimalLogger;
  /** Local's stored WPE link for a site — the UI path's only route upstream. */
  getHostConnection: (siteId: string) => HostConnectionRef | undefined;
  /** graph.db handle, may be absent while the graph initializes. */
  getDb: () => GraphDbLike | null | undefined;
}

/**
 * WP-14's owner question, RULED by the architect when adjudicating it: the
 * union gains `'unknown'` so a sync whose contents could not be determined can
 * say so rather than being filed under a conservative `'code'`. WP-15 renders
 * it ("a sync happened; what it included couldn't be determined").
 *
 * `deriveSyncFacts` below does not currently produce it, and that is not an
 * oversight — at THIS seam the flow genuinely is determined. WP-14's scouting
 * established that Local emits the database phase label under a strict
 * `if (includeSql)` guard and that no other label in either service contains
 * the word, so an absent label means an absent database. The only failure mode
 * is a false NEGATIVE, and only if WP Engine changes that copy. Emitting
 * `'unknown'` for every files-only pull would throw away a sound inference to
 * express a doubt the seam does not actually have.
 *
 * What WOULD produce it: a second observation seam with no equivalent tell (a
 * different sync implementation, a coarser IPC stream), or this one after the
 * label check starts failing. The reader handles the value today, which is
 * also what lets it render an event from a future or foreign producer without
 * guessing.
 */
export type SyncFlow = 'content' | 'code' | 'full' | 'unknown';

/** The producer's decision, exposed for tests and for the lineage step. */
export interface SyncFacts {
  flow: SyncFlow;
  includesDb: boolean;
  direction: 'up' | 'down';
}

/**
 * Content flows DOWN, code flows UP (model §3). `flow` names WHAT moved:
 * `full` = files and database, `content` = database only, `code` = files only.
 *
 * A caller's declaration always wins; the observed database phase can only
 * turn `includesDb` ON. A UI-initiated sync always rsyncs files — Local offers
 * no files-skipped option; `databaseOnly` is a Nexus-tool construction
 * (`isMagicSync` + an empty file list) and so can only arrive declared.
 */
export function deriveSyncFacts(observation: SyncObservation): SyncFacts {
  const detail: SyncDetail = observation.detail ?? {};
  const includesDb = detail.includesDb ?? observation.databasePhaseObserved;
  const filesSynced = detail.databaseOnly !== true;
  return {
    includesDb,
    flow: includesDb ? (filesSynced ? 'full' : 'content') : 'code',
    direction: observation.type === 'pull' ? 'down' : 'up',
  };
}

/**
 * Build the tracker listener. Non-fatal by construction: every path is wrapped,
 * and a failure here can only cost the observation, never the sync.
 */
export function createSyncObserver(deps: SyncProducerDeps): (o: SyncObservation) => void {
  const { core, logger } = deps;

  return (observation: SyncObservation): void => {
    try {
      // Rule 1. A failed sync moved nothing; there is no fact to record.
      if (observation.outcome !== 'succeeded') return;

      const facts = deriveSyncFacts(observation);
      // `observed_at` is when the fact was true at its source: the moment the
      // sync finished, which is when the copy actually held the new content.
      // Never `recorded_at`, and never the start time.
      const observedAt = new Date(observation.finishedAt).toISOString();

      // Rule 2. Both of these ADOPT the pre-existing ids — `ensure()` derives
      // from the same (namespace, value) every other producer already used for
      // this Local site, so no entity is created for a site the layer knows.
      const workingCopy = environmentEntityId(core.entities, observation.siteId);
      const site = resolveSite(core, workingCopy, observation.siteId);
      const upstream = resolveUpstreamEnv(deps, observation);

      core.emitter.emit({
        observed_at: observedAt,
        topic: observation.type === 'pull' ? 'episodic.sync.pulled' : 'episodic.sync.pushed',
        schema: 'sync.observed/1',
        entity: {
          site,
          ...(upstream ? { environment: upstream } : {}),
          working_copy: workingCopy,
        },
        actor: { id: 'act_local_sync', kind: 'system' },
        source: { class: 'platform', system: 'sync:wpe', trust: 'observed' },
        payload: {
          flow: facts.flow,
          direction: facts.direction,
          includes_db: facts.includesDb,
        },
      });

      // NO CHANGE GATE, deliberately — and this is not the pattern's cp.dedup
      // being skipped. The gate compares a value against `twin_facts`; an
      // episodic occurrence folds into no twin and HAS no current value. Two
      // identical pulls are two pulls, and collapsing them would erase the very
      // record this packet exists to create.
      writeLineage(deps, observation, facts, upstream, workingCopy, observedAt);
      core.scheduleFolds();
    } catch (err) {
      logger.error(`[Intelligence] sync producer failed (non-fatal): ${(err as Error).message}`);
    }
  };
}

/**
 * The lineage pointer. `content_pulled_from` is the copy's CONTENT upstream, so
 * it moves only when content actually moved — a files-only pull carries no
 * database and changes no content lineage.
 *
 * A PUSH never moves it either: the copy's content lineage is "the environment
 * it was pulled FROM, at that time" (model §2). Pushing sends the copy's
 * content upward; it does not change where the copy's content came from.
 *
 * WP-14 FINDING — the packet (and audit A4) said "the PK upserts, so the
 * pointer MOVES". It does not, in the case that matters. The PK is
 * (from, to, kind): re-pulling from the SAME environment upserts, but pulling
 * from a DIFFERENT one INSERTS, leaving the copy claiming two content
 * upstreams at once. Hence `linkExclusive`, which retires the copy's other
 * content upstream as it writes the new one — that is what actually delivers
 * the per-flow MOVING pointer the three-layer model requires.
 */
function writeLineage(
  deps: SyncProducerDeps,
  observation: SyncObservation,
  facts: SyncFacts,
  upstream: string | undefined,
  workingCopy: string,
  observedAt: string,
): void {
  if (observation.type !== 'pull' || !facts.includesDb) return;
  // Nothing to point AT. Emitting the event without the edge is the honest
  // half-record; inventing an upstream entity to complete it is not.
  if (!upstream || !deps.core.entities) return;
  try {
    deps.core.entities.linkExclusive(
      workingCopy,
      upstream,
      'content_pulled_from',
      1.0,
      'pull_lineage',
      observedAt,
    );
  } catch (err) {
    deps.logger.error(
      `[Intelligence] sync lineage link failed (non-fatal): ${(err as Error).message}`,
    );
  }
}

/**
 * The logical Site this copy belongs to — TRAVERSED first, derived last.
 *
 * The traversal is not a nicety, it is the id freeze. `siteEntityId` derives
 * `local.site_id.logical`, which is the right entity for an UNMIRRORED local
 * site (every webhook event from it already carries that id) and the WRONG one
 * for a mirrored site, whose Site the mirror keyed by `wpe.site_id`. Deriving
 * unconditionally would mint a second Site beside the real one on the first
 * pull — the split this packet exists to prevent, in the packet that prevents
 * it. The fallback is adoption rather than invention: same id the other local
 * producers already stamp, so nothing diverges.
 */
function resolveSite(core: IntelligenceCore, workingCopy: string, localSiteId: string): string {
  try {
    const traversed = core.entities?.siteOf(workingCopy);
    if (traversed) return traversed;
  } catch {
    /* a faulty entity service must never break a producer */
  }
  return siteEntityId(core.entities, localSiteId);
}

/**
 * Resolve the upstream environment entity. RESOLVE ONLY — every rung is a read
 * against aliases `siteLinkMirror` wrote, and the ladder ends in `undefined`
 * rather than a derivation (audit A7).
 *
 * Rungs, in evidence order:
 *   1. `wpe.install_id`   — a caller-declared install UUID
 *   2. `wpe.install_name` — a caller-declared install name (callers address
 *      installs both ways; see the WPE install-pattern pitfall)
 *   3. the graph row id, recovered from Local's OWN stored link
 *      (`hostConnections.remoteSiteId` + `remoteSiteEnv`) — the only route
 *      available to a UI-initiated sync, and the one that lands on the same
 *      entity the mirror aliased under `graph.site_row`.
 */
function resolveUpstreamEnv(
  deps: SyncProducerDeps,
  observation: SyncObservation,
): string | undefined {
  const entities = deps.core.entities;
  if (!entities) return undefined;
  const detail: SyncDetail = observation.detail ?? {};

  const handles: Array<[string, string | undefined]> = [
    ['wpe.install_id', detail.installId],
    ['wpe.install_name', detail.installName],
  ];
  for (const [namespace, value] of handles) {
    const resolved = resolveEnv(entities, namespace, value);
    if (resolved) return resolved;
  }

  const rowId = graphRowForUpstream(deps, observation, detail);
  return (
    resolveEnv(entities, 'graph.site_row', rowId) ?? resolveEnv(entities, 'local.site_id', rowId)
  );
}

/**
 * graph `sites.id` for the install this sync moves against, via the WPE site
 * UUID + environment Local stores on the site. Read-only; returns nothing
 * rather than guessing when the pair does not identify exactly one row.
 */
function graphRowForUpstream(
  deps: SyncProducerDeps,
  observation: SyncObservation,
  detail: SyncDetail,
): string | undefined {
  const wpeSiteId = detail.wpeSiteId ?? deps.getHostConnection(observation.siteId)?.wpeSiteId;
  const environment =
    detail.environment ?? deps.getHostConnection(observation.siteId)?.environment;
  if (!wpeSiteId || !environment) return undefined;
  try {
    const db = deps.getDb();
    if (!db) return undefined;
    const row = db
      .prepare(
        `SELECT id FROM sites
          WHERE source = 'wpe' AND is_active = 1 AND wpe_site_id = ? AND environment = ?`,
      )
      .get(wpeSiteId, environment) as { id?: string } | undefined;
    return row?.id;
  } catch (err) {
    deps.logger.error(
      `[Intelligence] sync producer: graph read failed (non-fatal): ${(err as Error).message}`,
    );
    return undefined;
  }
}

/** Highest-confidence ENV entity carrying this alias, or nothing. */
function resolveEnv(
  entities: NonNullable<IntelligenceCore['entities']>,
  namespace: string,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    return entities
      .resolve(value, namespace)
      .filter((c) => c.type === 'env')
      .sort((a, b) => b.matchedAlias.confidence - a.matchedAlias.confidence)[0]?.entityId;
  } catch {
    return undefined; // a faulty entity service must never break a producer
  }
}
