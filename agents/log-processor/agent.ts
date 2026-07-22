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
  let totalRequests = 0;

  for (const p of plan) {
    let fileSkipped = 0;
    let streamErrored = false;
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
        const msg = (e as Error).message;
        ctx.log.error(`Stream error for ${f.key}: ${msg} — date ${p.date} left un-ledgered for retry`);
        if (msg.includes('InvalidAccessKeyId') || msg.includes('SignatureDoesNotMatch')) {
          ctx.credentials.revokeCredential?.('aws').catch(() => {});
          return `⚠ AWS credentials are no longer valid. Re-enter them in Preferences → Connected accounts → AWS S3.`;
        }
        streamErrored = true;
        continue;
      }
    }
    totalSkipped += fileSkipped;

    for (const [, agg] of touched) {
      const final = finalizeAggregate({ ...agg });
      final.skippedLines = (final.skippedLines ?? 0) + fileSkipped;
      saveAggregate(db, final);
    }
    if (!streamErrored) {
      markLedger(db, {
        site: siteId, file_date: p.date,
        files: p.files.length, bytes: p.bytes,
        lines: Array.from(touched.values()).reduce((s, a) => s + a.requests, 0),
        processed_at: Date.now(),
      });
    }
    totalRequests += Array.from(touched.values()).reduce((s, a) => s + a.requests, 0);
    touched.clear();
  }

  evict(db, siteId, 180);
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
            const msg = (e as Error).message;
            if (msg.includes('InvalidAccessKeyId') || msg.includes('SignatureDoesNotMatch')) {
              ctx.credentials.revokeCredential?.('aws').catch(() => {});
              return ok(`⚠ AWS credentials are no longer valid. Re-enter them in Preferences → Connected accounts → AWS S3.`);
            }
            return ok(`⚠ Could not list s3://${args.bucket}/${prefix}: ${msg}`);
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

      get_log_aggregates: {
        description: 'Return daily aggregate objects for a site and date range. Offline read — no S3 calls. Returns present days plus an explicit list of missing days with the exact sync command.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string' },
            from: { type: 'string', description: 'First day (YYYY-MM-DD)' },
            to: { type: 'string', description: 'Last day (YYYY-MM-DD)' },
          },
          required: ['siteId', 'from', 'to'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId: string; from: string; to: string }, ctx: AgentContext): Promise<AgentToolResult> => {
          const db = openDb(ctx);
          const rows = getAggregatesInRange(db, args.siteId, args.from, args.to);
          const present = new Set(rows.map(r => r.day));
          const missing: string[] = [];
          for (let d = args.from; d <= args.to; d = addDays(d, 1)) {
            if (!present.has(d)) missing.push(d);
          }
          const result: Record<string, unknown> = {
            siteId: args.siteId, from: args.from, to: args.to,
            taxonomyVersion: TAXONOMY_VERSION,
            aggregates: Object.fromEntries(rows.map(r => [r.day, r.agg])),
          };
          if (missing.length > 0) {
            result.missingDays = missing;
            result.missingDaysNote = `${missing.length} day(s) not ingested. To fill: sync_access_logs siteId="${args.siteId}" from="${missing[0]}" to="${missing[missing.length - 1]}"`;
          }
          return ok(JSON.stringify(result, null, 2));
        },
      },

      fetch_log_window: {
        description: 'Forensic raw-log query over a bounded window. Two-phase: without confirm returns the cost estimate; confirm=true streams and filters. Nothing persists.',
        permissionTier: 2,
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            ip: { type: 'string', description: 'Filter: exact client IP' },
            pathContains: { type: 'string' },
            uaContains: { type: 'string' },
            status: { type: 'number' },
            confirm: { type: 'boolean', default: false },
          },
          required: ['siteId', 'from', 'to'],
        },
        executionMode: 'run' as const,
        handler: async (
          args: { siteId: string; from: string; to: string; ip?: string; pathContains?: string; uaContains?: string; status?: number; confirm?: boolean },
          ctx: AgentContext,
        ): Promise<AgentToolResult> => {
          ctx.log.phase('fetch_log_window', args.confirm ? 'execute' : 'estimate');
          const db = openDb(ctx);
          const src = getSource(db, args.siteId);
          if (!src) return ok(`⚠ No log source for "${args.siteId}".`);
          const creds = await getAwsCreds(ctx);
          if ('error' in creds) return ok(`⚠ ${creds.error}`);

          const allFiles: { key: string; size: number }[] = [];
          for (const date of fileDatesForRange(args.from, args.to)) {
            const files = await s3ListAll(creds, src.region, src.bucket, src.prefix + date.replace(/-/g, ''));
            allFiles.push(...files.filter(o => /apachestyle/i.test(o.key)));
          }

          const totalCompressed = allFiles.reduce((s, f) => s + f.size, 0);
          const estMinutes = Math.ceil(totalCompressed * GZ_EXPANSION / (50 * 1048576));

          if (!args.confirm) {
            return ok(JSON.stringify({
              estimate: true,
              files: allFiles.length,
              compressedMB: +(totalCompressed / 1048576).toFixed(1),
              estimatedRawMB: +(totalCompressed * GZ_EXPANSION / 1048576).toFixed(0),
              estimatedMinutes: estMinutes,
              filter: { ip: args.ip, pathContains: args.pathContains, uaContains: args.uaContains, status: args.status },
              note: 'Call with confirm=true to execute. Nothing will be persisted.',
            }, null, 2));
          }

          const SAMPLE_CAP = 100;
          const sample: string[] = [];
          let matchCount = 0;
          const byDay: Record<string, number> = {};
          const byStatus: Record<string, number> = {};
          const byPath: Record<string, number> = {};
          const byIp: Record<string, number> = {};

          for (const f of allFiles) {
            try {
              for await (const line of s3StreamLines(creds, src.region, src.bucket, f.key)) {
                if (!line.trim()) continue;
                const parsed = parseLogLine(line);
                if (!parsed) continue;
                if (args.ip && parsed.ip !== args.ip) continue;
                if (args.pathContains && !parsed.path.includes(args.pathContains)) continue;
                if (args.uaContains && !parsed.ua.includes(args.uaContains)) continue;
                if (args.status !== undefined && parsed.status !== args.status) continue;
                matchCount++;
                byDay[parsed.day] = (byDay[parsed.day] ?? 0) + 1;
                byStatus[String(parsed.status)] = (byStatus[String(parsed.status)] ?? 0) + 1;
                if (parsed.path in byPath || Object.keys(byPath).length < 20) {
                  byPath[parsed.path] = (byPath[parsed.path] ?? 0) + 1;
                }
                if (parsed.ip in byIp || Object.keys(byIp).length < 20) {
                  byIp[parsed.ip] = (byIp[parsed.ip] ?? 0) + 1;
                }
                if (sample.length < SAMPLE_CAP) sample.push(line);
              }
            } catch (e: unknown) {
              ctx.log.warn(`Stream error for ${f.key}: ${(e as Error).message}`);
            }
          }

          return ok(JSON.stringify({
            siteId: args.siteId, from: args.from, to: args.to,
            filter: { ip: args.ip, pathContains: args.pathContains, uaContains: args.uaContains, status: args.status },
            matches: matchCount, byDay, byStatus, byPath, byIp,
            sample: sample.slice(0, SAMPLE_CAP),
            note: 'Ephemeral — nothing persisted.',
          }, null, 2));
        },
      },

      log_storage_status: {
        description: 'Report the local disk footprint: per-site aggregate days, ledger coverage, enabled status, approximate KB. Raw logs are never stored locally.',
        inputSchema: { type: 'object', properties: {} },
        executionMode: 'function' as const,
        handler: async (_args: Record<never, never>, ctx: AgentContext): Promise<AgentToolResult> => {
          const db = openDb(ctx);
          const stats = storageStats(db);
          if (stats.length === 0) return ok('No sites connected. Run connect_log_source to bind an S3 log source.');
          const lines = stats.map(s =>
            `  ${s.site}: ${s.aggregateDays} agg days, ${s.ledgerDays} ledgered file-dates, ~${(s.approxBytes / 1024).toFixed(1)}KB — ${s.enabled ? 'enabled (cron)' : 'disabled'}`,
          ).join('\n');
          const totalKB = (stats.reduce((s, r) => s + r.approxBytes, 0) / 1024).toFixed(1);
          return ok(`Log storage:\n${lines}\n\nFleet total: ~${totalKB}KB`);
        },
      },

      evict_log_data: {
        description: 'Delete local log-derived data older than N days. Removes from aggregates and ledger. Never touches sources or the S3 bucket.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Limit to this site. Omit for fleet-wide.' },
            olderThanDays: { type: 'number', description: 'Default: 180.' },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId?: string; olderThanDays?: number }, ctx: AgentContext): Promise<AgentToolResult> => {
          const db = openDb(ctx);
          const deleted = evict(db, args.siteId, args.olderThanDays ?? 180);
          const scope = args.siteId ? `for ${args.siteId}` : 'fleet-wide';
          return ok(`✓ Evicted ${deleted} aggregate day(s) ${scope} (older than ${args.olderThanDays ?? 180} days).`);
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
