/**
 * Every number on the Settings screen, computed once.
 *
 * The handoff's first non-negotiable: "Compute fleet figures once, in one
 * module, and have every label read from it. Never restate a number in a
 * string literal." Nothing in a section component may recompute any of this.
 *
 * Row membership is docs/handoff-ux/handoff_nexus_ux/MEMBERSHIP.md, transcribed
 * once. Note that `group` and `conn` are DIFFERENT predicates: a row can sit in
 * a destination group and contribute nothing to its figure.
 */
import type { NexusSettings } from '../../../common/types';

export type Destination = 'wpe' | 'ext' | 'local';
export type JobKey =
  | 'wpeRefresh' | 'wpeSync' | 'wpeContentIndex'
  | 'externalRefresh' | 'externalContentIndex'
  | 'localContentIndex' | 'haltedSiteRefresh';

export interface JobSpec {
  key: JobKey;
  name: string;
  group: Destination;
  /** null = never switchable. Not the same as "off". */
  enableKey: keyof NexusSettings | null;
  intervalKey: keyof NexusSettings;
  defaultHours: number;
  /** Which figure this job feeds. null = costs nothing. */
  conn: Destination | null;
}

/** Seven. An eighth row, the siteStopped event hook, was cut — it is not a
 *  scheduled job and had no interval, no cycle and no cost. Do not add it. */
export const JOBS: JobSpec[] = [
  { key: 'wpeRefresh',           name: 'Check WP Engine sites',        group: 'wpe',   enableKey: 'wpeRefreshAutoEnabled',           intervalKey: 'wpeRefreshIntervalHours',           defaultHours: 24, conn: 'wpe'  },
  { key: 'wpeSync',              name: 'Refresh site details',         group: 'wpe',   enableKey: 'wpeSyncAutoEnabled',              intervalKey: 'wpeSyncIntervalHours',              defaultHours: 8,  conn: 'wpe'  },
  { key: 'wpeContentIndex',      name: 'Make content searchable',      group: 'wpe',   enableKey: 'wpeContentIndexAutoEnabled',      intervalKey: 'wpeContentIndexIntervalHours',      defaultHours: 24, conn: null   },
  { key: 'externalRefresh',      name: 'Check other hosts',            group: 'ext',   enableKey: 'externalRefreshAutoEnabled',      intervalKey: 'externalRefreshIntervalHours',      defaultHours: 24, conn: 'ext'  },
  { key: 'externalContentIndex', name: 'Make other hosts searchable',  group: 'ext',   enableKey: 'externalContentIndexAutoEnabled', intervalKey: 'externalContentIndexIntervalHours', defaultHours: 24, conn: 'ext'  },
  { key: 'localContentIndex',    name: 'Index sites on this Mac',      group: 'local', enableKey: 'localContentIndexAutoEnabled',    intervalKey: 'localContentIndexIntervalHours',    defaultHours: 8,  conn: null   },
  { key: 'haltedSiteRefresh',    name: 'Look over stopped local sites', group: 'local', enableKey: null,                             intervalKey: 'haltedSiteRefreshIntervalHours',    defaultHours: 24, conn: null   },
];

/** Amber thresholds key on conn (what figure the job feeds), not group (where it appears).
 *  null conn = never amber. MEMBERSHIP.md:18 specifies wpeContentIndex as "Amber when: never". */
const AMBER: Record<Destination | 'never', (h: number) => boolean> = {
  wpe:   (h) => h <= 2,
  ext:   (h) => h < 6,
  local: () => false,
  never: () => false,
};

export interface DerivedInput {
  settings: Partial<NexusSettings>;
  installCount: number;
  externalHostCount: number;
  localSiteCount: number;
  /** Mean run duration in ms per job. Absent or null = never measured. */
  durations: Partial<Record<JobKey, number | null>>;
  /** Last run timestamp (ms since epoch) per job. For nextInHours countdown. */
  lastRunAt: Partial<Record<JobKey, number | null>>;
  /** Current time (ms since epoch). Parameterized to keep this module pure. */
  now: number;
}

export interface JobRow {
  key: JobKey;
  name: string;
  group: Destination;
  /** User's stored intent — the flag they set, independent of pause or interval. */
  userEnabled: boolean;
  /** Whether the job can actually run — userEnabled AND valid interval AND not paused. */
  canRun: boolean;
  alwaysOn: boolean;
  hours: number;
  passesPerDay: number | null;
  costLabel: string;
  /** null when never measured — the row then renders NO duration clause. */
  durationMin: number | null;
  amber: boolean;
}

export interface Figure {
  figure: number;
  unit: 'connections a day' | 'SSH sessions a day';
  scope: string;
  amber: boolean;
  /** How many jobs in this group are user-enabled. For "2 of 2 jobs on" (COPY.md:49). */
  jobsOn: number;
  jobsTotal: number;
}

export interface Derived {
  rows: JobRow[];
  summary: {
    wpe: Figure | null;
    ext: Figure | null;
    time: { minsPerDay: number | null; nextInHours: number | null };
  };
  navNote: string;
  switchableTotal: number;
  switchableOn: number;
  paused: boolean;
}

const n = (v: number) => v.toLocaleString('en-US');

/** Passes per day. 0 hours means off — `round(24/0)` is Infinity. */
function per(hours: number): number | null {
  if (!hours || hours <= 0) return null;
  return Math.round(24 / hours);
}

/** Singular/plural for "passes". */
function passes(n: number): string {
  return n === 1 ? 'pass' : 'passes';
}

