/**
 * Smart target resolver — given a bare name, determines if it's a local site,
 * WPE install, or linked pair, then renders a header and returns formatted targets.
 */

import { getClient } from './graphql';

export interface ResolvedTarget {
  target: string;
  label: string;
  type: 'local' | 'wpe';
  status: string;
  lastSyncAt: string | null;
  isLive: boolean;
}

export interface TargetResolution {
  name: string;
  matches: ResolvedTarget[];
  isLinked: boolean;
}

/**
 * Returns true if the target already has explicit routing (@local, wpe:, @production, etc.)
 */
export function hasExplicitRouting(target: string): boolean {
  return target.endsWith('@local') || target.startsWith('wpe:') || target.includes('@production') || target.includes('@staging') || target.includes('@development');
}

/**
 * Resolve a bare name and print a header. Returns the match(es) to use.
 * Returns null if no matches found.
 */
export async function resolveTarget(name: string): Promise<TargetResolution | null> {
  const client = getClient();
  try {
    const result = await client.mutate<{ nexusResolveTarget: TargetResolution }>(`
      mutation($name: String!) {
        nexusResolveTarget(name: $name) {
          name
          isLinked
          matches {
            target
            label
            type
            status
            lastSyncAt
            isLive
          }
        }
      }
    `, { name });
    return result.nexusResolveTarget;
  } catch {
    return null;
  }
}

/**
 * Print a resolution header to stderr and return the match(es).
 */
export function printResolutionHeader(resolution: TargetResolution): ResolvedTarget[] {
  const { matches, isLinked } = resolution;

  if (matches.length === 0) return [];

  process.stderr.write(`\n▸ Resolving ${resolution.name}...\n`);

  if (isLinked) {
    process.stderr.write(`  Linked: local ↔ WPE\n`);
  }

  for (const m of matches) {
    const freshness = m.isLive ? 'live' : m.lastSyncAt
      ? `cached ${formatAge(m.lastSyncAt)}`
      : 'cached';
    process.stderr.write(`  ${m.type === 'local' ? 'local' : 'WPE  '} · ${m.status} · ${freshness}\n`);
  }

  process.stderr.write('\n');
  return matches;
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
