/**
 * WP-17 · The layer reports its own degradation.
 *
 * Everything on this seam is non-fatal by construction — which converts real
 * failure into SILENT ABSENCE. The M1 ABI incident ran for hours with green
 * tests, a working app and a dark ledger, because "degrade quietly" and
 * "report that you degraded" are different obligations and only the first was
 * built. This module is the second one: the ledger is already the sensor, so
 * liveness is one GROUP BY away (TESTING_STRATEGY.md layer 9).
 *
 * Three rules govern everything below:
 *
 *   1. READ-ONLY. This module opens no files, writes no rows, emits no events.
 *      The single write in the whole health feature is bootstrap's
 *      init-state persistence, which must exist before a failure can be read.
 *   2. NEVER THROWS. A health check that crashes the thing it checks is the
 *      one unforgivable irony. Every gather step is individually guarded and
 *      degrades to a line that says what could not be measured.
 *   3. INTERNAL VOCABULARY ONLY. Verdicts here are OK/STALE/DARK; the
 *      user-facing words (OK / needs a check / not reporting) are applied at
 *      the rendering boundary — see the MCP tool. Controlled Vocabulary v1,
 *      docs/intelligence/user-docs/your-copy-and-the-live-site.md.
 */
import { IntelligenceCore, IntelligenceInitState, getIntelligenceInitState } from './bootstrap';

export type HealthVerdict = 'OK' | 'STALE' | 'DARK';

export interface ProducerLivenessSlo {
  /** The exact `source.system` value this producer stamps on its envelopes. */
  system: string;
  /** User-facing name — the vocabulary translation, never the system id. */
  label: string;
  /** Owner-tunable. See the justification on each entry below. */
  sloSeconds: number;
}

const HOURS = 3600;
const DAYS = 24 * HOURS;

/**
 * PRODUCER LIVENESS SLOs — owner-tunable defaults, proposed not asked.
 *
 * These answer a different question from `DEFAULT_FRESHNESS_SLOS`
 * (`src/intelligence/folds/twinStore.ts`), which asks "may I act on this
 * cached FACT?". These ask "is this PRODUCER still alive?" — pipeline
 * liveness, not fact freshness. They deliberately do NOT live beside their
 * sibling table: the seam rule (ADR-16) keeps host producer names out of
 * `src/intelligence/`, and 'wp-webhook' / 'graph-sync' are host facts. Same
 * shape, same tunability, one layer out.
 *
 * Every value is set at the point where SILENCE STOPS BEING NORMAL for that
 * producer. Too tight and health cries wolf on an idle laptop, which is how a
 * monitor gets ignored — and an ignored monitor is worse than none, because
 * it certifies the silence it was built to break.
 */
export const PRODUCER_LIVENESS_SLOS: readonly ProducerLivenessSlo[] = [
  {
    // Fires only when someone changes a RUNNING Local site (MU-plugin webhook).
    // A developer machine idle over a weekend is ordinary, so anything under
    // ~3 days would raise an alarm every Monday morning. At three days of a
    // used machine with zero site activity, "the webhook is broken" becomes
    // the likelier explanation than "nobody worked".
    system: 'wp-webhook',
    label: 'In-site events',
    sloSeconds: 3 * DAYS,
  },
  {
    // Plugin/theme observations from every graph write. Change-gated
    // (changeGate.ts), so an unchanged fleet emits NOTHING however often it
    // syncs — silence is the normal steady state here, not a symptom. Two
    // weeks is where "no plugin or theme changed anywhere in the fleet"
    // becomes less likely than a broken tap.
    system: 'graph-sync',
    label: 'Plugin and theme updates',
    sloSeconds: 14 * DAYS,
  },
  {
    // Site-level observations for WP Engine installs. Same change gate, plus
    // the WPE refresh scheduler is OPT-IN (wpeRefreshAutoEnabled defaults
    // false) — so a user who never enabled it, or has no WP Engine account,
    // legitimately never sees one. That is why "never" renders with its own
    // explanation rather than as a fault.
    system: 'graph-sync:wpe',
    label: 'WP Engine site updates',
    sloSeconds: 14 * DAYS,
  },
  {
    // Drift events, emitted only when two observations of the same fact
    // DISAGREE. A stable fleet legitimately produces none for a long time —
    // the loosest SLO in the set, included for visibility rather than alarm.
    system: 'fold:state-twin',
    label: 'Change detection',
    sloSeconds: 30 * DAYS,
  },
  {
    // One manifest per docked-panel chat turn — the only producer a user
    // drives directly, which makes it the sharpest signal in the table: if
    // chat has been used this week and no manifest exists, assembly is
    // broken. This line IS the packet's "assembler last-manifest age".
    system: 'assembler:chat',
    label: 'Chat context',
    sloSeconds: 7 * DAYS,
  },
];

