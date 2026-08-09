/**
 * Minimal GA4 API client — plain fetch, no SDK (matches the GSC pattern in
 * agents/seo-insights). Admin API lists properties; Data API runs reports.
 */

export interface Ga4Property {
  property: string;      // full resource name, e.g. "properties/123456"
  displayName: string;
  account: string;
}

export interface Ga4ErrorPayload {
  error?: { message: string };
}

export async function listGa4Properties(token: string): Promise<Ga4Property[]> {
  const res = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as Ga4ErrorPayload & {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{ property: string; displayName: string }>;
    }>;
  };
  if (data.error) throw new Error(`GA4 API error: ${data.error.message}`);
  const out: Ga4Property[] = [];
  for (const acct of data.accountSummaries ?? []) {
    for (const p of acct.propertySummaries ?? []) {
      out.push({ property: p.property, displayName: p.displayName, account: acct.displayName ?? '' });
    }
  }
  return out;
}

export const GA4_METRICS = ['sessions', 'totalUsers', 'screenPageViews', 'keyEvents'] as const;

export interface Ga4Row {
  dimension: string;
  metrics: number[]; // parallel to GA4_METRICS
}

/**
 * Run a single-dimension report over a relative window.
 * days=7, offsetDays=0  → last 7 days ending yesterday
 * days=7, offsetDays=7  → the 7 days before that (prior period)
 */
export async function runGa4Report(
  token: string,
  property: string,
  opts: { dimension: string; days: number; offsetDays?: number; limit?: number },
): Promise<Ga4Row[]> {
  const offset = opts.offsetDays ?? 0;
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{
        startDate: `${offset + opts.days}daysAgo`,
        endDate: offset === 0 ? 'yesterday' : `${offset + 1}daysAgo`,
      }],
      dimensions: [{ name: opts.dimension }],
      metrics: GA4_METRICS.map((name) => ({ name })),
      limit: String(opts.limit ?? 100),
    }),
  });
  const data = await res.json() as Ga4ErrorPayload & {
    rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>;
  };
  if (data.error) throw new Error(`GA4 API error: ${data.error.message}`);
  return (data.rows ?? []).map((r) => ({
    dimension: r.dimensionValues?.[0]?.value ?? '',
    metrics: GA4_METRICS.map((_, i) => Number(r.metricValues?.[i]?.value) || 0),
  }));
}

export interface DeltaReport {
  totals: Array<{ metric: string; current: number; prior: number; deltaPct: number | null }>;
  movers: Array<{ dimension: string; metric: string; current: number; prior: number; deltaPct: number | null }>;
}

const NOISE_FLOOR = 10; // ignore dimension rows with prior volume below this

function pct(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

/** Compare two report windows: per-metric totals + per-dimension movers past thresholdPct. */
export function computeDeltas(current: Ga4Row[], prior: Ga4Row[], thresholdPct = 25): DeltaReport {
  const totals = GA4_METRICS.map((metric, i) => {
    const c = current.reduce((s, r) => s + r.metrics[i], 0);
    const p = prior.reduce((s, r) => s + r.metrics[i], 0);
    return { metric, current: c, prior: p, deltaPct: pct(c, p) };
  });

  const priorByDim = new Map(prior.map((r) => [r.dimension, r]));
  const dims = new Set([...current.map((r) => r.dimension), ...prior.map((r) => r.dimension)]);
  const movers: DeltaReport['movers'] = [];
  for (const dim of dims) {
    const c = current.find((r) => r.dimension === dim);
    const p = priorByDim.get(dim);
    GA4_METRICS.forEach((metric, i) => {
      const cv = c?.metrics[i] ?? 0;
      const pv = p?.metrics[i] ?? 0;
      if (pv < NOISE_FLOOR) return;
      const d = pct(cv, pv);
      if (d !== null && Math.abs(d) >= thresholdPct) {
        movers.push({ dimension: dim, metric, current: cv, prior: pv, deltaPct: d });
      }
    });
  }
  movers.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
  return { totals, movers };
}
