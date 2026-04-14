/**
 * MCP tools for telemetry and system health monitoring
 */

import { McpToolHandler, McpToolResult } from '../types';
import { getMetrics } from '../../telemetry/MetricsCollector';
import { getHealthMonitor } from '../../telemetry/HealthMonitor';

const metrics = getMetrics();
const healthMonitor = getHealthMonitor();

function success(data: any): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export const getSystemHealthTool: McpToolHandler = {
  definition: {
    name: 'get_system_health',
    description: 'Get system health status and key operational metrics — MCP server status, GraphQL connectivity, active tool count, and error rates. Use when diagnosing MCP connectivity issues or confirming the addon is functioning correctly. For a user-facing health check, use nexus doctor from the CLI.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, _services): Promise<McpToolResult> {
    const health = healthMonitor.getHealth();
    return success(health);
  },
};

export const getMetricsTool: McpToolHandler = {
  definition: {
    name: 'get_metrics',
    description: 'Get all collected operational metrics — tool call counts, error rates, latency histograms, and system gauges. Use for monitoring addon performance or diagnosing which tools are being called most frequently. For a specific tool metrics, use get_tool_metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['json', 'summary'],
          description: 'Output format (default: summary)',
        },
      },
    },
  },

  async execute(args, _services): Promise<McpToolResult> {
    const format = (args.format as string) || 'summary';

    if (format === 'json') {
      return success(metrics.toJSON());
    }

    // Summary format
    const snapshot = metrics.getSnapshot();
    const toolMetrics = metrics.getAllToolMetrics();

    const summary = {
      uptime_ms: metrics.getUptime(),
      uptime_hours: (metrics.getUptime() / 3600000).toFixed(2),
      counters: Array.from(snapshot.counters.values()).slice(0, 10),
      gauges: Array.from(snapshot.gauges.values()).slice(0, 10),
      top_tools: toolMetrics.slice(0, 10).map(t => ({
        name: t.name,
        calls: t.calls,
        errors: t.errors,
        error_rate: (t.errors / t.calls * 100).toFixed(1) + '%',
        avg_ms: t.avg_duration_ms.toFixed(0),
        p95_ms: t.p95_duration_ms.toFixed(0),
      })),
    };

    return success(summary);
  },
};

export const getToolMetricsTool: McpToolHandler = {
  definition: {
    name: 'get_tool_metrics',
    description: 'Get detailed performance metrics for a specific MCP tool — call count, success/error rates, and latency percentiles. Use to identify slow or error-prone tools. Use get_metrics for a full overview of all tools.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'Tool name to get metrics for',
        },
      },
      required: ['tool_name'],
    },
  },

  async execute(args, _services): Promise<McpToolResult> {
    const toolName = args.tool_name as string;
    const toolMetric = metrics.getToolMetrics(toolName);

    if (!toolMetric) {
      return success({ error: `No metrics found for tool: ${toolName}` });
    }

    return success(toolMetric);
  },
};

export const resetMetricsTool: McpToolHandler = {
  definition: {
    name: 'reset_metrics',
    description: 'Reset all collected operational metrics to zero — useful for starting fresh measurements after a configuration change or for testing. Metrics begin accumulating again immediately after reset.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, _services): Promise<McpToolResult> {
    metrics.reset();
    return success({ message: 'Metrics reset successfully' });
  },
};

export function registerTelemetryTools(registry: any): void {
  registry.register(getSystemHealthTool);
  registry.register(getMetricsTool);
  registry.register(getToolMetricsTool);
  registry.register(resetMetricsTool);
}
