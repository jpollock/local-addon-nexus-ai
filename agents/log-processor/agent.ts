import { defineAgent, cron } from '@nexus-ai/agent-sdk';
import type { AgentContext, AgentDatabase, AgentToolResult } from '@nexus-ai/agent-sdk';
import {
  initSchema, migrateFromPerSiteSources,
  getBucketConfig, setBucketConfig, setLastScannedAt,
  replaceInstallScans, listInstallScans,
  getLedger, markLedger, saveAggregate, getAggregate,
  getAggregatesInRange, evict, storageStats, wipeAggregatesAndLedger,
} from './db';
import {
  emptyAggregate, foldLine, finalizeAggregate, enableIpTracking,
  parseLogLine, classifyLine,
  s3ListAll, s3StreamLines, S3Error,
  probeBucketRegion, findSiblingPrefixWithLogs,
  parseInstallIdFromKey, scanBucketForInstalls, normalizeLogPrefix,
  fileDatesForRange, addDays, utcToday, fmtMB,
  TAXONOMY_VERSION,
} from './access-logs';
import type { BucketScan, DayAggregate } from './access-logs';

const ok  = (text: string): AgentToolResult => ({ content: [{ type: 'text', text }] });
const err = (text: string): AgentToolResult => ({ content: [{ type: 'text', text }], isError: true });
const okOrErr = (text: string): AgentToolResult => text.startsWith('⚠') ? err(text) : ok(text);
const DEFAULT_SYNC_DAYS = 28;
const DEFAULT_SYNC_BUDGET_MB = 512;
const GZ_EXPANSION = 11;

const NO_BUCKET = '⚠ No log bucket connected. Connect one from the agent\'s Sites tab, or run set_log_bucket bucket="…" region="…" prefix="…".';

