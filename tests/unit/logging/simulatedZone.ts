/**
 * A Date that reports its LOCAL components as if the machine sat at a fixed UTC offset, while
 * `getTime()` and `toISOString()` keep reporting the true instant.
 *
 * WHY NOT just set `process.env.TZ`: under Jest that assignment lands in a copied `process.env`
 * and never reaches the runtime — measured, not assumed. `Date` and `Intl` both keep answering
 * in the machine's real zone, so a TZ-pinned test silently degrades into "this machine happens
 * not to be UTC" and would fail outright on a UTC CI box.
 *
 * WHY NOT pick a real instant whose local and UTC days differ: on a machine set to UTC no such
 * instant exists, so that test can only ever be machine-dependent.
 *
 * Simulating the zone at the Date instead makes the assertion deterministic everywhere — the
 * offset is the test's, not the machine's — and still genuinely discriminating: every method
 * below is a LOCAL accessor, so code that reads UTC (`toISOString()`) sees a different day and
 * a different clock, and the assertions fail. That is the whole property under test: whether
 * the event log reads the reader's wall clock or Greenwich's.
 */
export class ZonedDate extends Date {
  private readonly offsetMs: number;

  constructor(iso: string, offsetHours: number) {
    super(iso);
    this.offsetMs = offsetHours * 3600_000;
  }

  /** The same instant, shifted so its UTC components ARE this zone's local components. */
  private local(): Date {
    return new Date(this.getTime() + this.offsetMs);
  }

  getFullYear(): number { return this.local().getUTCFullYear(); }
  getMonth(): number { return this.local().getUTCMonth(); }
  getDate(): number { return this.local().getUTCDate(); }
  getDay(): number { return this.local().getUTCDay(); }
  getHours(): number { return this.local().getUTCHours(); }
  getMinutes(): number { return this.local().getUTCMinutes(); }
  getSeconds(): number { return this.local().getUTCSeconds(); }
  getMilliseconds(): number { return this.local().getUTCMilliseconds(); }
  getTimezoneOffset(): number { return -this.offsetMs / 60_000; }

  /** `en-CA` shape (YYYY-MM-DD), in the simulated zone. */
  toLocaleDateString(): string {
    const l = this.local();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${l.getUTCFullYear()}-${p(l.getUTCMonth() + 1)}-${p(l.getUTCDate())}`;
  }
}

/** The `HH:MM:SS.mmm` a reader in that zone sees on their own clock. */
export function localClock(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** The `YYYY-MM-DD` a reader in that zone gets from `date +%F`. */
export function localDay(d: Date): string {
  return d.toLocaleDateString('en-CA');
}
