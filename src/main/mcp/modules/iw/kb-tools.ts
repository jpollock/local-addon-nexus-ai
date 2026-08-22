import { McpToolHandler, McpToolResult } from '../../types';
import { resolveLocalSite } from '../../site-resolver';
import { ok, error } from '../wp-cli/preflight';
import { readIwBinding } from './hub-connect';
import { getApiKey } from '../../../security/KeyVault';
import type { IwSiteBinding } from '../../../../common/types';
import { STORAGE_KEYS } from '../../../../common/constants';

/**
 * Resolve an IW binding by local site name/ID OR WPE install name.
 * Local sites are resolved via resolveLocalSite; WPE installs are keyed
 * by install name in IW_SITE_BINDINGS (populated by wpe_site_deep_refresh).
 */
function resolveIwBinding(
  siteArg: string,
  services: any,
): { binding: IwSiteBinding | null; label: string } {
  const registryStorage = services.registryStorage;
  // Try local site first
  const localSite = resolveLocalSite(siteArg, services.siteData, services.graphService);
  if (localSite) {
    return { binding: readIwBinding(localSite.id, registryStorage!), label: localSite.name };
  }
  // Fall back: treat arg as a WPE install name
  const bindings = (registryStorage?.get(STORAGE_KEYS.IW_SITE_BINDINGS) ?? {}) as Record<string, IwSiteBinding>;
  const binding = bindings[siteArg] ?? null;
  return { binding, label: siteArg };
}

const KB_BASE = 'https://api.ai.wpengine.com/v1';

async function kbFetch(path: string, apiKey: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`${KB_BASE}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`KB API ${res.status}: ${body}`);
  }
  return res.json();
}

export const iwListKbCollectionsHandler: McpToolHandler = {
  definition: {
    name: 'iw_list_kb_collections',
    description:
      'List Knowledge Base collections for the Power project associated with a site. ' +
      'Accepts a local site name/ID or a WPE install name (e.g. "myloop"). ' +
      'WPE install bindings are populated automatically by wpe_site_deep_refresh. ' +
      'Nexus reads collections only — it does not create or sync them (Hub Plugin owns that).',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { binding, label } = resolveIwBinding(args.site as string, services);
    if (!binding?.projectId) return error(
      `No Power connection found for "${args.site}". ` +
      `For local sites run iw_connect_site; for WPE installs run wpe_site_deep_refresh first.`
    );

    const registryStorage = services.registryStorage;
    const apiKey = getApiKey(registryStorage!, 'power') ?? '';
    if (!apiKey) return error('No Power API key configured. Add your wpe_ key in Nexus Preferences.');

    try {
      const data = await kbFetch(`/kb/collections?project_id=${encodeURIComponent(binding.projectId)}`, apiKey);
      const collections: any[] = data.collections ?? data.items ?? [];
      if (!collections.length) return ok(`No KB collections found for project ${binding.projectId}.`);

      const lines = [`KB Collections — ${label} (project: ${binding.projectId}):`];
      for (const c of collections) {
        lines.push(`  ${c.id}  ${c.name ?? ''}  [${c.status ?? 'unknown'}]  ${c.document_count ?? '?'} docs`);
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return error(`KB API error: ${String(err.message ?? err)}`);
    }
  },
};

export const iwGetKbCollectionHandler: McpToolHandler = {
  definition: {
    name: 'iw_get_kb_collection',
    description: 'Get details for a specific Knowledge Base collection.',
    inputSchema: {
      type: 'object',
      properties: {
        site:          { type: 'string', description: 'Local site name, ID, or domain' },
        collection_id: { type: 'string', description: 'KB collection ID' },
      },
      required: ['site', 'collection_id'],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const apiKey = getApiKey(services.registryStorage!, 'power') ?? '';
    if (!apiKey) return error('No Power API key configured.');

    try {
      const data = await kbFetch(`/kb/collections/${encodeURIComponent(args.collection_id as string)}`, apiKey);
      return ok(JSON.stringify(data, null, 2));
    } catch (err: any) {
      return error(`KB API error: ${String(err.message ?? err)}`);
    }
  },
};

export const iwSearchKbHandler: McpToolHandler = {
  definition: {
    name: 'iw_search_kb',
    description:
      'Search a Knowledge Base collection using raw vector similarity — returns the closest ' +
      'matching chunks with titles, URIs, and excerpts. This is a retrieval primitive: it finds ' +
      'relevant content but does not synthesize or reason over it. For synthesized answers with ' +
      'citations (like the Hub Agent provides), pass the results to an LLM with your query. ' +
      'Use this to build retrieve→reason→respond flows in agents.',
    inputSchema: {
      type: 'object',
      properties: {
        site:          { type: 'string', description: 'Local site name, ID, or domain' },
        collection_id: { type: 'string', description: 'KB collection ID to search' },
        query:         { type: 'string', description: 'Search query' },
        top_k:         { type: 'number', description: 'Max results to return (default: 5)' },
      },
      required: ['site', 'collection_id', 'query'],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const apiKey = getApiKey(services.registryStorage!, 'power') ?? '';
    if (!apiKey) return error('No Power API key configured.');

    try {
      const body = { query: args.query, top_k: args.top_k ?? 5 };
      const data = await kbFetch(
        `/kb/collections/${encodeURIComponent(args.collection_id as string)}/search`,
        apiKey,
        { method: 'POST', body: JSON.stringify(body) },
      );
      // Power KB search returns { citations: [...] } — field may vary by API version
      const results: any[] = data.citations ?? data.results ?? data.items ?? [];
      if (!results.length) return ok('No results found.');

      const lines = [`KB Search results for "${args.query}" in ${args.collection_id}:`];
      for (const r of results) {
        const score = r.score?.toFixed(3) ?? '?';
        const title = r.title ?? r.id ?? '(untitled)';
        const uri = r.uri ?? r.metadata?.url ?? '';
        // snippets is an array of strings; content is a flat string
        const snippet = Array.isArray(r.snippets)
          ? r.snippets[0]?.slice(0, 200).replace(/\n/g, ' ')
          : String(r.content ?? '').slice(0, 200).replace(/\n/g, ' ');
        lines.push(`\n  [${score}] ${title}`);
        if (uri) lines.push(`  ${uri}`);
        if (snippet) lines.push(`  ${snippet}`);
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return error(`KB API error: ${String(err.message ?? err)}`);
    }
  },
};
