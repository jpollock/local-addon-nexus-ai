import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export const getAllDocumentsHandler: McpToolHandler = {
  definition: {
    name: 'get_all_site_documents',
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
          description: 'Return full chunk text instead of 200-char preview. Use for link-graph analysis. Ignored when include_embeddings is true.',
          default: false,
        },
      },
      required: ['site'],
    },
    annotations: { readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found`);

    const includeEmbeddings = (args.include_embeddings as boolean | undefined) ?? false;
    const fullContent = (args.full_content as boolean | undefined) ?? false;

    const docs = await services.vectorStore.getAllDocuments(site.id);

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
        // full_content=true: return full chunk text for link-graph analysis (no maxBuffer risk)
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
