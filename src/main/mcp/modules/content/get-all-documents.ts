import { McpToolHandler, McpToolResult } from '../../types';
import { resolveAnySite } from '../../site-resolver';
import { vectorSiteId } from '../../../vector-store/vectorSiteId';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export const getAllDocumentsHandler: McpToolHandler = {
  definition: {
    name: 'get_all_site_documents',
    namespace: 'content',
    description:
      'Returns all indexed documents for a site with optional embeddings. ' +
      'Used for topical clustering and semantic analysis. ' +
      'Returns empty array result if site has not been indexed. ' +
      'When include_embeddings is true, embeddings are returned as base64-encoded Float32 arrays.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Local site name, ID, or domain',
        },
        include_embeddings: {
          type: 'boolean',
          description: 'Include raw embeddings in response (default: false — metadata only)',
          default: false,
        },
        full_content: {
          type: 'boolean',
          description: 'Return full chunk text instead of 200-char preview. Note: chunk text has HTML stripped at index time — anchors and hrefs are not present, so this cannot support link-graph analysis. Ignored when include_embeddings is true.',
          default: false,
        },
      },
      required: ['site'],
    },
    annotations: { readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const resolved = resolveAnySite(args.site as string, services.siteData, (services as any).graphService);
    if (resolved.kind === 'none') return error(`Site "${args.site}" not found`);
    if (resolved.kind === 'ambiguous') {
      return error(`"${args.site}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`);
    }
    const site = { id: resolved.id, name: resolved.name };

    const includeEmbeddings = (args.include_embeddings as boolean | undefined) ?? false;
    const fullContent = (args.full_content as boolean | undefined) ?? false;

    // vectorSiteId: external ids are `ssh:<alias>`; the vector store's
    // table-name validation rejects colons. No-op for local/WPE ids.
    const docs = await services.vectorStore.getAllDocuments(vectorSiteId(site.id));

    if (docs.length === 0) {
      return ok(
        JSON.stringify({
          siteId: site.id,
          siteName: site.name,
          documentCount: 0,
          documents: [],
        }),
      );
    }

    const output = docs.map(doc => {
      const base: Record<string, unknown> = {
        id: doc.id,
        postId: doc.postId,
        postType: doc.postType,
        title: doc.title,
        // full_content=true: full chunk text (no maxBuffer risk). D22: the text
        // was HTML-stripped at index time, so it carries no anchors — do not
        // advertise link-graph analysis unless an edge list is indexed someday.
        // full_content=false: 200-char preview sufficient for display
        content: fullContent ? doc.content : doc.content.slice(0, 200),
        metadata: doc.metadata,
      };
      if (includeEmbeddings) {
        // Convert Float32Array to base64 for JSON transport
        const buf = Buffer.from(
          doc.embedding.buffer,
          doc.embedding.byteOffset,
          doc.embedding.byteLength,
        );
        base.embedding = buf.toString('base64');
      }
      return base;
    });

    return ok(
      JSON.stringify({
        siteId: site.id,
        siteName: site.name,
        documentCount: docs.length,
        documents: output,
      }),
    );
  },
};
