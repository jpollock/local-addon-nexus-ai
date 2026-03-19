/**
 * MCP tools for event processing and knowledge graph queries
 */
import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { resolveSite } from '../../site-resolver';

function success(data: any): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function error(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

export const getEventEndpointInfoTool: McpToolHandler = {
  definition: {
    name: 'get_event_endpoint_info',
    description: 'Get connection info for the WordPress event webhook endpoint',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const httpInterface = (services as any).httpEventInterface;
    if (!httpInterface) {
      return error('Event interface not initialized');
    }

    const info = httpInterface.getConnectionInfo();
    return success(info);
  },
};

export const getEventProcessorStatsTool: McpToolHandler = {
  definition: {
    name: 'get_event_processor_stats',
    description: 'Get event processor statistics (total events, pending, failed, etc.)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const eventProcessor = (services as any).eventProcessor;
    if (!eventProcessor) {
      return error('Event processor not initialized');
    }

    const stats = await eventProcessor.getStats();
    return success(stats);
  },
};

export const getGraphContentTool: McpToolHandler = {
  definition: {
    name: 'get_graph_content',
    description: 'Get content from knowledge graph by site and post ID',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name',
        },
        post_id: {
          type: 'number',
          description: 'WordPress post ID',
        },
      },
      required: ['site', 'post_id'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    console.log(`[get_graph_content] Called with site="${args.site}", post_id=${args.post_id}`);
    console.log(`[get_graph_content] services keys: ${Object.keys(services).join(', ')}`);

    const graphService = (services as any).graphService;
    console.log(`[get_graph_content] graphService: ${graphService ? 'EXISTS' : 'NULL'}`);
    if (!graphService) {
      console.log('[get_graph_content] ERROR: Graph service not initialized');
      return error('Graph service not initialized');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      console.log(`[get_graph_content] ERROR: Site not found: ${args.site}`);
      return error(`Site not found: ${args.site}`);
    }

    console.log(`[get_graph_content] Resolved site: id="${site.id}", name="${site.name}"`);
    console.log(`[get_graph_content] Querying with site.name="${site.name}", post_id=${args.post_id}`);

    // Use site.name for GraphService queries (events are stored by site name, not UUID)
    const content = await graphService.getContent(site.name, args.post_id);

    console.log(`[get_graph_content] GraphService.getContent returned: ${content ? 'CONTENT' : 'NULL'}`);
    return success(content);
  },
};

export const listGraphContentTool: McpToolHandler = {
  definition: {
    name: 'list_graph_content',
    description: 'List all content for a site from knowledge graph',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name',
        },
        post_type: {
          type: 'string',
          description: 'Filter by post type (post, page, etc.) - optional',
        },
      },
      required: ['site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    console.log(`[list_graph_content] Called with site="${args.site}"`);
    console.log(`[list_graph_content] services keys: ${Object.keys(services).join(', ')}`);

    const graphService = (services as any).graphService;
    console.log(`[list_graph_content] graphService: ${graphService ? 'EXISTS' : 'NULL'}`);
    if (!graphService) {
      console.log('[list_graph_content] ERROR: Graph service not initialized');
      return error('Graph service not initialized');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      console.log(`[list_graph_content] ERROR: Site not found: ${args.site}`);
      return error(`Site not found: ${args.site}`);
    }

    console.log(`[list_graph_content] Resolved site: id="${site.id}", name="${site.name}"`);

    const options = args.post_type ? { post_type: args.post_type } : undefined;
    // Use site.name for GraphService queries (events are stored by site name, not UUID)
    console.log(`[list_graph_content] Calling graphService.listContent("${site.name}", ${JSON.stringify(options)})`);
    const content = await graphService.listContent(site.name, options);

    console.log(`[list_graph_content] GraphService.listContent returned: ${content.length} items`);
    return success(content);
  },
};

export const getGraphPluginTool: McpToolHandler = {
  definition: {
    name: 'get_graph_plugin',
    description: 'Get plugin from knowledge graph by site and slug',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name',
        },
        slug: {
          type: 'string',
          description: 'Plugin slug',
        },
      },
      required: ['site', 'slug'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const graphService = (services as any).graphService;
    if (!graphService) {
      return error('Graph service not initialized');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site not found: ${args.site}`);
    }

    const plugin = await graphService.getPlugin(site.name, args.slug);
    return success(plugin);
  },
};

export const listGraphPluginsTool: McpToolHandler = {
  definition: {
    name: 'list_graph_plugins',
    description: 'List all plugins for a site from knowledge graph',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name',
        },
        active_only: {
          type: 'boolean',
          description: 'Filter to active plugins only - optional',
        },
      },
      required: ['site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const graphService = (services as any).graphService;
    if (!graphService) {
      return error('Graph service not initialized');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site not found: ${args.site}`);
    }

    const options = args.active_only ? { active_only: true } : undefined;
    const plugins = await graphService.listPlugins(site.name, options);
    return success(plugins);
  },
};

export const getGraphStatsTool: McpToolHandler = {
  definition: {
    name: 'get_graph_stats',
    description: 'Get knowledge graph statistics for a site',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name - optional (omit for global stats)',
        },
      },
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const graphService = (services as any).graphService;
    if (!graphService) {
      return error('Graph service not initialized');
    }

    if (args.site as string) {
      const site = resolveSite(args.site as string, services.siteData);
      if (!site) {
        return error(`Site not found: ${args.site}`);
      }

      const stats = await graphService.getSiteStats(site.name);
      return success(stats);
    }

    const stats = await graphService.getStats();
    return success(stats);
  },
};
