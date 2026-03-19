/**
 * MCP tools for event processing and knowledge graph queries
 */
import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { resolveSite } from '../../site-resolver';
import { createLogger } from '../../../logging/Logger';

const logger = createLogger('EventTools');

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
    logger.debug('get_graph_content called', { site: args.site, post_id: args.post_id });

    const graphService = (services as any).graphService;
    if (!graphService) {
      logger.error('get_graph_content: Graph service not initialized');
      return error('Graph service not initialized');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      logger.warn('get_graph_content: Site not found', { site: args.site });
      return error(`Site not found: ${args.site}`);
    }

    logger.debug('get_graph_content: Resolved site', { siteId: site.id, siteName: site.name, post_id: args.post_id });

    // Use site.name for GraphService queries (events are stored by site name, not UUID)
    const content = await graphService.getContent(site.name, args.post_id);

    logger.debug('get_graph_content: Query complete', { hasContent: !!content });
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
    logger.debug('list_graph_content called', { site: args.site, post_type: args.post_type });

    const graphService = (services as any).graphService;
    if (!graphService) {
      logger.error('list_graph_content: Graph service not initialized');
      return error('Graph service not initialized');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      logger.warn('list_graph_content: Site not found', { site: args.site });
      return error(`Site not found: ${args.site}`);
    }

    logger.debug('list_graph_content: Resolved site', { siteId: site.id, siteName: site.name });

    const options = args.post_type ? { post_type: args.post_type } : undefined;
    // Use site.name for GraphService queries (events are stored by site name, not UUID)
    const content = await graphService.listContent(site.name, options);

    logger.debug('list_graph_content: Query complete', { count: content.length });
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
