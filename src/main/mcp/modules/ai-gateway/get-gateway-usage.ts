import { McpToolHandler } from '../../types';
import { ok, error } from '../wp-cli/preflight';

export const getGatewayUsageHandler: McpToolHandler = {
  definition: {
    name: 'get_gateway_usage',
    description: 'Get AI gateway usage and cost breakdown by site and model. Returns monthly spend totals from the Local AI Gateway.',
    inputSchema: {
      type: 'object',
      properties: {
        month: {
          type: 'string',
          description: 'Month in YYYY-MM format (default: current month)',
        },
      },
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<any> {
    try {
      const USAGE_KEY = 'nexus_ai_gateway_usage';
      const allRecords = (services.registryStorage?.get(USAGE_KEY) ?? []) as any[];

      const targetMonth = (args.month as string) ?? new Date().toISOString().slice(0, 7);
      const [year, mon] = targetMonth.split('-').map(Number);
      const start = new Date(year, mon - 1, 1).getTime();
      const end = new Date(year, mon, 1).getTime();

      const records = allRecords.filter((r: any) => r.timestamp >= start && r.timestamp < end);

      if (records.length === 0) {
        return ok(`No AI gateway usage recorded for ${targetMonth}.`);
      }

      // Aggregate by site name
      const siteMap = new Map<string, { cost: number; requests: number; tokens: number }>();
      const modelMap = new Map<string, { cost: number; requests: number }>();

      for (const r of records) {
        const sid = r.siteId ?? 'unknown';
        const name = r.siteName ?? sid;
        const key = name !== sid ? name : sid;
        if (!siteMap.has(key)) siteMap.set(key, { cost: 0, requests: 0, tokens: 0 });
        const s = siteMap.get(key)!;
        s.cost += r.costUsd ?? 0;
        s.requests++;
        s.tokens += r.totalTokens ?? 0;

        const model = r.model ?? 'unknown';
        if (!modelMap.has(model)) modelMap.set(model, { cost: 0, requests: 0 });
        const m = modelMap.get(model)!;
        m.cost += r.costUsd ?? 0;
        m.requests++;
      }

      const totalCost = records.reduce((s: number, r: any) => s + (r.costUsd ?? 0), 0);
      const totalTokens = records.reduce((s: number, r: any) => s + (r.totalTokens ?? 0), 0);

      const bySite = [...siteMap.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([name, v]) => `| ${name} | $${v.cost.toFixed(4)} | ${v.requests} req |`)
        .join('\n');

      const byModel = [...modelMap.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([model, v]) => `| ${model} | $${v.cost.toFixed(4)} | ${v.requests} req |`)
        .join('\n');

      const lines = [
        `## AI Gateway Usage — ${targetMonth}`,
        '',
        `**Total: $${totalCost.toFixed(4)} · ${records.length} requests · ${(totalTokens / 1000).toFixed(1)}k tokens**`,
        '',
        '### By Site',
        '| Site | Cost | Requests |',
        '|------|------|----------|',
        bySite,
        '',
        '### By Model',
        '| Model | Cost | Requests |',
        '|-------|------|----------|',
        byModel,
      ];

      return ok(lines.join('\n'));
    } catch (err: any) {
      return error(`Failed to get gateway usage: ${err.message}`);
    }
  },
};
