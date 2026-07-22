// ---------------------------------------------------------------------------
// access-logs.ts — WPE Apache-style access log ingestion + analysis over S3.
// v2: streaming ingestion, size-aware planning, day ledger.
//
// Design (from the sample-log investigation + the NitroPack scale check):
//   demand-triggered, process-once, stream-everything.
//   - The bucket IS the event store. Local never persists raw log bytes —
//     not on disk, not fully in memory. A 730MB log day flows through as a
//     stream (fetch → gunzip → line split → classify → fold) in constant
//     memory and lands as ~1.5KB of daily aggregate.
//   - A processed-day ledger guarantees every day is downloaded and parsed
//     exactly once, ever. Opportunistic for small sites (nothing ingested
//     until an analysis asks), pipeline economics for big ones (never re-pay
//     for a day).
//   - Sync runs are budgeted in bytes, not file counts: the planner prices
//     the work from ListObjectsV2 sizes and stops cleanly at the budget;
//     backfill resumes across runs.
//   - Forensic raw-window queries (fetch_log_window) are two-phase: first
//     call returns the cost estimate; confirm=true streams the window with a
//     filter and persists nothing.
//
// Credential model: AWS access keys via the credential manager's api_key
// provider (credential-manager brief v1.1). The agent receives the secret at
// runtime to sign requests, and never stores or logs it. Recommended IAM:
// dedicated user, s3:GetObject + s3:ListBucket scoped to the log bucket.
//
// No external deps: SigV4 over node:crypto, streaming via node:stream/zlib/
// readline, ListObjectsV2 XML parsed with targeted regexes.
//
// Known quirk of the WPE filename convention (YYYYMMDD-HHMM-{install}_...):
// the timestamp is the ROTATION time, so a file dated 0319-0010 mostly holds
// 03-18 lines. Listing for day D therefore covers filename-dates D and D+1;
// folding is always by each line's parsed date, so aggregates stay correct.
// ---------------------------------------------------------------------------

import { createHash, createHmac } from 'crypto';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import { createInterface } from 'readline';

// Minimal ctx shapes (mirrors agent.ts usage; real types come from the SDK).
type Tools = { invoke(name: string, args: unknown): Promise<unknown> };
type State = { get<T = unknown>(key: string): T | undefined; set(key: string, value: unknown): void };
type Log = {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  phase(name: string, detail?: string): void;
  finding(f: Record<string, unknown>): void;
};
type Credentials = {
  getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'>;
  requestConnection(provider: string): Promise<void>;
  // api_key extension (credential-manager brief v1.1) — feature-detected at runtime
  getSecret?(provider: string): Promise<Record<string, string>>;
};
type Ctx = { tools: Tools; state: State; log: Log; credentials: Credentials };

const GZ_EXPANSION = 11;                // observed ~50-80MB gz → ~730MB raw

// ---------------------------------------------------------------------------
// SigV4 (GET-only S3 client)
// ---------------------------------------------------------------------------

type AwsCreds = { accessKeyId: string; secretAccessKey: string };

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// RFC3986-encode a key path, preserving '/' between segments.
function encodeS3Path(key: string): string {
  return key.split('/').map(seg =>
    encodeURIComponent(seg).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()),
  ).join('/');
}

function signedS3Request(
  creds: AwsCreds,
  region: string,
  bucket: string,
  path: string,                       // '/' or '/some/key'
  query: Record<string, string>,
): { url: string; headers: Record<string, string> } {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex('');

  const canonicalUri = encodeS3Path(path) || '/';
  const canonicalQuery = Object.keys(query).sort().map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(query[k]).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`,
  ).join('&');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + creds.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}${canonicalQuery ? '?' + canonicalQuery : ''}`,
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  };
}

export type S3Object = { key: string; size: number };