/**
 * Fold lag tolerance, in events. `runFold` consumes 500 per transaction, so a
 * fold caught mid-batch can legitimately sit one batch behind; past one batch
 * it is not catching up, it is stuck.
 */
export const FOLD_LAG_SLO_EVENTS = 500;

export interface HealthLine {
  /** Internal, stable, grep-able — used by the startup log line. */
  key: string;
  /** User-facing name (Controlled Vocabulary v1). */
  label: string;
  /** The measured value. */
  value: string;
  /** What was expected of it. */
  threshold: string;
  verdict: HealthVerdict;
  /** Optional context: a failure reason, an explanation of a benign DARK. */
  detail?: string;
  /**
   * False for lines whose DARK means "this source was never in use here"
   * rather than "this stopped working" — a machine with no WP Engine account
   * must not summarise as *not reporting* forever, or the summary becomes
   * noise and a noisy monitor gets ignored, which is how silence gets
   * certified. The `ledger` line below is what catches a wholly dark ledger,
   * so nothing is lost by this exclusion. Defaults to true.
   */
  countsTowardWorst?: boolean;
}

export interface IntelligenceHealthReport {
  checkedAt: string;
  coreUp: boolean;
  /** The worst verdict across every line — DARK > STALE > OK. */
  worst: HealthVerdict;
  lines: HealthLine[];
  /** Non-empty when the health check itself could not measure something. */
  errors: string[];
}

interface ProducerRow {
  system: string;
  events: number;
  lastRecordedAt: string | null;
}

export function collectIntelligenceHealth(
  options: {
    /** Pass `getIntelligenceCore()`; undefined means init failed or never ran. */
    core?: IntelligenceCore;
    initState?: IntelligenceInitState;
    producers?: readonly ProducerLivenessSlo[];
    now?: Date;
  } = {}
): IntelligenceHealthReport {
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const lines: HealthLine[] = [];
  const initState = options.initState ?? safely(() => getIntelligenceInitState(), {}, errors);
  const core = options.core;

  lines.push(coreLine(core, initState, now));

  if (core) {
    const producers = options.producers ?? PRODUCER_LIVENESS_SLOS;
    const rows = producerRows(core, errors);
    lines.push(ledgerLine(rows));
    for (const slo of producers) lines.push(producerLine(slo, rows.get(slo.system), now));
    const unlisted = unlistedProducersLine(rows, producers);
    if (unlisted) lines.push(unlisted);
    lines.push(...foldLagLines(core, errors));
    lines.push(mirrorLine(core, initState, errors));
    lines.push(entityLine(core, initState));
  }

  return {
    checkedAt: now.toISOString(),
    coreUp: !!core,
    worst: worstOf(lines),
    lines,
    errors,
  };
}

/**
 * The startup line — internal vocabulary, one line, grep-able by key.
 * `grep '\[Intelligence\] health'` answers "was the layer alive at boot" from
 * a log file alone, which is precisely what the M1 incident had no way to do.
 */
