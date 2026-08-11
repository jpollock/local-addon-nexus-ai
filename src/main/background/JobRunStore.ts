/**
 * Per-job run durations for the Settings → Background work screen.
 *
 * `null` means "never measured" and MUST NOT be coerced to 0 anywhere: the UI
 * omits the duration clause entirely when there is no measurement, which is
 * the difference between a row that says nothing and a row that lies.
 *
 * Bounded at 5 runs per job, the way AuditLogger bounds its own store.
 */

export type JobKey =
  | 'wpeRefresh'
  | 'wpeSync'
  | 'wpeContentIndex'
  | 'externalRefresh'
  | 'externalContentIndex'
  | 'localContentIndex'
  | 'haltedSiteRefresh';

const STORAGE_KEY = 'nexus-ai:job-runs';
const KEEP = 5;

interface Run { at: number; ms: number; }
type Bag = Partial<Record<JobKey, Run[]>>;

interface Storage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export class JobRunStore {
  constructor(private readonly storage: Storage) {}

  private read(): Bag {
    const raw = this.storage.get(STORAGE_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Bag;
  }

  record(jobKey: JobKey, startedAt: number, durationMs: number): void {
    const bag = this.read();
    const runs = Array.isArray(bag[jobKey]) ? bag[jobKey]! : [];
    runs.push({ at: startedAt, ms: durationMs });
    bag[jobKey] = runs.slice(-KEEP);
    this.storage.set(STORAGE_KEY, bag);
  }

  lastRunAt(jobKey: JobKey): number | null {
    const runs = this.read()[jobKey];
    if (!Array.isArray(runs) || runs.length === 0) return null;
    return runs[runs.length - 1].at;
  }

  averageMs(jobKey: JobKey): number | null {
    const runs = this.read()[jobKey];
    if (!Array.isArray(runs) || runs.length === 0) return null;
    return Math.round(runs.reduce((sum, r) => sum + r.ms, 0) / runs.length);
  }
}
