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

async function runSync(
  db: AgentDatabase, siteId: string,
  from: string | undefined, to: string | undefined,
  budgetMB: number, ctx: AgentContext,
): Promise<string> {
  const src = getSource(db, siteId);
  if (!src) return `⚠ No log source bound to "${siteId}". Run connect_log_source first.`;

  const creds = await getAwsCreds(ctx);
  if ('error' in creds) return `⚠ ${creds.error}`;

  const toDay = to ?? addDays(utcToday(), -1);
  const fromDay = from ?? addDays(toDay, -(DEFAULT_SYNC_DAYS - 1));
  const budgetBytes = Math.max(16, Math.min(budgetMB, 4096)) * 1048576;

  const ledger = getLedger(db, siteId);
  const wantedDates = fileDatesForRange(fromDay, toDay).filter(d => !ledger[d]);
  if (wantedDates.length === 0) {
    return `✓ Up to date — all file-dates for ${fromDay} → ${toDay} already processed (${Object.keys(ledger).length} dates in ledger).`;
  }

  type Planned = { date: string; files: { key: string; size: number }[]; bytes: number };
  const plan: Planned[] = [];
  let planned = 0;

  for (const date of wantedDates) {
    let files: { key: string; size: number }[];
    try {
      const all = await s3ListAll(creds, src.region, src.bucket, src.prefix + date.replace(/-/g, ''));
      files = all.filter(o => /apachestyle/i.test(o.key));
    } catch (e: unknown) {
      return `⚠ S3 listing failed at ${date}: ${(e as Error).message}`;
    }
    const bytes = files.reduce((s, f) => s + f.size, 0);
    if (files.length === 0) { plan.push({ date, files, bytes: 0 }); continue; }
    if (planned + bytes > budgetBytes && plan.some(p => p.files.length > 0)) break;
    if (bytes > budgetBytes) ctx.log.warn(`${date} alone is ${fmtMB(bytes)} — over budget, processing anyway`);
    plan.push({ date, files, bytes });
    planned += bytes;
  }

  const deferred = wantedDates.length - plan.length;
  ctx.log.info(`Plan: ${plan.length} file-dates, ${fmtMB(planned)} compressed, ${deferred} deferred`);

  const touched = new Map<string, ReturnType<typeof emptyAggregate>>();
  let totalSkipped = 0;

  for (const p of plan) {
    let fileSkipped = 0;
    for (const f of p.files) {
      ctx.log.info(`Streaming ${f.key} (${fmtMB(f.size)})`);
      try {
        for await (const line of s3StreamLines(creds, src.region, src.bucket, f.key)) {
          if (!line.trim()) continue;
          const parsed = parseLogLine(line);
          if (!parsed) { fileSkipped++; continue; }
          let agg = touched.get(parsed.day);
          if (!agg) {
            const existing = getAggregate(db, siteId, parsed.day);
            agg = existing ? { ...existing } : emptyAggregate(siteId, parsed.day);
            enableIpTracking(agg);
            touched.set(parsed.day, agg);
          }
          foldLine(agg, parsed, classifyLine(parsed));
        }
      } catch (e: unknown) {
        ctx.log.error(`Stream error for ${f.key}: ${(e as Error).message} — date ${p.date} left un-ledgered for retry`);
        continue;
      }
    }
    totalSkipped += fileSkipped;

    for (const [, agg] of touched) {
      const final = finalizeAggregate({ ...agg });
      final.skippedLines = (final.skippedLines ?? 0) + fileSkipped;
      saveAggregate(db, final);
    }
    markLedger(db, {
      site: siteId, file_date: p.date,
      files: p.files.length, bytes: p.bytes,
      lines: Array.from(touched.values()).reduce((s, a) => s + a.requests, 0),
      processed_at: Date.now(),
    });
  }

  evict(db, siteId, 180);

  const totalRequests = Array.from(touched.values()).reduce((s, a) => s + a.requests, 0);
  return `✓ ${siteId}: ${plan.length} file-dates, ~${totalRequests.toLocaleString()} requests, ${totalSkipped} lines skipped${deferred > 0 ? `, ${deferred} dates deferred` : ''}.`;
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

      sync_access_logs: {
        description: 'Ingest access-log days from S3: streams each file (constant memory — raw bytes never persist), classifies traffic, folds into per-day aggregates. Ledgered and budgeted; large backfills resume across runs.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string' },
            from: { type: 'string', description: 'First day (YYYY-MM-DD). Default: 28 days ago.' },
            to: { type: 'string', description: 'Last day (YYYY-MM-DD). Default: yesterday (UTC).' },
            budgetMB: { type: 'number', default: 512 },
          },
          required: ['siteId'],
        },
        executionMode: 'run' as const,
        handler: async (args: { siteId: string; from?: string; to?: string; budgetMB?: number }, ctx: AgentContext): Promise<AgentToolResult> => {
          ctx.log.phase('sync_access_logs', args.siteId);
          const db = openDb(ctx);
          return ok(await runSync(db, args.siteId, args.from, args.to, args.budgetMB ?? DEFAULT_SYNC_BUDGET_MB, ctx));
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
