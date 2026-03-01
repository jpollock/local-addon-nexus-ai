import { McpToolResult, NexusServices, LocalSiteInfo } from '../../types';

/**
 * Pre-flight check: site must be running for WP-CLI operations.
 * Returns an error result if the site is not running, or null if OK.
 */
export function requireRunning(site: LocalSiteInfo, services: NexusServices): McpToolResult | null {
  const status = services.localServices!.getSiteStatus(site.id);
  if (status !== 'running') {
    return {
      content: [{
        type: 'text',
        text: `Site "${site.name}" is ${status}. Start it first with local_start_site.`,
      }],
      isError: true,
    };
  }
  return null;
}

export function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function validateSlug(slug: string, label: string): McpToolResult | null {
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return error(`Invalid ${label} slug: "${slug}". Must be lowercase alphanumeric with dashes.`);
  }
  return null;
}