function openDb(ctx: AgentContext): AgentDatabase {
  const db = ctx.db.open('logs');
  initSchema(db);

  // One-time move off the per-site `sources` model. Self-guarding and cheap, so it sits on the
  // path every entry point already takes rather than in one caller that another could bypass.
  const migrated = migrateFromPerSiteSources(db);
  if (migrated) {
    ctx.log.warn(
      `Migrated ${migrated.rows} per-site log source row(s) onto one account-level bucket: ` +
      `s3://${migrated.chosen.bucket}/${migrated.chosen.prefix} (${migrated.chosen.region}).`,
    );
    for (const d of migrated.discarded) {
      ctx.log.warn(
        `Discarded a disagreeing log location — s3://${d.bucket}/${d.prefix} (${d.region}), ` +
        `named by ${d.sites.join(', ')}. Only one bucket per account is supported; re-point with ` +
        `set_log_bucket if the wrong one was kept.`,
      );
    }
    if (migrated.aggregatesWiped > 0 || migrated.ledgerWiped > 0) {
      ctx.log.warn(
        `Cleared ${migrated.aggregatesWiped} aggregate day(s) and ${migrated.ledgerWiped} ledger row(s). ` +
        `They were built by the old per-site sync, which listed a shared date prefix and folded ` +
        `EVERY install's lines into whichever single site it had been called for — so any account ` +
        `with more than one site in scope had cross-contaminated days. They rebuild on the next sync.`,
      );
    }
  }
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

// ---------------------------------------------------------------------------
// Bucket validation — "validate before write", per handoff_log_sources_v3/DATA-MODEL.md §3.
// Nothing reaches bucket_config until a scan comes back with apache-style objects in it, so a
// failed connect leaves the user in the modal with their input intact and nothing persisted.
// The error codes are structured (§4) because the UI picks a different fix button for each; a
// parsed string is not enough to decide between "open Connected accounts" and "try us-west-2".
// ---------------------------------------------------------------------------

export type BucketValidation =
  | { ok: true; scan: BucketScan }
  | {
      ok: false;
      errorCode: 'InvalidAccessKeyId' | 'SignatureDoesNotMatch' | 'NoSuchBucket' | 'AccessDenied' | 'EmptyPrefix' | 'Unknown';
      message: string;
      suggestedRegion?: string;
      suggestedPrefix?: string;
    };

async function validateAndScanBucket(
  creds: AwsCreds, region: string, bucket: string, prefix: string,
): Promise<BucketValidation> {
  let scan: BucketScan;
  try {
    scan = await scanBucketForInstalls(creds, region, bucket, prefix);
  } catch (e: unknown) {
    if (e instanceof S3Error) {
      if (e.code === 'InvalidAccessKeyId' || e.code === 'SignatureDoesNotMatch') {
        return { ok: false, errorCode: e.code, message: e.message };
      }
      if (e.code === 'NoSuchBucket' || e.code === 'PermanentRedirect') {
        const suggestedRegion = await probeBucketRegion(bucket);
        return { ok: false, errorCode: 'NoSuchBucket', message: e.message, suggestedRegion };
      }
      if (e.code === 'AccessDenied') {
        return { ok: false, errorCode: 'AccessDenied', message: e.message };
      }
    }
    return { ok: false, errorCode: 'Unknown', message: (e as Error).message };
  }

  if (scan.apacheStyleObjects === 0) {
    const suggestedPrefix = await findSiblingPrefixWithLogs(creds, region, bucket, prefix);
    return {
      ok: false, errorCode: 'EmptyPrefix',
      message: scan.totalObjects === 0
        ? `Bucket reachable, but ${prefix || '(root)'} is empty.`
        : `${scan.totalObjects} object(s) found at ${prefix || '(root)'}, but none are apache-style logs.`,
      suggestedPrefix,
    };
  }
  return { ok: true, scan };
}

function commitScan(db: AgentDatabase, scan: BucketScan): void {
  replaceInstallScans(db, scan.installs.map(i => ({
    site: i.installId,
    object_count: i.objectCount,
    bytes: i.bytes,
    oldest_object_at: i.oldest,
    newest_object_at: i.newest,
    sample_key: i.sampleKey,
  })));
  setLastScannedAt(db, Date.now());
}

function describeScan(bucket: string, region: string, prefix: string, scan: BucketScan): string {
  const lines = scan.installs.map(i =>
    `  ${i.installId}: ${i.objectCount.toLocaleString()} apache-style object(s), ${i.oldest} → ${i.newest} (${fmtMB(i.bytes)})`,
  ).join('\n');
  return (
    `s3://${bucket}/${prefix} (${region})\n` +
    `${scan.apacheStyleObjects.toLocaleString()} apache-style object(s) across ${scan.installs.length} install(s), ` +
    `out of ${scan.totalObjects.toLocaleString()} object(s) total` +
    (scan.unparsedObjects > 0 ? ` (${scan.unparsedObjects} filename(s) unrecognised)` : '') + '.\n' +
    (scan.truncated ? '⚠ Listing hit its object cap — the counts below are a floor, not a total.\n' : '') +
    lines
  );
}

// ---------------------------------------------------------------------------
// Batched ingestion
//
// The unit of work is a FILE-DATE, not a site. Every install of an account shares one flat
// prefix, so listing `prefix + YYYYMMDD` returns every install's objects for that date at once.
// Each object is routed to a site by the install id parsed out of its filename.
//
// The previous per-site version listed exactly the same shared prefix, filtered to apache-style,
// and then attributed EVERY file it found to the single site the call was made for. Two bugs fell
// out of that: other installs' traffic was folded into the wrong site's aggregates, and the same
// objects were downloaded once per site in scope. Routing by filename fixes both — a site only
// ever sees its own objects, and each object is fetched at most once per run.
// ---------------------------------------------------------------------------

type SyncOutcome = { site: string; dates: number; requests: number; skipped: number };

async function runBatchSync(
  db: AgentDatabase, siteIds: string[],
  from: string | undefined, to: string | undefined,
  budgetMB: number, ctx: AgentContext,
): Promise<string> {
  const cfg = getBucketConfig(db);
  if (!cfg) return NO_BUCKET;

  const sites = Array.from(new Set(siteIds.filter(s => typeof s === 'string' && s.length > 0)));
  if (sites.length === 0) return '⚠ No sites given to sync.';

  const creds = await getAwsCreds(ctx);
  if ('error' in creds) return `⚠ ${creds.error}`;

  const toDay = to ?? addDays(utcToday(), -1);
  const fromDay = from ?? addDays(toDay, -(DEFAULT_SYNC_DAYS - 1));
  const budgetBytes = Math.max(16, Math.min(budgetMB, 4096)) * 1048576;

  const allDates = fileDatesForRange(fromDay, toDay);
  const wantedBySite = new Map<string, Set<string>>();
  for (const site of sites) {
    const ledger = getLedger(db, site);
    const want = allDates.filter(d => !ledger[d]);
    if (want.length > 0) wantedBySite.set(site, new Set(want));
  }
  if (wantedBySite.size === 0) {
    return `✓ Up to date — every file-date for ${fromDay} → ${toDay} is already processed for ${sites.length} site(s).`;
  }

  const datesToList = Array.from(
    new Set(Array.from(wantedBySite.values()).flatMap(s => Array.from(s))),
  ).sort();

  // --- Plan: one listing per date, shared by every site in the batch.
  type DatePlan = { date: string; bytes: number; bySite: Map<string, { key: string; size: number }[]> };
  const plan: DatePlan[] = [];
  let planned = 0;
  let deferredDates = 0;

  for (let i = 0; i < datesToList.length; i++) {
    const date = datesToList[i];
    const wanters = sites.filter(s => wantedBySite.get(s)?.has(date));
    if (wanters.length === 0) continue;

    let objects: { key: string; size: number }[];
    try {
      objects = await s3ListAll(creds, cfg.region, cfg.bucket, normalizeLogPrefix(cfg.prefix) + date.replace(/-/g, ''));
    } catch (e: unknown) {
      return `⚠ S3 listing failed at ${date}: ${(e as Error).message}`;
    }

    // A site with no objects on this date still gets an (empty) entry, so it is ledgered and
    // never re-listed. Objects belonging to installs outside this batch are simply not routed.
    const bySite = new Map<string, { key: string; size: number }[]>();
    for (const s of wanters) bySite.set(s, []);
    let bytes = 0;
    for (const o of objects) {
      const parsed = parseInstallIdFromKey(o.key);
      if (!parsed || parsed.kind !== 'apachestyle') continue;
      const target = bySite.get(parsed.installId);
      if (!target) continue;
      target.push({ key: o.key, size: o.size });
      bytes += o.size;
    }

    if (bytes > 0 && planned + bytes > budgetBytes && plan.some(p => p.bytes > 0)) {
      deferredDates = datesToList.length - i;
      break;
    }
    if (bytes > budgetBytes) ctx.log.warn(`${date} alone is ${fmtMB(bytes)} — over budget, processing anyway`);
    plan.push({ date, bytes, bySite });
    planned += bytes;
  }

  ctx.log.info(
    `Plan: ${plan.length} file-date(s) across ${sites.length} site(s), ${fmtMB(planned)} compressed` +
    (deferredDates > 0 ? `, ${deferredDates} date(s) deferred` : ''),
  );

  const perSite = new Map<string, SyncOutcome>(sites.map(s => [s, { site: s, dates: 0, requests: 0, skipped: 0 }]));

  for (const p of plan) {
    const touched = new Map<string, DayAggregate>();   // key: `${site}|${day}`
    const erroredSites = new Set<string>();
    const skippedBySite = new Map<string, number>();
    const linesBySite = new Map<string, number>();

    for (const [site, files] of p.bySite) {
      let fileSkipped = 0;
      let siteLines = 0;
      for (const f of files) {
        ctx.log.info(`${site} ${p.date}: streaming ${f.key.split('/').pop()} (${fmtMB(f.size)})`);
        try {
          for await (const line of s3StreamLines(creds, cfg.region, cfg.bucket, f.key)) {
            if (!line.trim()) continue;
            const parsed = parseLogLine(line);
            if (!parsed) { fileSkipped++; continue; }
            const key = `${site}|${parsed.day}`;
            let agg = touched.get(key);
            if (!agg) {
              const existing = getAggregate(db, site, parsed.day);
              agg = existing ? { ...existing } : emptyAggregate(site, parsed.day);
              enableIpTracking(agg);
              touched.set(key, agg);
            }
            foldLine(agg, parsed, classifyLine(parsed));
            siteLines++;
          }
        } catch (e: unknown) {
          const msg = (e as Error).message;
          ctx.log.error(`Stream error for ${f.key}: ${msg} — ${site} ${p.date} left un-ledgered for retry`);
          if (msg.includes('InvalidAccessKeyId') || msg.includes('SignatureDoesNotMatch')) {
            ctx.credentials.revokeCredential?.('aws').catch(() => {});
            return '⚠ AWS credentials are no longer valid. Re-enter them in Preferences → Connected accounts → AWS S3.';
          }
          erroredSites.add(site);
        }
      }
      skippedBySite.set(site, fileSkipped);
      linesBySite.set(site, siteLines);
    }

    // Unparsed lines carry no date, so they cannot be attributed to a day. Charge them to the
    // site's aggregate for the file-date itself when there is one — never to every day the batch
    // touched, which multiplies the count by the number of days a rotation spans.
    for (const [site, skipped] of skippedBySite) {
      if (skipped === 0) continue;
      const home = touched.get(`${site}|${p.date}`)
        ?? Array.from(touched.entries()).find(([k]) => k.startsWith(`${site}|`))?.[1];
      if (home) home.skippedLines = (home.skippedLines ?? 0) + skipped;
    }

    // Aggregates and the ledger are written together or not at all. A site whose stream failed
    // keeps its previous aggregate rows and stays un-ledgered, so the retry re-folds from the
    // same starting point. Saving a partial fold while withholding the ledger entry — what this
    // used to do — double-counts every line of that date on the next run.
    for (const [key, agg] of touched) {
      const site = key.slice(0, key.indexOf('|'));
      if (erroredSites.has(site)) continue;
      saveAggregate(db, finalizeAggregate({ ...agg }));
    }

    for (const [site, files] of p.bySite) {
      if (erroredSites.has(site)) continue;
      const lines = linesBySite.get(site) ?? 0;
      markLedger(db, {
        site, file_date: p.date,
        files: files.length,
        bytes: files.reduce((s, f) => s + f.size, 0),
        lines,
        processed_at: Date.now(),
      });
      const out = perSite.get(site);
      if (out) { out.dates++; out.requests += lines; out.skipped += skippedBySite.get(site) ?? 0; }
    }
  }

  for (const site of sites) evict(db, site, 180);

  const active = Array.from(perSite.values()).filter(o => o.dates > 0);
  const totalRequests = active.reduce((s, o) => s + o.requests, 0);
  const detail = active.map(o =>
    `  ${o.site}: ${o.dates} file-date(s), ~${o.requests.toLocaleString()} requests` +
    (o.skipped > 0 ? `, ${o.skipped} line(s) skipped` : ''),
  ).join('\n');
  const idle = Array.from(perSite.values()).filter(o => o.dates === 0).map(o => o.site);

  return (
    `✓ ${active.length} site(s), ${plan.length} file-date(s), ~${totalRequests.toLocaleString()} requests` +
    (deferredDates > 0 ? `, ${deferredDates} date(s) deferred to the next run` : '') + '.' +
    (detail ? `\n${detail}` : '') +
    (idle.length > 0 ? `\n  Already up to date: ${idle.join(', ')}` : '')
  );
}

export default defineAgent({
  name: 'log-processor',
  version: '2.0.0',
  description: 'Access log ingestion and read contract. Streams WPE Apache-style logs from S3, folds into daily aggregates, serves seo-insights and security-sentinel via contributed tools.',
  // Reads from S3 and writes only to its own local sqlite aggregates — never touches the WP
  // site itself. Drives the site picker's production-warning verb: "will be scanned", not
  // "modified".
  effect: 'readonly',
  // No gated action, no standalone report — a pure ingestion pipeline whose only output is
  // ledger/aggregate rows another agent (seo-insights, security-sentinel) reads via contributed
  // tools. producesApprovals/producesReports left undeclared: both default to false, and that's
  // the correct value here, not an oversight.
  triggers: [cron('0 3 * * *')],
  credentials: [{
    provider: 'aws',
    type: 'api_key' as const,
    optional: true,
    reason: 'Reads WP Engine access logs from your S3 bucket',
  }],
  contributes: {
    tools: {

      set_log_bucket: {
        description: 'Point the agent at the one S3 bucket + prefix WP Engine writes this account\'s access logs into. There is no per-site bucket: every install shares the prefix and is separated by the install id in each filename. Validates by listing and grouping; nothing is saved unless apache-style logs are found. Which installs actually run is the site scope, not this call.',
        inputSchema: {
          type: 'object',
          properties: {
            bucket: { type: 'string' },
            region: { type: 'string', default: 'us-east-1' },
            prefix: { type: 'string', default: '', description: 'Typically wpe_logs/nginx/ — one folder for the whole account.' },
            dryRun: { type: 'boolean', default: false, description: 'Scan and report without saving.' },
            format: { type: 'string', enum: ['text', 'json'], default: 'text', description: 'json returns the structured scan/error payload the Sites tab renders.' },
          },
          required: ['bucket'],
        },
        executionMode: 'function' as const,
        handler: async (
          args: { bucket: string; region?: string; prefix?: string; dryRun?: boolean; format?: 'text' | 'json' },
          ctx: AgentContext,
        ): Promise<AgentToolResult> => {
          ctx.log.phase('set_log_bucket', args.bucket);
          const region = args.region ?? 'us-east-1';
          // Normalized here, once, so the value that is validated is the value that is stored and
          // later concatenated onto — see normalizeLogPrefix for why a missing trailing slash
          // scans clean and then syncs nothing.
          const prefix = normalizeLogPrefix(args.prefix);
          const json = args.format === 'json';

          const creds = await getAwsCreds(ctx);
          if ('error' in creds) {
            return json
              ? err(JSON.stringify({ ok: false, errorCode: 'NotConnected', message: creds.error }))
              : err(`⚠ ${creds.error}`);
          }

          const result = await validateAndScanBucket(creds, region, args.bucket, prefix);

          if (!result.ok) {
            if (result.errorCode === 'InvalidAccessKeyId' || result.errorCode === 'SignatureDoesNotMatch') {
              ctx.credentials.revokeCredential?.('aws').catch(() => {});
            }
            if (json) return err(JSON.stringify(result));
            if (result.errorCode === 'InvalidAccessKeyId' || result.errorCode === 'SignatureDoesNotMatch') {
              return err('⚠ AWS credentials are no longer valid. Re-enter them in Preferences → Connected accounts → AWS S3.');
            }
            if (result.errorCode === 'NoSuchBucket') {
              return err(`⚠ No bucket named ${args.bucket} in ${region}.` + (result.suggestedRegion ? ` Try region "${result.suggestedRegion}".` : ''));
            }
            if (result.errorCode === 'EmptyPrefix') {
              return err(`⚠ ${result.message}` + (result.suggestedPrefix ? ` Try prefix "${result.suggestedPrefix}".` : ''));
            }
            return err(`⚠ Could not list s3://${args.bucket}/${prefix}: ${result.message}`);
          }

          if (args.dryRun) {
            return json
              ? ok(JSON.stringify({ ok: true, dryRun: true, bucket: args.bucket, region, prefix, scan: result.scan }))
              : ok(`(dry run — nothing saved)\n${describeScan(args.bucket, region, prefix, result.scan)}`);
          }

          const db = openDb(ctx);
          // Re-pointing at a different location invalidates the ledger: it records which
          // file-dates were processed, and that is only meaningful against the bucket they came
          // from. Leaving it in place would make every already-ledgered date unreachable in the
          // new bucket, which reads as "the new bucket has no data".
          const prev = getBucketConfig(db);
          const moved = !!prev && (prev.bucket !== args.bucket || prev.region !== region || prev.prefix !== prefix);
          const wiped = moved ? wipeAggregatesAndLedger(db) : { aggregates: 0, ledger: 0 };
          if (moved) {
            ctx.log.warn(
              `Log bucket changed from s3://${prev!.bucket}/${prev!.prefix} (${prev!.region}) — cleared ` +
              `${wiped.aggregates} aggregate day(s) and ${wiped.ledger} ledger row(s) collected from it.`,
            );
          }
          setBucketConfig(db, { bucket: args.bucket, region, prefix });
          commitScan(db, result.scan);

          if (json) {
            return ok(JSON.stringify({
              ok: true, dryRun: false, bucket: args.bucket, region, prefix,
              scan: result.scan,
              cleared: moved ? wiped : undefined,
            }));
          }
          return ok(
            `✓ Log bucket connected.\n${describeScan(args.bucket, region, prefix, result.scan)}` +
            (moved ? `\n\nCleared ${wiped.aggregates} aggregate day(s) and ${wiped.ledger} ledger row(s) from the previous bucket.` : '') +
            `\n\nNext: switch installs on in the agent's Sites tab to include them in every run.`,
          );
        },
      },

      rescan_log_bucket: {
        description: 'Re-list the connected bucket and refresh which installs have apache-style logs in it, with counts and date ranges. Read-only against S3 and against the aggregates — it only refreshes the install cache the Sites tab reads.',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['text', 'json'], default: 'text' },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { format?: 'text' | 'json' }, ctx: AgentContext): Promise<AgentToolResult> => {
          ctx.log.phase('rescan_log_bucket');
          const json = args.format === 'json';
          const db = openDb(ctx);
          const cfg = getBucketConfig(db);
          if (!cfg) return json ? err(JSON.stringify({ ok: false, errorCode: 'NoBucket', message: NO_BUCKET })) : err(NO_BUCKET);

          const creds = await getAwsCreds(ctx);
          if ('error' in creds) {
            return json
              ? err(JSON.stringify({ ok: false, errorCode: 'NotConnected', message: creds.error }))
              : err(`⚠ ${creds.error}`);
          }

          const result = await validateAndScanBucket(creds, cfg.region, cfg.bucket, normalizeLogPrefix(cfg.prefix));
          if (!result.ok) {
            if (result.errorCode === 'InvalidAccessKeyId' || result.errorCode === 'SignatureDoesNotMatch') {
              ctx.credentials.revokeCredential?.('aws').catch(() => {});
            }
            return json ? err(JSON.stringify(result)) : err(`⚠ Rescan failed: ${result.message}`);
          }

          // Write the normalized prefix back, so a value stored by an earlier build stops being
          // one that scans clean and syncs nothing. Same bucket and region — this is a repair of
          // the stored form, not a re-point, so nothing is cleared.
          const prefix = normalizeLogPrefix(cfg.prefix);
          if (prefix !== cfg.prefix) {
            setBucketConfig(db, { bucket: cfg.bucket, region: cfg.region, prefix });
            ctx.log.info(`Normalized stored log prefix "${cfg.prefix}" → "${prefix}".`);
          }
          commitScan(db, result.scan);
          return json
            ? ok(JSON.stringify({ ok: true, bucket: cfg.bucket, region: cfg.region, prefix, scan: result.scan }))
            : ok(`✓ Rescanned.\n${describeScan(cfg.bucket, cfg.region, prefix, result.scan)}`);
        },
      },

      sync_access_logs: {
        description: 'Ingest access-log days from S3: streams each file (constant memory — raw bytes never persist), classifies traffic, folds into per-day aggregates. Ledgered and budgeted; large backfills resume across runs. Pass several sites to share one listing pass per date.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'WPE install name. Use siteIds for more than one.' },
            siteIds: { type: 'array', items: { type: 'string' }, description: 'Several WPE install names, processed in one batched pass.' },
            from: { type: 'string', description: 'First day (YYYY-MM-DD). Default: 28 days ago.' },
            to: { type: 'string', description: 'Last day (YYYY-MM-DD). Default: yesterday (UTC).' },
            budgetMB: { type: 'number', default: 512 },
          },
        },
        executionMode: 'function' as const,
        handler: async (
          args: { siteId?: string; siteIds?: string[]; from?: string; to?: string; budgetMB?: number },
          ctx: AgentContext,
        ): Promise<AgentToolResult> => {
          const sites = [...(args.siteIds ?? []), ...(args.siteId ? [args.siteId] : [])];
          if (sites.length === 0) return err('⚠ Pass siteId or siteIds.');
          ctx.log.phase('sync_access_logs', sites.join(', '));
          const db = openDb(ctx);
          return okOrErr(await runBatchSync(db, sites, args.from, args.to, args.budgetMB ?? DEFAULT_SYNC_BUDGET_MB, ctx));
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
        executionMode: 'function' as const,
        handler: async (
          args: { siteId: string; from: string; to: string; ip?: string; pathContains?: string; uaContains?: string; status?: number; confirm?: boolean },
          ctx: AgentContext,
        ): Promise<AgentToolResult> => {
          ctx.log.phase('fetch_log_window', args.confirm ? 'execute' : 'estimate');
          const db = openDb(ctx);
          const cfg = getBucketConfig(db);
          if (!cfg) return err(NO_BUCKET);
          const creds = await getAwsCreds(ctx);
          if ('error' in creds) return err(`⚠ ${creds.error}`);

          // Same filename routing the ingest path uses. Listing alone is account-wide; without
          // this filter a forensic window for one install returns every install's traffic.
          const want = args.siteId.toLowerCase();
          const allFiles: { key: string; size: number }[] = [];
          for (const date of fileDatesForRange(args.from, args.to)) {
            const objects = await s3ListAll(creds, cfg.region, cfg.bucket, normalizeLogPrefix(cfg.prefix) + date.replace(/-/g, ''));
            for (const o of objects) {
              const parsed = parseInstallIdFromKey(o.key);
              if (parsed?.kind === 'apachestyle' && parsed.installId === want) allFiles.push(o);
            }
          }
          if (allFiles.length === 0) {
            return err(`⚠ No apache-style objects for "${args.siteId}" in s3://${cfg.bucket}/${cfg.prefix} between ${args.from} and ${args.to}.`);
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
              for await (const line of s3StreamLines(creds, cfg.region, cfg.bucket, f.key)) {
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
        description: 'Report the connected bucket, the installs found in it, and the local disk footprint: per-site aggregate days, ledger coverage, last sync, approximate KB. Raw logs are never stored locally.',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['text', 'json'], default: 'text' },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { format?: 'text' | 'json' }, ctx: AgentContext): Promise<AgentToolResult> => {
          const db = openDb(ctx);
          const cfg = getBucketConfig(db);
          const installs = listInstallScans(db);
          const stats = storageStats(db);

          if (args.format === 'json') {
            return ok(JSON.stringify({ bucket: cfg ?? null, installs, storage: stats }, null, 2));
          }
          if (!cfg) return ok(NO_BUCKET.replace(/^⚠ /, ''));

          const header =
            `Bucket: s3://${cfg.bucket}/${cfg.prefix} (${cfg.region})\n` +
            `Installs with apache-style logs: ${installs.length}` +
            (cfg.last_scanned_at ? `, last scanned ${new Date(cfg.last_scanned_at).toISOString()}` : ', never scanned');

          if (stats.length === 0) return ok(`${header}\n\nNothing processed yet.`);
          const lines = stats.map(s =>
            `  ${s.site}: ${s.objectCount.toLocaleString()} object(s) in bucket, ${s.aggregateDays} agg days, ` +
            `${s.ledgerDays} ledgered file-dates, ~${(s.approxBytes / 1024).toFixed(1)}KB — ` +
            (s.lastSyncedAt ? `last synced ${new Date(s.lastSyncedAt).toISOString()}` : 'never synced'),
          ).join('\n');
          const totalKB = (stats.reduce((s, r) => s + r.approxBytes, 0) / 1024).toFixed(1);
          return ok(`${header}\n\n${lines}\n\nFleet total: ~${totalKB}KB`);
        },
      },

      evict_log_data: {
        description: 'Delete local log-derived data older than N days. Removes from aggregates and ledger. Never touches the bucket binding or the S3 bucket itself.',
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
    // AGENT_RUN_NOW (src/main/ipc-handlers.ts) invokes run() ONCE PER SELECTED SITE, each call
    // carrying a scoped event `{ payload: { installName: <that site> } }` — the same convention
    // security-sentinel's getScanScope(event) reads. A run() that ignores the event and always
    // processes the full ctx.settings.scope.siteIds (as this one used to) gets fired that many
    // times over, each pass reprocessing every scoped site — picking 2 sites in Run Now ran the
    // *entire* sync twice. Honoring a single-site event target makes each of the N calls do 1/N
    // of the work instead of all of it N times.
    const eventSite = (ctx.event?.payload as Record<string, unknown> | undefined)?.installName as string | undefined;
    ctx.log.phase('cron', eventSite ? `log-processor sync: ${eventSite}` : 'log-processor nightly sync');
    const db = openDb(ctx);

    const cfg = getBucketConfig(db);
    if (!cfg) {
      ctx.log.info('No log bucket connected. Connect one in the agent\'s Sites tab.');
      return;
    }

    // The gate is the agent's site scope (ctx.settings.scope.siteIds) — the switch on each row of
    // the Sites tab writes exactly this field, so there is one list, not a scope picker and a
    // sources table disagreeing with each other. Absent/empty scope processes nothing,
    // deliberately: the same "unconfigured must never mean everything" rule security-sentinel's
    // resolveScanScope documents. An explicitly-targeted call (Run Now, or an event naming one
    // install) is not constrained by scope — the user named the target.
    let scopedSiteIds: string[];
    if (eventSite) {
      scopedSiteIds = [eventSite];
    } else {
      const scope = ctx.settings?.scope as { siteIds?: unknown } | undefined;
      scopedSiteIds = Array.isArray(scope?.siteIds)
        ? scope!.siteIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (scopedSiteIds.length === 0) {
        ctx.log.info('No sites in scope for scheduled log processing. Switch installs on in the agent\'s Sites tab.');
        return;
      }
    }

    // An install with no objects in the bucket cannot be switched on in the UI, so this should
    // never fire from the Sites tab. It still can from a stale scope written before a rescan, or
    // from a hand-edited setting — warn rather than silently listing dates that hold nothing.
    let sites = scopedSiteIds;
    const scans = listInstallScans(db);
    if (scans.length > 0) {
      const withLogs = new Set(scans.filter(s => s.object_count > 0).map(s => s.site));
      sites = scopedSiteIds.filter(s => withLogs.has(s));
      const missing = scopedSiteIds.filter(s => !withLogs.has(s));
      if (missing.length > 0) {
        ctx.log.warn(
          `${missing.length} scoped install(s) have no apache-style objects in ` +
          `s3://${cfg.bucket}/${cfg.prefix} and were skipped: ${missing.join(', ')}. ` +
          `Rescan the bucket if they were added recently.`,
        );
      }
    }
    if (sites.length === 0) {
      ctx.log.info('No scoped installs have logs in the connected bucket. Nothing to process.');
      return;
    }

    ctx.log.info(`Processing ${sites.length} install(s): ${sites.join(', ')}`);
    const summary = await runBatchSync(db, sites, undefined, undefined, DEFAULT_SYNC_BUDGET_MB, ctx);
    ctx.log.info(summary);
    return { summary };
  },
});
