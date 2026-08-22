/**
 * Shared helpers for GraphQL resolvers.
 *
 * These utilities were previously defined inline in resolvers.ts.
 * They are extracted here so each domain module can import them without
 * duplicating logic.
 */

import type { NexusServices } from '../types/nexus-services';
import type { GraphService } from '../events/GraphService';
import PQueue from 'p-queue';
import { parseTarget as parseTargetShared } from '../../common/target';
import { toSiteSource } from '../../common/types';
export type { ParsedTarget } from '../../common/target';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The unused first argument of every GraphQL resolver (parent object).
 * GraphQL passes null for root mutations, so this accepts null/undefined too.
 */
export type ResolverParent = Record<string, unknown> | null | undefined;

/**
 * The context object threaded through every resolver call.
 */
export interface ResolverContext {
  registry: import('../mcp/tool-registry').ToolRegistry;
  services: NexusServices;
}

/** Server-side parsing keeps the terse legacy error text (user-visible via GraphQL). */
export function parseTarget(target: string) {
  return parseTargetShared(target);
}

// ---------------------------------------------------------------------------
// Site resolution
// ---------------------------------------------------------------------------

/**
 * Find a local site by EXACT name, ID, or domain from Local's siteData store.
 *
 * ── WP-58: the name states every way this differs from `resolveLocalSite` ───
 * This was `resolveSite`, and so was `mcp/site-resolver.ts`'s — two exported
 * functions of the same name, in one repo, disagreeing about case-sensitivity,
 * with a third private copy of THIS one living in `resolvers.ts` and serving
 * every live GraphQL and CLI site lookup. Whichever one a reader had in mind
 * was a coin toss of its own.
 *
 * There is now one function per behaviour and the name says which:
 *
 *   - `findLocalSiteExact` (here) — Local store only, **case-SENSITIVE**, no
 *     collision decline. Every GraphQL/CLI resolver in `resolvers.ts` and
 *     `resolvers/sites.ts`.
 *   - `resolveLocalSite` (`mcp/site-resolver.ts`) — Local store only,
 *     case-INsensitive, and it REFUSES a name that also names a site in the
 *     graph.
 *
 * They are not merged, deliberately. Folding this into `resolveLocalSite`
 * would make every GraphQL and CLI site lookup case-insensitive as a side
 * effect of a packet about something else — `resolveTargetArgs`'s M11 comment
 * exists precisely because these two disagree about case, and re-deciding it
 * needs a packet that measures it.
 *
 * **The residual is real and registered:** the GraphQL path still has no
 * collision decline, so a bare name that means both a Local site and a WP
 * Engine install still resolves to the copy here. `resolveTargetArgs` catches
 * that before most CLI targets reach these resolvers; nothing catches it for a
 * caller that reaches them directly.
 */
export function findLocalSiteExact(identifier: string, siteData: NexusServices['siteData']): ReturnType<NexusServices['siteData']['getSites']>[string] | undefined {
  const sites = Object.values(siteData.getSites());
  return sites.find((s) =>
    s.name === identifier ||
    s.id === identifier ||
    s.domain === identifier
  );
}

/**
 * Find a WPE site row in the knowledge graph by name or domain.
 * Returns null when the graph is unavailable or no match is found.
 */
export function resolveWpeGraphSite(query: string, graphService: GraphService | undefined): Record<string, unknown> | null {
  if (!graphService?.getDb?.()) return null;
  const db = graphService.getDb();
  if (!db) return null;
  const q = query.toLowerCase();

  // All three sources — matches resolvers.ts's copy. A bare name can be a WPE
  // install, an external SSH alias, or an indexed Local site.
  const rows = db.prepare("SELECT * FROM sites WHERE source IN ('local','wpe','external')").all() as Record<string, unknown>[];
  const byName = rows.find((r) => (r.name as string)?.toLowerCase() === q);
  if (byName) return byName;
  const byDomain = rows.find(
    (r) =>
      (r.domain as string)?.toLowerCase() === q ||
      (r.remote_domain as string)?.toLowerCase() === q
  );
  if (byDomain) return byDomain;
  const partial = rows.find((r) => (r.name as string)?.toLowerCase().includes(q));
  return partial ?? null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatTwinAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// WPE graph site → SiteDetails shape
// ---------------------------------------------------------------------------

export interface PluginEntry {
  name: string;
  title?: string;
  status?: string;
}

export interface TwinData {
  wpVersion?: string | null;
  phpVersion?: string | null;
  mysqlVersion?: string | null;
  siteUrl?: string | null;
  adminEmail?: string | null;
  activeTheme?: string | null;
  plugins?: PluginEntry[];
  /** Filesystem-only plugins: just slugs (string[]) or full entries. */
  installedPlugins?: PluginEntry[] | string[];
  postCount?: number | null;
  lastPostAt?: string | number | null;
  completeness?: string;
  asOf?: number | null;
}

/**
 * Report the source the graph row actually carries. Hardcoding `'wpe'` made
 * `nexus sites get <alias>` label an external SSH host a WP Engine environment.
 */
export function buildWpeSiteDetails(
  graphSite: Record<string, unknown>,
  twin: TwinData | null,
  twinAge: string | null
): Record<string, unknown> {
  const siteKind = toSiteSource(graphSite.source as string | null | undefined);
  return {
    id: graphSite.id,
    name: graphSite.name,
    domain: graphSite.domain ?? graphSite.remote_domain ?? null,
    path: '',
    // A local-source row reached here only because the site is absent from
    // Local's store, so no running/halted status is known for it.
    status: siteKind === 'local' ? 'unknown' : 'remote',
    siteKind,
    wpVersion:            twin?.wpVersion ?? graphSite.wp_version ?? null,
    phpVersion:           twin?.phpVersion ?? graphSite.php_version ?? null,
    mysqlVersion:         null,
    siteUrl:              twin?.siteUrl ?? graphSite.remote_domain ?? graphSite.domain ?? null,
    adminEmail:           null,
    activeTheme:          twin?.activeTheme ?? null,
    activePluginCount:    twin?.plugins?.filter((p) => p.status === 'active').length ?? null,
    installedPluginCount: twin?.plugins?.length ?? null,
    postCount:            twin?.postCount ?? null,
    lastPostAt:           null,
    twinCompleteness:     twin?.completeness ?? 'none',
    twinAge,
    indexed: false,
    indexedAt: null,
    documentCount: 0,
    chunkCount: 0,
    linkedTo: null,
  };
}

// ---------------------------------------------------------------------------
// Resolver concurrency queue
// ---------------------------------------------------------------------------

/** Global concurrency limiter — caps expensive resolver handlers at 3 concurrent. */
export const resolverQueue = new PQueue({ concurrency: 3 });

/**
 * Run an expensive resolver body inside the global concurrency queue.
 * Does not change resolver return shapes or error behavior.
 */
export function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  return resolverQueue.add(fn) as Promise<T>;
}
