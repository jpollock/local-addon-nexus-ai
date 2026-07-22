import { defineAgent, cron } from '@nexus-ai/agent-sdk';
import type { AgentContext, AgentDatabase, AgentToolResult } from '@nexus-ai/agent-sdk';
import {
  initSchema, getSource, upsertSource, setEnabled, getEnabledSites,
  getLedger, markLedger, saveAggregate, getAggregate,
  getAggregatesInRange, evict, storageStats,
} from './db';
import {
  emptyAggregate, foldLine, finalizeAggregate, enableIpTracking,
  parseLogLine, classifyLine,
  s3ListAll, s3StreamLines,
  fileDatesForRange, addDays, utcToday, fmtMB, estimateRawBytes,
  TAXONOMY_VERSION,
} from './access-logs';

const ok = (text: string): AgentToolResult => ({ content: [{ type: 'text', text }] });
const DEFAULT_SYNC_DAYS = 28;
const DEFAULT_SYNC_BUDGET_MB = 512;
const GZ_EXPANSION = 11;

function openDb(ctx: AgentContext): AgentDatabase {
  const db = ctx.db.open('logs');
  initSchema(db);
  return db;
}

type AwsCreds = { accessKeyId: string; secretAccessKey: string };

async function getAwsCreds(ctx: AgentContext): Promise<AwsCreds | { error: string }> {
  const status = await ctx.credentials.getStatus('aws').catch(() => 'not_connected' as const);
  if (status !== 'connected') {
    await ctx.credentials.requestConnection('aws').catch(() => {});
    return { error: 'AWS not connected. Add the AWS connection in the Nexus UI, then retry.' };
  }
  if (typeof ctx.credentials.getSecret !== 'function') {
    return { error: 'credentials.getSecret() not available — api_key credential provider extension required.' };
  }
  const secret = await ctx.credentials.getSecret('aws');
  if (!secret?.accessKeyId || !secret?.secretAccessKey) {
    return { error: 'AWS connection is missing accessKeyId/secretAccessKey fields.' };
  }
  return { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey };
}

// Defined in Task 5
async function runSync(
  db: AgentDatabase, siteId: string,
  from: string | undefined, to: string | undefined,
  budgetMB: number, ctx: AgentContext,
): Promise<string> {
  return `⚠ sync not yet implemented for ${siteId}`;
}

export default defineAgent({
  name: 'log-processor',
  version: '1.0.0',
  description: 'Access log ingestion and read contract. Streams WPE Apache-style logs from S3, folds into daily aggregates, serves seo-insights and security-sentinel via contributed tools.',
  triggers: [cron('0 3 * * *')],
  credentials: [{
    provider: 'aws',
    type: 'api_key' as const,
    optional: true,
    reason: 'Reads WP Engine access logs from your S3 bucket',
  }],
  contributes: {
    tools: {

      connect_log_source: {
        description: 'Bind an S3 log location to a WPE install. Validates by listing the prefix. Does not enable the site for cron — call set_log_processing to do that.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'WPE install name' },
            bucket: { type: 'string' },
            region: { type: 'string', default: 'us-east-1' },
            prefix: { type: 'string', default: '' },
          },
          required: ['siteId', 'bucket'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; bucket: string; region?: string; prefix?: string }, ctx: AgentContext): Promise<AgentToolResult> => {
          ctx.log.phase('connect_log_source');
          const region = args.region ?? 'us-east-1';
          const prefix = args.prefix ?? '';
          const creds = await getAwsCreds(ctx);
          if ('error' in creds) return ok(`⚠ ${creds.error}`);
          try {
            const objects = await s3ListAll(creds, region, args.bucket, prefix, 20);
            const db = openDb(ctx);
            upsertSource(db, { site: args.siteId, provider: 's3', bucket: args.bucket, region, prefix, enabled: 0 });
            const logFiles = objects.filter(o => /apachestyle/i.test(o.key));
            return ok(
              `✓ ${args.siteId} → s3://${args.bucket}/${prefix} (${region})\n` +
              (objects.length === 0
                ? '⚠ Prefix currently empty — check prefix if logs are expected.'
                : `Found ${objects.length}${objects.length >= 20 ? '+' : ''} objects (${logFiles.length} apachestyle). Sample: ${logFiles.slice(0, 2).map(o => o.key).join(', ') || '—'}`) +
              `\n\nNext: enable with set_log_processing siteId="${args.siteId}" enabled=true`,
            );
          } catch (e: unknown) {
            return ok(`⚠ Could not list s3://${args.bucket}/${prefix}: ${(e as Error).message}`);
          }
        },
      },

      set_log_processing: {
        description: 'Enable or disable scheduled log processing for a WPE install. Enabled sites are picked up by the nightly cron. Site must already be connected via connect_log_source.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string' },
            enabled: { type: 'boolean' },
          },
          required: ['siteId', 'enabled'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; enabled: boolean }, ctx: AgentContext): Promise<AgentToolResult> => {
          const db = openDb(ctx);
          if (!getSource(db, args.siteId)) return ok(`⚠ No log source for "${args.siteId}". Run connect_log_source first.`);
          setEnabled(db, args.siteId, args.enabled);
          return ok(`✓ Log processing ${args.enabled ? 'enabled' : 'disabled'} for ${args.siteId}.`);
        },
      },

    },
  },

  run: async (ctx) => {
    ctx.log.phase('cron', 'log-processor nightly sync');
    const db = openDb(ctx);
    const sites = getEnabledSites(db);
    if (sites.length === 0) {
      ctx.log.info('No sites enabled for log processing. Use set_log_processing to opt in.');
      return;
    }
    ctx.log.info(`Processing ${sites.length} enabled site(s): ${sites.join(', ')}`);
    for (const siteId of sites) {
      await runSync(db, siteId, undefined, undefined, DEFAULT_SYNC_BUDGET_MB, ctx);
    }
  },
});
