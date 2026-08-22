import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { resolveAnySite } from '../../site-resolver';
import { indexFreshnessWarning } from '../../../twin/twin-helpers';
import { vectorSiteId } from '../../../vector-store/vectorSiteId';
import { WPE_SYNC_REMEDY_CONTENT, WPE_SYNC_REMEDY_METADATA } from '../wpe/sync-remedy';
import type { MetadataFilter } from '../../../../common/types';

export function formatCustomFields(metadataJson: string): string {
  let meta: any;
  try { meta = JSON.parse(metadataJson); } catch { return ''; }
  const cf = meta?.customFields;
  if (!cf || typeof cf !== 'object') return '';
  const entries = Object.entries(cf)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : String(v)}`);
  return entries.length ? `   fields: ${entries.join(', ')}` : '';
}

export function coerceMetadataFilters(raw: unknown): MetadataFilter[] | undefined {
  let val = raw;
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t) return undefined;
    try { val = JSON.parse(t); } catch { return undefined; }
  }
  if (!Array.isArray(val)) return undefined;
  // keep only well-formed filters
  const out = val.filter(
    (f) => f && typeof f === 'object' && typeof (f as any).field === 'string'
      && typeof (f as any).op === 'string' && 'value' in (f as any),
  ) as MetadataFilter[];
  return out.length ? out : undefined;
}

export const searchContentHandler: McpToolHandler = {
  definition: {
    name: 'search_site_content',
    description:
      'Search a single site\'s indexed content using semantic similarity — understands meaning, not just keywords. ' +
      '"Optimize images" also matches posts about compression, WebP, lazy loading, and CDN. ' +
      'The site must be indexed — run reindex_site if results are missing or stale. ' +
      'For searching across all sites simultaneously, use search_across_sites. ' +
      'Works for both local sites (by name/domain) and WPE installs (by install name, e.g. "localwpe"). ' +
      `WPE install content is not indexed by reindex_site, which is local-only. ${WPE_SYNC_REMEDY_CONTENT} ` +
      'Returns ranked results with titles, excerpts, relevance scores, and customFields (when indexed). ' +
      'For attribute/constraint questions (e.g. "easy", "under $20", "in <region>", a range or category), ' +
      'first call describe_site_fields to see the site\'s structured fields, then search here with ' +
      'searchMode:"hybrid", postType, and metadataFilters:[{field,op,value}] (op ∈ eq|ne|lt|lte|gt|gte|contains).',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain to search',
        },
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 5, max: 20)',
        },
        postType: {
          type: 'string',
          description: 'Filter by post type (e.g., "post", "page", "product", "attachment")',
        },
        min_score: {
          type: 'number',
          description: 'Minimum relevance score (0-1). Results below this are filtered out. Default: 0.3',
        },
        searchMode: {
          type: 'string',
          description: 'Search mode: "semantic" (vector only, default), "hybrid" (vector + BM25 + metadata), "keyword" (BM25 only)',
          enum: ['semantic', 'hybrid', 'keyword'],
        },
        metadataFilters: {
          type: 'array',
          description: 'Generic structured filters over indexed custom fields. Each: {field, op, value}. op ∈ eq/ne/lt/lte/gt/gte/contains. All must pass (AND). Missing field fails closed.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: ['eq','ne','lt','lte','gt','gte','contains'] },
              value: { type: ['string','number'] },
            },
            required: ['field','op','value'],
          },
        },
      },
      required: ['site', 'query'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    // M14: names collide across sources, so an unordered `LIMIT 1` returns
    // whichever row SQLite happens to reach first. Decline rather than guess.
    //
    // WP-58: this used to run local-first and only reach the graph on a MISS,
    // so the M14 decline covered two WPE installs colliding with each other
    // and NOT the local-vs-remote case the rule exists for. `resolveAnySite`
    // consults both stores before answering and owns the one policy — it also
    // accepts the qualified forms (`wpe:…@env`, `ssh:…@env`) this tool
    // previously rejected, which is what makes the decline actionable.
    const resolved = resolveAnySite(args.site as string, services.siteData, (services as any).graphService);

    if (resolved.kind === 'none') {
      // "Not found" here means no ROW, which is a metadata problem — the
      // content remedy cannot help a site the graph has never heard of.
      return error(`Site "${args.site}" not found. For WPE installs, use the install name (e.g. "testjpp1"). ${WPE_SYNC_REMEDY_METADATA}`);
    }
    if (resolved.kind === 'ambiguous') {
      return error(
        `"${args.site}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`
      );
    }
    const siteId = resolved.id;
    const siteName = resolved.name;

    const indexEntry = services.indexRegistry.get(siteId);
    if (!indexEntry || indexEntry.state === 'error') {
      return error(`Site "${siteName}" is not indexed. Start the site to trigger indexing.`);
    }

    const queryVector = await services.embeddingService.embed(args.query as string);
    const limit = Math.min(Math.max((args.limit as number) || 5, 1), 20);

    // vectorSiteId: external ids are `ssh:<alias>`; the vector store stores them
    // colon-free. No-op for local/WPE ids, so applied unconditionally.
    const results = await services.vectorStore.search(vectorSiteId(siteId), queryVector, {
      limit,
      postType: args.postType as string | undefined,
      relevanceFloor: args.min_score as number | undefined,
      searchMode: args.searchMode as 'semantic' | 'hybrid' | 'keyword' | undefined,
      metadataFilters: coerceMetadataFilters(args.metadataFilters),
      queryText: args.query as string,
    });

    if (results.length === 0) {
      return ok(`No results found for "${args.query}" in ${siteName}.`);
    }

    const formatted = results
      .map((r, i) => {
        const meta = JSON.parse(r.metadata);
        const excerpt = r.content.length > 200 ? r.content.substring(0, 200) + '...' : r.content;
        const tags = [
          r.postType,
          ...(meta.categories ?? []),
        ].join(', ');

        const customFieldsLine = formatCustomFields(r.metadata);
        const customFieldsPart = customFieldsLine ? `\n${customFieldsLine}` : '';

        return `${i + 1}. **${r.title}** (${tags}, score: ${r.score.toFixed(3)})\n   ${excerpt}\n   Post ID: ${r.postId}${customFieldsPart}`;
      })
      .join('\n\n');

    const warning = indexEntry ? indexFreshnessWarning(indexEntry) : null;
    const suffix = warning ? `\n${warning}` : '';
    return ok(`Found ${results.length} results in "${siteName}":\n\n${formatted}${suffix}`);
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