export function computeDerived(input: DerivedInput): Derived {
  const s = input.settings ?? {};
  const paused = s.backgroundWorkPaused === true;
  const hasExternal = input.externalHostCount > 0;
  const hasWpe = input.installCount > 0;

  // Filter out ext rows when no external hosts, and wpe rows when no WPE installs.
  const visible = JOBS.filter((j) =>
    (j.group !== 'ext' || hasExternal) && (j.group !== 'wpe' || hasWpe)
  );

  const rows: JobRow[] = visible.map((j) => {
    const alwaysOn = j.enableKey === null;
    const hours = (s[j.intervalKey] as number | undefined) ?? j.defaultHours;
    const passesRounded = per(hours);
    // User's stored intent: the flag they set, independent of pause or interval.
    const userEnabled = alwaysOn || s[j.enableKey!] === true;
    // Can actually run: userEnabled AND valid interval AND not paused.
    const canRun = userEnabled && passesRounded !== null && !paused;
    const ms = input.durations[j.key];
    const durationMin = ms == null ? null : Math.round(ms / 60_000);

    // For ≥49h intervals, round(24/h) is 0. Compute the unrounded rate for the figure.
    const passesUnrounded = hours > 0 ? 24 / hours : 0;

    let costLabel: string;
    if (paused && userEnabled) {
      costLabel = 'nothing while off · paused';
    } else if (!userEnabled || passesRounded === null) {
      costLabel = 'nothing while off';
    } else if (j.key === 'haltedSiteRefresh') {
      costLabel = 'free';
    } else if (j.conn === 'wpe') {
      // Omit passes clause when rounded value is <1; show connections only.
      const conns = Math.round(passesUnrounded * input.installCount);
      costLabel = passesRounded >= 1
        ? `${passesRounded} ${passes(passesRounded)} a day · ${n(conns)} connections`
        : `${n(conns)} connections`;
    } else if (j.conn === 'ext') {
      const sessions = Math.round(passesUnrounded * input.externalHostCount);
      costLabel = passesRounded >= 1
        ? `${passesRounded} ${passes(passesRounded)} a day · ${n(sessions)} sessions`
        : `${n(sessions)} sessions`;
    } else if (j.group === 'wpe') {
      costLabel = passesRounded >= 1
        ? `${passesRounded} ${passes(passesRounded)} a day · no extra connections`
        : 'no extra connections';
    } else {
      costLabel = passesRounded >= 1
        ? `${passesRounded} ${passes(passesRounded)} a day · ${n(input.localSiteCount)} local sites`
        : `${n(input.localSiteCount)} local sites`;
    }

    // Amber keys on conn (what figure it feeds), not group (where it appears).
    const amberKey = j.conn ?? 'never';
    const amber = canRun && AMBER[amberKey](hours);

    return {
      key: j.key, name: j.name, group: j.group,
      userEnabled, canRun, alwaysOn, hours,
      passesPerDay: canRun ? passesRounded : null,
      costLabel, durationMin, amber,
    };
  });

  const live = (g: Destination) =>
    rows.filter((r) => r.group === g && r.canRun);

  // Sum connections/sessions using the unrounded rate to reflect real load.
  const sumConn = (g: Destination, multiplier: number) =>
    visible
      .filter((j) => j.conn === g)
      .reduce((total, j) => {
        const row = rows.find((r) => r.key === j.key)!;
        if (!row.canRun) return total;
        const passesUnrounded = row.hours > 0 ? 24 / row.hours : 0;
        return total + Math.round(passesUnrounded * multiplier);
      }, 0);

  const wpeFigure = sumConn('wpe', input.installCount);
  const extFigure = sumConn('ext', input.externalHostCount);

  const minsList = rows.filter((r) => r.canRun && r.durationMin !== null);
  const minsPerDay = minsList.length === 0
    ? null
    : minsList.reduce((t, r) => t + r.passesPerDay! * r.durationMin!, 0);

  // nextInHours is time until next run, computed from lastRunAt + interval - now.
  // When no enabled job has ever run, the clause is omitted (null).
  const nextTimes = rows
    .filter((r) => r.canRun)
    .map((r) => {
      const last = input.lastRunAt[r.key];
      if (last == null) return null;
      const nextMs = last + r.hours * 3600_000 - input.now;
      return nextMs / 3600_000; // Convert ms to hours
    })
    .filter((t): t is number => t !== null);

  const nextInHours = nextTimes.length === 0 ? null : Math.min(...nextTimes);

  const switchable = rows.filter((r) => !r.alwaysOn);
  const switchableOn = switchable.filter((r) => r.userEnabled).length;

  // Per-group job counts for "2 of 2 jobs on" (COPY.md:49).
  const jobsInGroup = (g: Destination) => {
    const inGroup = visible.filter((j) => j.group === g);
    const on = inGroup.filter((j) => {
      const row = rows.find((r) => r.key === j.key)!;
      return row.userEnabled;
    }).length;
    return { on, total: inGroup.length };
  };

  const wpeJobs = jobsInGroup('wpe');
  const extJobs = jobsInGroup('ext');

  return {
    rows,
    summary: {
      wpe: hasWpe ? {
        figure: wpeFigure, unit: 'connections a day',
        scope: `across ${n(input.installCount)} installs`,
        amber: live('wpe').some((r) => r.amber),
        jobsOn: wpeJobs.on,
        jobsTotal: wpeJobs.total,
      } : null,
      ext: hasExternal ? {
        figure: extFigure, unit: 'SSH sessions a day',
        scope: `across ${n(input.externalHostCount)} sites`,
        amber: live('ext').some((r) => r.amber),
        jobsOn: extJobs.on,
        jobsTotal: extJobs.total,
      } : null,
      time: { minsPerDay, nextInHours },
    },
    navNote: `${switchableOn} of ${switchable.length} on`,
    switchableTotal: switchable.length,
    switchableOn,
    paused,
  };
}