async function s3ListObjects(
  creds: AwsCreds, region: string, bucket: string, prefix: string,
  continuationToken?: string,
): Promise<{ objects: S3Object[]; nextToken?: string }> {
  const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
  if (continuationToken) query['continuation-token'] = continuationToken;

  const { url, headers } = signedS3Request(creds, region, bucket, '/', query);
  const res = await fetch(url, { headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`S3 ListObjectsV2 ${res.status}: ${body.slice(0, 300)}`);

  // Pair <Key> and <Size> within each <Contents> block (sizes drive the planner).
  const objects: S3Object[] = [];
  for (const m of body.matchAll(/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)) {
    objects.push({ key: m[1], size: parseInt(m[2], 10) });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(body);
  const nextToken = truncated
    ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(body)?.[1])
    : undefined;
  return { objects, nextToken };
}

export async function s3ListAll(
  creds: AwsCreds, region: string, bucket: string, prefix: string, maxObjects = 5000,
): Promise<S3Object[]> {
  const out: S3Object[] = [];
  let token: string | undefined;
  do {
    const page = await s3ListObjects(creds, region, bucket, prefix, token);
    out.push(...page.objects);
    token = page.nextToken;
  } while (token && out.length < maxObjects);
  return out;
}

// ---------------------------------------------------------------------------
// Streaming object reader — constant memory regardless of object size.
// fetch body (web stream) → node Readable → optional gunzip → readline.
// A 730MB day never exists in full anywhere.
// ---------------------------------------------------------------------------

export async function* s3StreamLines(
  creds: AwsCreds, region: string, bucket: string, key: string,
): AsyncGenerator<string> {
  const { url, headers } = signedS3Request(creds, region, bucket, '/' + key, {});
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) throw new Error(`S3 GetObject ${res.status} for ${key}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let input: Readable = Readable.fromWeb(res.body as any);
  if (key.endsWith('.gz')) {
    const gz = createGunzip();
    input.pipe(gz);
    input.on('error', (e: Error) => gz.destroy(e));
    input = gz as unknown as Readable;
  }
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

// Exposed for tests: same pipeline over any Readable (e.g. a local file).
export async function* streamLines(input: Readable, gz: boolean): AsyncGenerator<string> {
  let src: Readable = input;
  if (gz) {
    const g = createGunzip();
    input.pipe(g);
    input.on('error', (e: Error) => g.destroy(e));
    src = g as unknown as Readable;
  }
  const rl = createInterface({ input: src, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

// ---------------------------------------------------------------------------
// Apache-style (combined + vhost) log parsing
// Sample: IP vhost - [18/Mar/2025:00:18:42 +0000] "POST /wp-login.php HTTP/1.0" 403 5501 "-" "Mozilla/..."
// ---------------------------------------------------------------------------

export type LogLine = {
  ip: string; vhost: string; time: string; day: string; // day = YYYY-MM-DD
  method: string; path: string; status: number; bytes: number;
  referrer: string; ua: string;
};

const LINE_RX = /^(\S+)\s+(\S+)\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"/;
const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

export function parseLogLine(line: string): LogLine | null {
  const m = LINE_RX.exec(line);
  if (!m) return null;
  const [, ip, vhost, time, request, status, bytes, referrer, ua] = m;
  const reqParts = request.split(' ');
  const method = reqParts[0] ?? '';
  const path = (reqParts[1] ?? '') || '/';
  // 18/Mar/2025:00:18:42 +0000 → 2025-03-18
  const dm = /^(\d{2})\/([A-Za-z]{3})\/(\d{4})/.exec(time);
  const day = dm ? `${dm[3]}-${MONTHS[dm[2]] ?? '00'}-${dm[1]}` : 'unknown';
  return {
    ip, vhost, time, day, method, path,
    status: parseInt(status, 10),
    bytes: bytes === '-' ? 0 : parseInt(bytes, 10) || 0,
    referrer, ua,
  };
}

// ---------------------------------------------------------------------------
// Traffic classification
// UA taxonomy tables are DATA — they churn quarterly; keep them versioned and
// additive. Order matters: first match wins within crawler categories.
// ---------------------------------------------------------------------------

export const TAXONOMY_VERSION = '2026-07';

// AI training crawlers — shape the model's baseline knowledge of the site.
const AI_TRAINING: Array<[string, RegExp]> = [
  ['GPTBot', /gptbot/i],
  ['ClaudeBot', /claudebot|claude-web|anthropic-ai/i],
  ['CCBot', /ccbot/i],
  ['Bytespider', /bytespider/i],
  ['Meta-External', /meta-externalagent|facebookbot/i],
  ['Amazonbot', /amazonbot/i],
  ['Applebot-Ext', /applebot-extended/i],
  ['Google-Extended', /google-extended/i],
  ['Diffbot', /diffbot/i],
  ['Cohere', /cohere/i],
];

// AI retrieval/search crawlers — the site is being pulled into live answers.
const AI_RETRIEVAL: Array<[string, RegExp]> = [
  ['OAI-SearchBot', /oai-searchbot/i],
  ['ChatGPT-User', /chatgpt-user/i],
  ['PerplexityBot', /perplexitybot/i],
  ['Perplexity-User', /perplexity-user/i],
  ['Claude-User', /claude-user/i],
  ['DuckAssistBot', /duckassistbot/i],
  ['YouBot', /youbot/i],
  ['MistralAI', /mistralai/i],
];

const SEARCH_BOTS: Array<[string, RegExp]> = [
  ['Googlebot', /googlebot(?!-image)/i],
  ['Googlebot-Image', /googlebot-image/i],
  ['Bingbot', /bingbot/i],
  ['Applebot', /applebot(?!-extended)/i],
  ['DuckDuckBot', /duckduckbot/i],
  ['YandexBot', /yandexbot/i],
  ['Baiduspider', /baiduspider/i],
  ['PetalBot', /petalbot/i],
];

const SEO_TOOLS = /ahrefsbot|semrushbot|mj12bot|dotbot|dataforseobot|screaming frog|rogerbot|blexbot/i;
const MONITORING = /lighthouse|pingdom|uptimerobot|statuscake|gtmetrix|newrelicpinger|site24x7/i;
const PLATFORM = /^wordpress\//i;                              // wp-cron self-calls, pingbacks
const GENERIC_BOT = /bot|crawler|spider|scrapy|httpclient|python-requests|python-urllib|curl\/|wget\/|go-http-client|libwww|okhttp|zgrab|nuclei|masscan|censys/i;
const SCANNER_UA = /zgrab|nuclei|masscan|censys|python-requests|python-urllib|go-http-client|libwww/i;

// Attack/probe path dictionary — from observed scanner behavior. Behavioral,
// not UA-based: scanners routinely spoof browser UAs (and Google referrers).
const PROBE_PATH = new RegExp([
  '^/\\.env', '^/\\.git', '^/\\.vscode', '^/\\.aws', '^/\\.ssh',
  'wlwmanifest\\.xml', '^/wp-plain\\.php', '^/uploaded_script\\.php',
  '^/(wp|wordpress|old|new|main|home|bk|bc|backup|bak|test|demo|site|blog2)/?$',
  '^/[a-z]{8}\\.php$',                    // random-8-char backdoor probes
  '\\.php\\?fox=', '^/ans\\.php', '^/ws\\.php', '^/wp\\.php', '^/simple\\.php',
  '^/xmlrpc\\.php', '^/wp-login\\.php',   // classified attack only for POST (below)
  '^/vendor/phpunit', '^/phpmyadmin', '^/pma', '^/adminer',
  '^/aspera', '^/faspex', '^/owa(/|$)', '^/ecp(/|$)', '^/cgi-bin', '^/solr', '^/actuator', '^/telescope', '^/_ignition', '^/console(/|$)',
].join('|'), 'i');

// Login/xmlrpc GETs can be legitimate; POSTs at volume are brute force.
const AUTH_PATH = /^\/+(wp-login\.php|xmlrpc\.php)/i;

const AI_REFERRER_HOSTS: Array<[string, RegExp]> = [
  ['ChatGPT', /(^|\.)chatgpt\.com|chat\.openai\.com/i],
  ['Perplexity', /(^|\.)perplexity\.ai/i],
  ['Gemini', /gemini\.google\.com|bard\.google\.com/i],
  ['Copilot', /copilot\.microsoft\.com/i],
  ['Claude', /(^|\.)claude\.ai/i],
];

export type TrafficClass =
  | 'ai_training' | 'ai_retrieval' | 'search_bot' | 'seo_tool'
  | 'monitoring' | 'platform' | 'attack' | 'other_bot' | 'human_plausible';

export type Classified = {
  cls: TrafficClass;
  botName?: string;                 // for ai_/search_ classes
  referrerKind: 'none' | 'internal' | 'search' | 'ai' | 'other' | 'spoofed';
  referrerLabel?: string;           // 'Google' | 'ChatGPT' | ...
};

export function classifyLine(l: LogLine): Classified {
  // --- referrer ---
  let referrerKind: Classified['referrerKind'] = 'none';
  let referrerLabel: string | undefined;
  const ref = l.referrer.trim();
  if (ref && ref !== '-') {
    if (!/^https?:\/\//i.test(ref)) {
      // Real browsers send full URLs; scheme-less referrers are spoofed
      // (observed: bare "www.google.com" attached to backdoor probes).
      referrerKind = 'spoofed';
    } else {
      const host = ref.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
      if (host.endsWith(l.vhost.replace(/^www\./, '').toLowerCase())) {
        referrerKind = 'internal';
      } else {
        const ai = AI_REFERRER_HOSTS.find(([, rx]) => rx.test(host));
        if (ai) { referrerKind = 'ai'; referrerLabel = ai[0]; }
        else if (/(^|\.)google\.[a-z.]+$/.test(host)) { referrerKind = 'search'; referrerLabel = 'Google'; }
        else if (/(^|\.)bing\.com$/.test(host)) { referrerKind = 'search'; referrerLabel = 'Bing'; }
        else if (/duckduckgo\.com$/.test(host)) { referrerKind = 'search'; referrerLabel = 'DuckDuckGo'; }
        else referrerKind = 'other';
      }
    }
  }

  // --- UA taxonomy (first match wins) ---
  for (const [name, rx] of AI_TRAINING) if (rx.test(l.ua)) return { cls: 'ai_training', botName: name, referrerKind, referrerLabel };
  for (const [name, rx] of AI_RETRIEVAL) if (rx.test(l.ua)) return { cls: 'ai_retrieval', botName: name, referrerKind, referrerLabel };
  for (const [name, rx] of SEARCH_BOTS) if (rx.test(l.ua)) return { cls: 'search_bot', botName: name, referrerKind, referrerLabel };
  if (SEO_TOOLS.test(l.ua)) return { cls: 'seo_tool', referrerKind, referrerLabel };
  if (MONITORING.test(l.ua)) return { cls: 'monitoring', referrerKind, referrerLabel };
  if (PLATFORM.test(l.ua)) return { cls: 'platform', referrerKind, referrerLabel };

  // --- behavioral attack classification (UA-independent) ---
  const isProbe = PROBE_PATH.test(l.path) && !AUTH_PATH.test(l.path);
  const isAuthAttack = AUTH_PATH.test(l.path) && l.method === 'POST';
  const isAuthorScan = /[?&]author=\d/i.test(l.path);
  if (isProbe || isAuthAttack || isAuthorScan || SCANNER_UA.test(l.ua) || referrerKind === 'spoofed') {
    return { cls: 'attack', referrerKind, referrerLabel };
  }

  if (GENERIC_BOT.test(l.ua)) return { cls: 'other_bot', referrerKind, referrerLabel };
  return { cls: 'human_plausible', referrerKind, referrerLabel };
}

// ---------------------------------------------------------------------------
// Daily aggregate — the durable unit. Kilobytes per site-day; raw lines
// discarded. Fold maps are size-capped, so memory is bounded regardless of
// input volume (a 5M-line day and a 2K-line day cost the same to hold).
// ---------------------------------------------------------------------------

type BotAgg = { hits: number; statuses: Record<string, number>; topPaths: Record<string, number> };

export type DayAggregate = {
  v: 1;
  taxonomyVersion: string;
  site: string;
  day: string;
  skippedLines: number;
  requests: number;
  byClass: Record<string, number>;
  byStatus: Record<string, number>;
  aiTraining: Record<string, BotAgg>;
  aiRetrieval: Record<string, BotAgg>;
  searchBots: Record<string, BotAgg>;
  referrals: { search: Record<string, number>; ai: Record<string, number>; other: number; internal: number; spoofed: number };
  notFound: { scanner: number; contentLike: Record<string, number> };
  attack: {
    requests: number;
    authAttack: Record<string, { loginPosts: Record<string, number>; xmlrpcPosts: Record<string, number> }>;
    enumeration: { userRestApi: Record<string, number>; authorScan: Record<string, number>; restRouteBypass: Record<string, number> };
    probes: Record<string, { hits: number; statuses: Record<string, number> }>;
    ipCardinality: { distinct: number; histogram: { '1': number; '2-5': number; '6-20': number; '21+': number } };
  };
  _ipCounts?: Map<string, number>;
};

export function emptyAggregate(site: string, day: string): DayAggregate {
  return {
    v: 1, taxonomyVersion: TAXONOMY_VERSION, site, day, skippedLines: 0,
    requests: 0, byClass: {}, byStatus: {},
    aiTraining: {}, aiRetrieval: {}, searchBots: {},
    referrals: { search: {}, ai: {}, other: 0, internal: 0, spoofed: 0 },
    notFound: { scanner: 0, contentLike: {} },
    attack: {
      requests: 0, authAttack: {},
      enumeration: { userRestApi: {}, authorScan: {}, restRouteBypass: {} },
      probes: {},
      ipCardinality: { distinct: 0, histogram: { '1': 0, '2-5': 0, '6-20': 0, '21+': 0 } },
    },
  };
}

const bump = (rec: Record<string, number>, key: string, cap = 50) => {
  if (rec[key] !== undefined) { rec[key]++; return; }
  if (Object.keys(rec).length < cap) rec[key] = 1;
};

function botAgg(map: Record<string, BotAgg>, name: string): BotAgg {
  if (!map[name]) map[name] = { hits: 0, statuses: {}, topPaths: {} };
  return map[name];
}

const CONTENT_404_OK = /^\/[a-z0-9][a-z0-9\-/]*\/?$/i; // clean slug paths only

export function foldLine(agg: DayAggregate, l: LogLine, c: Classified): void {
  agg.requests++;
  bump(agg.byClass, c.cls, 20);
  bump(agg.byStatus, String(l.status), 20);

  const foldBot = (map: Record<string, BotAgg>) => {
    const b = botAgg(map, c.botName ?? 'unknown');
    b.hits++;
    bump(b.statuses, String(l.status), 10);
    bump(b.topPaths, l.path, 15);
  };
  if (c.cls === 'ai_training') foldBot(agg.aiTraining);
  if (c.cls === 'ai_retrieval') foldBot(agg.aiRetrieval);
  if (c.cls === 'search_bot') foldBot(agg.searchBots);

  // Referrals: only count for plausible-human traffic — bot and attack referrers
  // are noise, and spoofed referrers must never inflate attribution.
  if (c.cls === 'human_plausible') {
    if (c.referrerKind === 'search') bump(agg.referrals.search, c.referrerLabel ?? 'other');
    else if (c.referrerKind === 'ai') bump(agg.referrals.ai, c.referrerLabel ?? 'other');
    else if (c.referrerKind === 'other') agg.referrals.other++;
    else if (c.referrerKind === 'internal') agg.referrals.internal++;
  }
  if (c.referrerKind === 'spoofed') agg.referrals.spoofed++;

  // 404 demand: scanner probes counted, content-like paths retained
  if (l.status === 404) {
    if (c.cls === 'attack' || !CONTENT_404_OK.test(l.path)) agg.notFound.scanner++;
    else bump(agg.notFound.contentLike, l.path, 40);
  }

  if (c.cls === 'attack') {
    agg.attack.requests++;
    if (AUTH_PATH.test(l.path) && l.method === 'POST') {
      const hourMatch = /\d{2}\/\w+\/\d{4}:(\d{2})/.exec(l.time);
      const hour = hourMatch ? hourMatch[1] : '00';
      if (!agg.attack.authAttack[hour]) agg.attack.authAttack[hour] = { loginPosts: {}, xmlrpcPosts: {} };
      if (/wp-login/i.test(l.path)) bump(agg.attack.authAttack[hour].loginPosts, String(l.status), 20);
      else bump(agg.attack.authAttack[hour].xmlrpcPosts, String(l.status), 20);
    }
    if (/[?&]author=\d/i.test(l.path)) bump(agg.attack.enumeration.authorScan, String(l.status), 10);
    if (/^\/wp-json\/wp\/v2\/users/i.test(l.path)) bump(agg.attack.enumeration.userRestApi, String(l.status), 10);
    if (/^\/wp-json\//i.test(l.path) && !/^\/wp-json\/wp\/v2\/users/i.test(l.path) && l.status === 200) {
      bump(agg.attack.enumeration.restRouteBypass, l.path.split('/').slice(0, 5).join('/'), 10);
    }
    if (PROBE_PATH.test(l.path) && !AUTH_PATH.test(l.path) && Object.keys(agg.attack.probes).length < 50) {
      if (!agg.attack.probes[l.path]) agg.attack.probes[l.path] = { hits: 0, statuses: {} };
      agg.attack.probes[l.path].hits++;
      bump(agg.attack.probes[l.path].statuses, String(l.status), 10);
    }
    if (agg._ipCounts) agg._ipCounts.set(l.ip, (agg._ipCounts.get(l.ip) ?? 0) + 1);
  }
}

export function enableIpTracking(agg: DayAggregate): void {
  agg._ipCounts = new Map();
}

export function finalizeAggregate(agg: DayAggregate): DayAggregate {
  if (agg._ipCounts?.size) {
    const counts = Array.from(agg._ipCounts.values());
    agg.attack.ipCardinality.distinct = agg._ipCounts.size;
    agg.attack.ipCardinality.histogram['1']    = counts.filter(n => n === 1).length;
    agg.attack.ipCardinality.histogram['2-5']  = counts.filter(n => n >= 2 && n <= 5).length;
    agg.attack.ipCardinality.histogram['6-20'] = counts.filter(n => n >= 6 && n <= 20).length;
    agg.attack.ipCardinality.histogram['21+']  = counts.filter(n => n > 20).length;
  }
  const { _ipCounts: _, ...clean } = agg as DayAggregate & { _ipCounts?: unknown };
  return clean as DayAggregate;
}

// ---------------------------------------------------------------------------
// Date + planning helpers
// ---------------------------------------------------------------------------

export function dayToCompact(day: string): string { return day.replace(/-/g, ''); }
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function utcToday(): string { return new Date().toISOString().slice(0, 10); }
export function fmtMB(bytes: number): string { return (bytes / 1048576).toFixed(1) + 'MB'; }

export function estimateRawBytes(objects: S3Object[]): number {
  return objects.reduce((s, o) => s + o.size * (o.key.endsWith('.gz') ? GZ_EXPANSION : 1), 0);
}

// List the log files whose FILENAME-DATE is `fileDate`, e.g. prefix + "20250319".
// Assumes the WPE convention {prefix}{YYYYMMDD}-{HHMM}-{install}_apachestyle.log.
export async function listFilesForDate(
  creds: AwsCreds, cfg: { bucket: string; region: string; prefix: string }, fileDate: string,
): Promise<S3Object[]> {
  const objects = await s3ListAll(creds, cfg.region, cfg.bucket, cfg.prefix + dayToCompact(fileDate));
  return objects.filter(o => /apachestyle/i.test(o.key));
}

// A range of LINE-days [from,to] is covered by FILENAME-dates [from, to+1]
// (rotation offset — see header comment).
export function fileDatesForRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= addDays(to, 1); d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// AWS credential access (feature-detected)
// ---------------------------------------------------------------------------

export async function getAwsCreds(ctx: Ctx): Promise<AwsCreds | { error: string }> {
  const status = await ctx.credentials.getStatus('aws').catch(() => 'not_connected' as const);
  if (status !== 'connected') {
    try { await ctx.credentials.requestConnection('aws'); } catch { /* provider may not exist yet */ }
    return { error: 'AWS not connected. Add the AWS connection (access key with s3:GetObject + s3:ListBucket on the log bucket) in the Nexus UI, then retry.' };
  }
  if (typeof ctx.credentials.getSecret !== 'function') {
    return { error: 'This SDK build lacks credentials.getSecret() — the api_key provider extension (credential-manager brief v1.1) is required for S3 log access.' };
  }
  const secret = await ctx.credentials.getSecret('aws');
  if (!secret?.accessKeyId || !secret?.secretAccessKey) {
    return { error: 'AWS connection is missing accessKeyId/secretAccessKey fields.' };
  }
  return { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey };
}

export type LogCfg = { bucket: string; region: string; prefix: string };

export function loadCfg(ctx: Ctx, siteId: string): LogCfg | null {
  const logConfigKey = (id: string) => `logCfg:${id}`;
  const raw = ctx.state.get<string>(logConfigKey(siteId));
  if (!raw) return null;
  try { return JSON.parse(raw) as LogCfg; } catch { return null; }
}
