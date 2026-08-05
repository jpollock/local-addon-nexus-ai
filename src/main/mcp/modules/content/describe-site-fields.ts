import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite, resolveRemoteGraphSite } from '../../site-resolver';
import { buildFieldCatalog, formatFieldCatalog } from './field-catalog';
import { vectorSiteId } from '../../../vector-store/vectorSiteId';

/**
 * describe_site_fields — report the site's indexed structured fields (per post
 * type) so an AI agent can map a natural-language constraint to a concrete
 * metadataFilters entry. Fully domain-agnostic: it only reports what is indexed;
 * the agent supplies the meaning.
 */
export const describeSiteFieldsHandler: McpToolHandler = {
  definition: {
    name: 'describe_site_fields',
    description:
      "Discover a site's indexed structured custom fields, grouped by post type, with each " +
      "field's inferred type and value range/enum and coverage. Call this before answering " +
      'attribute/constraint questions (e.g. "easy", "under $20", "in <region>") so you know ' +
      'which fields exist and how to filter. Then call search_site_content with ' +
      'searchMode:"hybrid", postType, and metadataFilters. Works for local sites (name/ID/domain) ' +
      'and WPE installs (install name). The site must be indexed.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain (or WPE install name)',
        },
      },
      required: ['site'],
    },
    annotations: { readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    // Resolve site: local first, then WPE install (mirror search_site_content).
    let siteId: string;
    let siteName: string;
    const localSite = resolveSite(args.site as string, services.siteData);
    if (localSite) {
      siteId = localSite.id;
      siteName = localSite.name;
    } else {
      // M14: names collide across sources; an unordered `LIMIT 1` picks an
      // arbitrary row. Decline rather than guess (as core_version does).
      const graphService = (services as any).graphService;
      const db = graphService?.getDb?.();
      const result = resolveRemoteGraphSite(db, args.site);
      if (result.kind === 'none') {
        return error(`Site "${args.site}" not found. For WPE installs use the install name. Run wpe_sync_sites first if missing.`);
      }
      if (result.kind === 'ambiguous') {
        return error(
          `"${args.site}" matches ${result.matches.length} sites across sources — specify which one: ${result.matches.join(', ')}`,
        );
      }
      siteId = result.siteId;
      siteName = result.siteName;
    }

    // vectorSiteId: external ids are `ssh:<alias>`; the vector store's
    // table-name validation rejects colons. No-op for local/WPE ids.
    const docs = await services.vectorStore.getAllDocuments(vectorSiteId(siteId));
    if (docs.length === 0) {
      return error(`Site "${siteName}" has no indexed content. Run reindex_site first.`);
    }

    // Dedup chunks → one entry per post; parse customFields out of each doc's metadata.
    const seen = new Set<number>();
    const posts: Array<{ postType: string; customFields: Record<string, unknown> }> = [];
    for (const doc of docs) {
      if (seen.has(doc.postId)) continue;
      seen.add(doc.postId);
      let customFields: Record<string, unknown> = {};
      try {
        const meta = JSON.parse(doc.metadata);
        if (meta && typeof meta.customFields === 'object' && meta.customFields) {
          customFields = meta.customFields;
        }
      } catch {
        // malformed metadata → treat as no custom fields
      }
      posts.push({ postType: doc.postType, customFields });
    }

    const catalogs = buildFieldCatalog(posts);
    const hasAnyFields = catalogs.some((c) => c.fields.length > 0);
    if (!hasAnyFields) {
      return ok(`"${siteName}" has no indexed structured custom fields. Use plain semantic search (searchMode:"semantic").`);
    }
    return ok(formatFieldCatalog(siteName, catalogs));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
