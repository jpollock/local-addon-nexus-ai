/**
 * WP-21 · The task frame, built host-side (ADR-21 layers, ADR-22 routing).
 *
 * The frame says WHERE the actor is standing — the copy, the Site it belongs to,
 * and the live site if anything on record says which environment that is — so
 * `assemble()` can route each type of intelligence to its own home and the actor
 * never routes anything (ADR-22).
 *
 * Why it is built here rather than in the core: two of the three slots need
 * knowledge only the host has. The Site and the tracked environment come from
 * the entity links (core), but *which environment is the live site* is a fact of
 * the graph's `sites.environment` column, and the seam (ADR-16) keeps the core
 * out of `src/main`. The core gets a resolved frame; it never looks anything up.
 *
 * Three rules govern every line below.
 *
 * **1 · It reads. It never mints.** ADR-21 froze entity ids, and audit A7 is the
 * live defect that happens when a read path calls `ensure()`. Callers hand in the
 * id they already have (chat, which ensures on its own producer path) or a pure
 * derivation (`provisionalEnvironmentId`); nothing here registers anything.
 *
 * **2 · `production` is evidence, not inference.** Being the only other place a
 * copy could be compared with is not evidence of carrying an audience. If nothing
 * says which environment is the live site, the slot stays empty and the planes
 * that would have routed there disclose the fallback — a staging install silently
 * labelled "the live site" is a wrong answer wearing the right disclosure.
 *
 * **3 · A LOCAL graph row's `environment` is not a WP Engine environment.**
 * `GraphService` backfills `environment = 'development' WHERE host = 'local'`, so
 * every Local site claims to be a development environment. It is a working copy.
 * Carrying that value through would tell a user their own copy is a shared space
 * at WP Engine — the exact collision docs finding №6 names.
 */
import { resolveLineage, EntityRef, TaskFrame, UpstreamVia } from '../../intelligence';
import { provisionalEnvironmentId } from './provisionalEntity';
import type { IntelligenceCore } from './bootstrap';
import type { NexusServices } from '../mcp/types';

/** WP Engine's three environments — the only values that name one. */
export type EnvironmentKind = 'production' | 'staging' | 'development';

/** What the host can say about an environment entity, in facts not in prose. */
export interface EnvironmentDescription {
  /** The name the user already knows this place by. Never an id. */
  name?: string;
  /** Which environment this is, when something on record says. */
  kind?: EnvironmentKind;
  /** Where it runs — `staging` at WP Engine and a client's own staging box are
   *  different sentences, and only one of them is "at WP Engine". */
  host?: 'wpe' | 'external';
}

export type DescribeEnvironment = (entityId: string) => EnvironmentDescription | undefined;

export interface TaskFrameRequest {
  core: IntelligenceCore;
  /** The copy's entity id. Supplied, never derived here — see rule 1. */
  copyEntityId: string;
  /**
   * The Site entity to route episodic retrieval at. Callers that already stamp a
   * Site role on their events pass theirs, because that is the id their history
   * is keyed by; omit it and the links answer instead.
   */
  siteEntityId?: string;
  /** What the user calls this copy. */
  label: string;
  describeEnvironment?: DescribeEnvironment;
}

/** The place this copy follows, named — the content line's source. */
export interface TrackedEnvironment {
  entityId: string;
  via: UpstreamVia;
  name?: string;
  kind?: EnvironmentKind;
  host?: 'wpe' | 'external';
}

export interface TaskFrameResult {
  frame: TaskFrame;
  /** What the copy tracks, when the links say. Distinct from `frame.production`. */
  tracks?: TrackedEnvironment;
  /** True when places existed but none outranked the rest — a decline, not a fault. */
  ambiguous: boolean;
  /** How many places this copy's Site could be compared against. */
  candidateCount: number;
}

export function buildTaskFrame(req: TaskFrameRequest): TaskFrameResult {
  const { core, copyEntityId, label, describeEnvironment } = req;
  const entities = core.entities;

  const lineage = resolveLineage(copyEntityId, entities);
  const siteEntityId = req.siteEntityId ?? lineage.siteEntityId;

  const tracks = lineage.upstream
    ? {
        entityId: lineage.upstream.entityId,
        via: lineage.upstream.via,
        ...describeEnvironment?.(lineage.upstream.entityId),
      }
    : undefined;

  const production = liveSiteAmong(
    [
      ...(lineage.upstream ? [lineage.upstream.entityId] : []),
      ...lineage.candidates.map((c) => c.entityId),
    ],
    describeEnvironment
  );

  const frame: TaskFrame = {
    workingCopy: { role: 'working_copy', id: copyEntityId, label },
    ...(siteEntityId
      ? { site: { role: 'site', id: siteEntityId, label } satisfies EntityRef }
      : {}),
    ...(production ? { production } : {}),
  };

  return {
    frame,
    tracks,
    ambiguous: lineage.ambiguous,
    candidateCount: lineage.candidates.length,
  };
}

/**
 * The one environment something on record calls the live site.
 *
 * Declines on more than one: two installs both described as production is a
 * disagreement in the host's own data, and picking the first would make the
 * choice invisible. Audience questions then disclose that no live site is
 * connected, which is true, rather than being answered from a coin toss.
 */
function liveSiteAmong(
  entityIds: readonly string[],
  describe?: DescribeEnvironment
): EntityRef | undefined {
  if (!describe) return undefined;
  const live: EntityRef[] = [];
  const seen = new Set<string>();
  for (const id of entityIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    let described: EnvironmentDescription | undefined;
    try {
      described = describe(id);
    } catch {
      described = undefined; // a faulty describer costs the slot, not the frame
    }
    if (described?.kind === 'production') {
      live.push({ role: 'environment', id, ...(described.name ? { label: described.name } : {}) });
    }
  }
  return live.length === 1 ? live[0] : undefined;
}

/**
 * A describer over the graph's own site rows.
 *
 * The join is the derivation both sides already agree on: `siteLinkMirror`
 * registers every WPE row as `ensure('env','local.site_id', row.id)`, and
 * `provisionalEnvironmentId` is the pure half of that same derivation — so
 * mapping forward from rows lands on the entity ids the ledger already holds,
 * without a reverse alias lookup and without minting anything.
 *
 * Returns `undefined` (rather than an empty describer) when the graph cannot be
 * read: no describer means "nothing says which place is the live site", which is
 * the honest state and the one the frame already handles.
 */
export async function describeEnvironmentsFor(
  services: NexusServices
): Promise<DescribeEnvironment | undefined> {
  try {
    const graph = (services as { graphService?: { listSites?: (o?: unknown) => Promise<unknown[]> } })
      .graphService;
    if (!graph?.listSites) return undefined;
    const rows = (await graph.listSites({ active_only: true })) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return undefined;

    const byEntity = new Map<string, EnvironmentDescription>();
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id : undefined;
      if (!id) continue;
      const source = row.source === 'wpe' ? 'wpe' : row.source === 'external' ? 'external' : undefined;
      const kind = row.environment;
      byEntity.set(provisionalEnvironmentId(id), {
        ...(typeof row.name === 'string' && row.name ? { name: row.name } : {}),
        // Rule 3: only a remote row's column names an environment. A local row's
        // backfilled 'development' describes a copy, not a place at WP Engine.
        ...(source && isEnvironmentKind(kind) ? { kind, host: source } : {}),
      });
    }
    return (entityId: string) => byEntity.get(entityId);
  } catch {
    return undefined;
  }
}

function isEnvironmentKind(value: unknown): value is EnvironmentKind {
  return value === 'production' || value === 'staging' || value === 'development';
}