export function formatHealthLogLine(report: IntelligenceHealthReport): string {
  const parts = report.lines.map((l) => `${l.key}=${l.verdict}(${l.value})`);
  const errs = report.errors.length ? ` [${report.errors.length} check error(s)]` : '';
  return `[Intelligence] health: ${report.worst} — ${parts.join(' ')}${errs}`;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

function coreLine(
  core: IntelligenceCore | undefined,
  initState: IntelligenceInitState,
  now: Date
): HealthLine {
  const failure = initState.last_failure;
  const failureText = failure
    ? `${failure.stage}: ${failure.message} (${formatAge(ageSeconds(failure.at, now))} ago)`
    : undefined;

  if (core) {
    return {
      key: 'core',
      label: 'Recording',
      value: 'ready',
      threshold: 'starts with the app',
      verdict: 'OK',
      // History, not a current fault — but rendered, because a failure that
      // only appears while it is happening is a failure nobody ever sees.
      detail: failureText ? `last recorded start-up failure — ${failureText}` : undefined,
    };
  }

  return {
    key: 'core',
    label: 'Recording',
    value: 'not started',
    threshold: 'starts with the app',
    verdict: 'DARK',
    detail:
      failureText ??
      'no reason on record — the layer has not attempted to start in this session',
  };
}

/**
 * ONE GROUP BY over the whole ledger — the packet's shape, and the reason
 * this check is cheap enough to run at every boot.
 *
 * Liveness reads `recorded_at` (when the ledger heard from the producer), not
 * `observed_at` (when the fact was true at its source). They are never
 * conflated in this codebase, and here the distinction is load-bearing: a
 * backfill legitimately carries months-old `observed_at` values, so a
 * producer that just ran one would read as long dead.
 */
function producerRows(core: IntelligenceCore, errors: string[]): Map<string, ProducerRow> {
  return safely(
    () => {
      const rows = core.ledger
        .raw()
        .prepare(
          `SELECT json_extract(source, '$.system') AS system,
                  COUNT(*)                         AS events,
                  MAX(recorded_at)                 AS last_recorded_at
             FROM events
            GROUP BY system`
        )
        .all() as Array<{ system: string | null; events: number; last_recorded_at: string | null }>;
      const map = new Map<string, ProducerRow>();
      for (const r of rows) {
        if (!r.system) continue;
        map.set(r.system, {
          system: r.system,
          events: r.events,
          lastRecordedAt: r.last_recorded_at,
        });
      }
      return map;
    },
    new Map<string, ProducerRow>(),
    errors,
    'producer liveness'
  );
}

/**
 * The whole-ledger signal, and the one that catches the M1 shape from the
 * other side: a core that started but is recording NOTHING. Individually,
 * a never-used producer is not a fault (see `countsTowardWorst`); ALL of them
 * silent means either a brand-new install or a tap that is wired and dead,
 * and only the user can tell those apart — so it is surfaced, not suppressed.
 */
function ledgerLine(rows: Map<string, ProducerRow>): HealthLine {
  const total = [...rows.values()].reduce((n, r) => n + r.events, 0);
  return {
    key: 'ledger',
    label: 'Recorded so far',
    value: `${total.toLocaleString('en-US')} event(s)`,
    threshold: 'more than 0',
    verdict: total > 0 ? 'OK' : 'STALE',
    detail:
      total === 0
        ? 'nothing has been recorded yet — normal on a new install, worth a look if you have been using Nexus AI for a while'
        : undefined,
  };
}

function producerLine(slo: ProducerLivenessSlo, row: ProducerRow | undefined, now: Date): HealthLine {
  const key = `producer:${slo.system}`;
  if (!row || !row.lastRecordedAt) {
    return {
      key,
      label: slo.label,
      value: 'nothing yet',
      threshold: `within ${formatAge(slo.sloSeconds)}`,
      verdict: 'DARK',
      detail:
        'nothing from this source has ever been recorded — expected when this source is not in use on this machine',
      countsTowardWorst: false,
    };
  }
  const age = ageSeconds(row.lastRecordedAt, now);
  const stale = age > slo.sloSeconds;
  return {
    key,
    label: slo.label,
    value: `last seen ${formatAge(age)} ago`,
    threshold: `within ${formatAge(slo.sloSeconds)}`,
    verdict: stale ? 'STALE' : 'OK',
    detail: stale ? `${row.events} recorded in total; nothing new for ${formatAge(age)}` : undefined,
  };
}

/**
 * Producers emitting into the ledger that no SLO covers. Listed rather than
 * ignored: an unmonitored producer is invisible exactly when it stops, and a
 * table that silently goes out of date is the failure mode this packet
 * exists to prevent. Not a fault in itself — hence OK.
 */
function unlistedProducersLine(
  rows: Map<string, ProducerRow>,
  producers: readonly ProducerLivenessSlo[]
): HealthLine | undefined {
  const known = new Set(producers.map((p) => p.system));
  const others = [...rows.keys()].filter((s) => !known.has(s)).sort();
  if (others.length === 0) return undefined;
  return {
    key: 'producers:unlisted',
    label: 'Other sources',
    value: `${others.length} (${others.join(', ')})`,
    threshold: 'no liveness expectation set',
    verdict: 'OK',
    detail: 'recording, but not monitored for liveness — give one an expectation if it should be',
  };
}

/**
 * Fold lag per WIRED fold (`core.folds`), measured as events past the cursor.
 *
 * Deliberately NOT DARK on a missing cursor alone: folds are debounced 500ms
 * behind emission, so a check that races the timer would flap between "not
 * reporting" and "OK" on a perfectly healthy system. A verdict that flaps is
 * a verdict nobody trusts. Past one whole batch with no cursor at all, it is
 * no longer a race.
 */
function foldLagLines(core: IntelligenceCore, errors: string[]): HealthLine[] {
  return safely(
    () => {
      const db = core.ledger.raw();
      return (core.folds ?? []).map((fold) => {
        const cursor = db
          .prepare(`SELECT last_event_id FROM fold_cursors WHERE fold = ?`)
          .get(fold.name) as { last_event_id: string } | undefined;
        const like = `${fold.topicPrefix}%`;
        const behind = cursor
          ? (db
              .prepare(`SELECT COUNT(*) AS n FROM events WHERE topic LIKE ? AND id > ?`)
              .get(like, cursor.last_event_id) as { n: number }).n
          : (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE topic LIKE ?`).get(like) as {
              n: number;
            }).n;

        const neverRan = !cursor;
        const verdict: HealthVerdict =
          behind > FOLD_LAG_SLO_EVENTS ? (neverRan ? 'DARK' : 'STALE') : 'OK';
        return {
          key: `fold:${fold.name}`,
          label: 'Processing backlog',
          value: `${behind} waiting`,
          threshold: `within ${FOLD_LAG_SLO_EVENTS}`,
          verdict,
          detail: neverRan
            ? behind === 0
              ? 'nothing to process yet'
              : 'has not processed anything yet'
            : undefined,
        };
      });
    },
    [],
    errors,
    'fold lag'
  );
}

function mirrorLine(
  core: IntelligenceCore,
  initState: IntelligenceInitState,
  errors: string[]
): HealthLine {
  const key = 'mirror';
  const label = 'Access & Permissions mirror';
  const threshold = 'no differences';
  if (!core.law) {
    const failure = initState.last_failure;
    return {
      key,
      label,
      value: 'unavailable',
      threshold,
      verdict: 'DARK',
      detail:
        failure?.stage === 'law-registry'
          ? `did not start — ${failure.message}`
          : 'did not start; your Access & Permissions settings are unaffected — nothing reads this mirror to allow or refuse anything',
    };
  }
  const divergences = safely(() => core.law!.verifyMirror(), [], errors, 'permission mirror');
  if (divergences.length === 0) {
    return { key, label, value: 'no differences', threshold, verdict: 'OK' };
  }
  return {
    key,
    label,
    value: `${divergences.length} difference(s)`,
    threshold,
    verdict: 'STALE',
    detail: divergences
      .slice(0, 3)
      .map((d) => d.constraintId)
      .join(', '),
  };
}

function entityLine(core: IntelligenceCore, initState: IntelligenceInitState): HealthLine {
  const key = 'entities';
  const label = 'Site identity';
  if (core.entities) {
    return { key, label, value: 'available', threshold: 'available', verdict: 'OK' };
  }
  const failure = initState.last_failure;
  return {
    key,
    label,
    value: 'unavailable',
    threshold: 'available',
    verdict: 'DARK',
    detail:
      (failure?.stage === 'entity-service' ? `did not start — ${failure.message}; ` : '') +
      'sites are still identified the same way; pairing suggestions are unavailable until it starts',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY: Record<HealthVerdict, number> = { OK: 0, STALE: 1, DARK: 2 };

function worstOf(lines: HealthLine[]): HealthVerdict {
  return lines
    .filter((l) => l.countsTowardWorst !== false)
    .reduce<HealthVerdict>(
      (worst, l) => (SEVERITY[l.verdict] > SEVERITY[worst] ? l.verdict : worst),
      'OK'
    );
}

/** Rule 2: a health check must never throw into what it is checking. */
function safely<T>(fn: () => T, fallback: T, errors: string[], what?: string): T {
  try {
    return fn();
  } catch (err) {
    if (what) errors.push(`${what}: ${(err as Error)?.message ?? String(err)}`);
    return fallback;
  }
}

function ageSeconds(iso: string, now: Date): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
