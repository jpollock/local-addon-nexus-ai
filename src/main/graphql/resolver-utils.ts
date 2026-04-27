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

/**
 * Parsed representation of a target string passed by the CLI.
 *
 * Supported formats:
 *   - `mysite`                              → local, name = mysite
 *   - `mysite@local`                        → local, name = mysite
 *   - `wpe:account/install@environment`     → wpe
 */
export interface ParsedTarget {
  type: 'local' | 'wpe';
  siteName?: string;
  installName?: string; // For WPE: "account/install" format
  environment?: string;
  account?: string;
  installId?: string;
}

// ---------------------------------------------------------------------------
// Target parser
// ---------------------------------------------------------------------------

export function parseTarget(target: string): ParsedTarget {
  // mysite@local
  if (target.endsWith('@local')) {
    return {
      type: 'local',
      siteName: target.replace('@local', ''),
    };
  }

  // wpe:account/install@environment
  const wpeMatch = target.match(/^wpe:(.+?)\/(.+?)@(production|staging|development)$/);
  if (wpeMatch) {
    return {
      type: 'wpe',
      account: wpeMatch[1],
      installName: wpeMatch[2],
      environment: wpeMatch[3],
    };
  }

  // Incomplete WPE target (starts with wpe: but missing @environment)
  if (target.startsWith('wpe:')) {
    throw new Error(
      `Incomplete WPE target: ${target}. Expected wpe:account/install@environment`
    );
  }

  // Plain name (no @) — treat as local, resolved later by resolveSite()
  if (!target.includes('@')) {
    return {
      type: 'local',
      siteName: target,
    };
  }

  throw new Error(
    `Invalid target syntax: ${target}. Expected 'mysite', 'mysite@local', or 'wpe:account/install@environment'`
  );
}

// ---------------------------------------------------------------------------
// Site resolution
// ---------------------------------------------------------------------------

/**
 * Find a local site by name, ID, or domain from Local's siteData store.
 */
export function resolveSite(identifier: string, siteData: NexusServices['siteData']): ReturnType<NexusServices['siteData']['getSites']>[string] | undefined {
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

  const rows = db.prepare("SELECT * FROM sites WHERE source='wpe'").all() as Record<string, unknown>[];
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

export function buildWpeSiteDetails(
  graphSite: Record<string, unknown>,
  twin: TwinData | null,
  twinAge: string | null
): Record<string, unknown> {
  return {
    id: graphSite.id,
    name: graphSite.name,
    domain: graphSite.domain ?? graphSite.remote_domain ?? null,
    path: '',
    status: 'remote',
    siteKind: 'wpe',
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
