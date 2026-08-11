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
  { key: 'wpeSync',              name: 'Refresh site details',         group: 'wpe',   enableKey: 'wpeSyncAutoEnabled',              intervalKey: 'wpeSyncIntervalHours',              defaultHours: 24, conn: 'wpe'  },
  { key: 'wpeContentIndex',      name: 'Make content searchable',      group: 'wpe',   enableKey: 'wpeContentIndexAutoEnabled',      intervalKey: 'wpeContentIndexIntervalHours',      defaultHours: 24, conn: null   },
  { key: 'externalRefresh',      name: 'Check other hosts',            group: 'ext',   enableKey: 'externalRefreshAutoEnabled',      intervalKey: 'externalRefreshIntervalHours',      defaultHours: 24, conn: 'ext'  },
  { key: 'externalContentIndex', name: 'Make other hosts searchable',  group: 'ext',   enableKey: 'externalContentIndexAutoEnabled', intervalKey: 'externalContentIndexIntervalHours', defaultHours: 24, conn: 'ext'  },
  { key: 'localContentIndex',    name: 'Index sites on this Mac',      group: 'local', enableKey: 'localContentIndexAutoEnabled',    intervalKey: 'localContentIndexIntervalHours',    defaultHours: 4,  conn: null   },
  { key: 'haltedSiteRefresh',    name: 'Look over stopped local sites', group: 'local', enableKey: null,                             intervalKey: 'haltedSiteRefreshIntervalHours',    defaultHours: 24, conn: null   },
];

/** Amber comes from the destination, not the job. */
const AMBER: Record<Destination, (h: number) => boolean> = {
  wpe:   (h) => h <= 2,
  ext:   (h) => h < 6,
  local: () => false,
};

export interface DerivedInput {
  settings: Partial<NexusSettings>;
  installCount: number;
  externalHostCount: number;
  localSiteCount: number;
  /** Mean run duration in ms per job. Absent or null = never measured. */
  durations: Partial<Record<JobKey, number | null>>;
}

export interface JobRow {
  key: JobKey;
  name: string;
  group: Destination;
  enabled: boolean;
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

export function computeDerived(input: DerivedInput): Derived {
  const s = input.settings ?? {};
  const paused = s.backgroundWorkPaused === true;
  const hasExternal = input.externalHostCount > 0;

  const visible = JOBS.filter((j) => j.group !== 'ext' || hasExternal);

  const rows: JobRow[] = visible.map((j) => {
    const alwaysOn = j.enableKey === null;
    const hours = (s[j.intervalKey] as number | undefined) ?? j.defaultHours;
    const passes = per(hours);
    // An always-on job is enabled by definition; a zero interval is off.
    const enabled = (alwaysOn || s[j.enableKey!] === true) && passes !== null;
    const ms = input.durations[j.key];
    const durationMin = ms == null ? null : Math.round(ms / 60_000);

    let costLabel: string;
    if (!enabled || passes === null) {
      costLabel = 'nothing while off';
    } else if (j.key === 'haltedSiteRefresh') {
      costLabel = 'free';
    } else if (j.conn === 'wpe') {
      costLabel = `${passes} passes a day · ${n(passes * input.installCount)} connections`;
    } else if (j.conn === 'ext') {
      costLabel = `${passes} passes a day · ${n(passes * input.externalHostCount)} sessions`;
    } else if (j.group === 'wpe') {
      costLabel = `${passes} passes a day · no extra connections`;
    } else {
      costLabel = `${passes} passes a day · ${n(input.localSiteCount)} local sites`;
    }

    return {
      key: j.key, name: j.name, group: j.group,
      enabled, alwaysOn, hours,
      passesPerDay: enabled ? passes : null,
      costLabel, durationMin,
      amber: enabled && AMBER[j.group](hours),
    };
  });

  const live = (g: Destination) =>
    rows.filter((r) => r.group === g && r.enabled && !paused);

  const sumConn = (g: Destination, multiplier: number) =>
    visible
      .filter((j) => j.conn === g)
      .reduce((total, j) => {
        const row = rows.find((r) => r.key === j.key)!;
        return row.enabled && !paused ? total + row.passesPerDay! * multiplier : total;
      }, 0);

  const wpeFigure = sumConn('wpe', input.installCount);
  const extFigure = sumConn('ext', input.externalHostCount);

  const minsList = rows.filter((r) => r.enabled && !paused && r.durationMin !== null);
  const minsPerDay = minsList.length === 0
    ? null
    : minsList.reduce((t, r) => t + r.passesPerDay! * r.durationMin!, 0);

  const enabledHours = rows.filter((r) => r.enabled && !paused).map((r) => r.hours);
  const nextInHours = paused || enabledHours.length === 0 ? null : Math.min(...enabledHours);

  const switchable = rows.filter((r) => !r.alwaysOn);
  const switchableOn = switchable.filter((r) => r.enabled).length;

  return {
    rows,
    summary: {
      wpe: {
        figure: wpeFigure, unit: 'connections a day',
        scope: `across ${n(input.installCount)} installs`,
        amber: live('wpe').some((r) => r.amber),
      },
      ext: hasExternal ? {
        figure: extFigure, unit: 'SSH sessions a day',
        scope: `across ${n(input.externalHostCount)} sites`,
        amber: live('ext').some((r) => r.amber),
      } : null,
      time: { minsPerDay, nextInHours },
    },
    navNote: `${switchableOn} of ${switchable.length} on`,
    switchableTotal: switchable.length,
    switchableOn,
    paused,
  };
}
