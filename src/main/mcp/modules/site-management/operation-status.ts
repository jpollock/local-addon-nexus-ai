/**
 * local_operation_status
 *
 * Returns the current status of a long-running operation (push, pull, export)
 * on a local site. The OperationTracker intercepts Local's IPC events in real
 * time, so this reflects live state without polling Local's UI.
 *
 * Use after starting a push/pull/export to monitor progress.
 */

import { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export const operationStatusHandler: McpToolHandler = {
  definition: {
    name: 'local_operation_status',
    description:
      'Check the live status of a push, pull, or export operation on a local site. ' +
      'Call this after local_wpe_pull, local_wpe_push, or local_export_site to monitor progress. ' +
      'Poll every 15-30 seconds — operations typically take 1-5 minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const identifier = args.site as string;
    if (!identifier) return error('site is required');

    // Resolve site
    const sites = Object.values(services.siteData.getSites()) as any[];
    const site = sites.find(
      (s) => s.name === identifier || s.id === identifier || s.domain === identifier,
    );
    if (!site) return error(`Site not found: ${identifier}`);

    const tracker = services.operationTracker;
    const op = tracker?.getOperation(site.id);
    const liveStatus = services.localServices!.getSiteStatus(site.id);
    const now = Date.now();

    if (!op) {
      return ok(JSON.stringify({
        site: site.name,
        operation: null,
        site_status: liveStatus,
        message: liveStatus === 'running'
          ? 'Site is running normally. No tracked operation.'
          : `Site status: ${liveStatus}`,
      }, null, 2));
    }

    const durationSeconds = op.completedAt
      ? op.durationSeconds
      : Math.round((now - op.startedAt) / 1000);

    const result: Record<string, any> = {
      site: site.name,
      operation: op.type,
      status: op.status,
      local_status: op.localStatus,
      started_at: new Date(op.startedAt).toISOString(),
      duration_seconds: durationSeconds,
      last_message: op.lastMessage,
    };

    if (op.status === 'completed') {
      result.completed_at = new Date(op.completedAt!).toISOString();
      result.message = `${op.type} completed in ${durationSeconds}s.`;
    } else if (op.status === 'active') {
      result.message = `${op.type} in progress (${durationSeconds}s elapsed). Check again in 15-30s.`;
      if (op.recentEvents.length > 0) {
        result.recent_files = op.recentEvents
          .slice(-5)
          .map((e) => e.progressText)
          .filter(Boolean);
      }
    } else {
      result.message = `${op.type} starting...`;
    }

    return ok(JSON.stringify(result, null, 2));
  },
};
