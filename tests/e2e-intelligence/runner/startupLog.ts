/**
 * WP-18 · Finding WP-17's startup health line in Local's own log.
 *
 * `formatHealthLogLine` exists so that "was the layer alive at boot?" can be
 * answered from a log file alone — the question the M1 ABI incident had no way
 * to answer. WP-17 wired it into `src/main/index.ts` and pinned the FORMATTER;
 * nothing pinned that the line reaches a file. This module is the reading half,
 * and the health journey is where that survivor finally gets its honest pin.
 *
 * Everything here is pure — the journey does the I/O — so the locator and the
 * parser are pinned without a running app.
 */

/** The grep handle WP-17 documented: `grep '\[Intelligence\] health'`. */
export const STARTUP_HEALTH_MARKER = '[Intelligence] health:';

/**
 * Where Local's log might be, most-likely first.
 *
 * Two measurements, both taken 2026-08-17 against a running Local, both
 * load-bearing:
 *
 *   1. `local-lightning.log` carries WARN and ERROR only. WP-17's health line
 *      is `localLogger.info`, so `local-lightning-verbose.log` is the only file
 *      it ever reaches. A locator that knew only the main log would report
 *      "no startup line" against a wire that works — a false RED, and the
 *      mirror image of the false green this whole harness exists to prevent.
 *      (Both were produced on this machine inside one session.)
 *   2. `~/Library/Logs/*` was current while
 *      `~/Library/Application Support/Local/*` had not been written since May.
 *
 * Hence: verbose before main, `~/Library/Logs` before Application Support. The
 * caller searches all of them and says which ones it read.
 */
export function localLogCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'darwin') {
    return [
      `${home}/Library/Logs/local-lightning-verbose.log`,
      `${home}/Library/Logs/local-lightning.log`,
      `${home}/Library/Application Support/Local/local-lightning-verbose.log`,
      `${home}/Library/Application Support/Local/local-lightning.log`,
    ];
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? `${home}/AppData/Roaming`;
    return [`${appData}/Local/local-lightning-verbose.log`, `${appData}/Local/local-lightning.log`];
  }
  return [
    `${home}/.config/Local/local-lightning-verbose.log`,
    `${home}/.config/Local/local-lightning.log`,
  ];
}

export interface StartupHealthLine {
  /** The whole message, as logged. */
  raw: string;
  /** ISO stamp from Local's JSON log envelope; undefined for a plain line. */
  timestamp?: string;
  /** The overall verdict — internal vocabulary (OK / STALE / DARK). */
  worst?: string;
  /** Every check key in the line, in order. */
  keys: string[];
  /** How many checks could not be measured, per the `[N check error(s)]` tail. */
  checkErrors: number;
}

/**
 * Anchored on the VERDICT WORD, not on the next `=`.
 *
 * Values legitimately contain both parentheses and spaces
 * (`ledger=OK(12,345 event(s))`), so a pattern that scanned for `key=` up to
 * `(` would find `s` inside `event(s)` and report a check that does not exist.
 */
const CHECK = /([A-Za-z][\w:./-]*)=(OK|STALE|DARK)\(/g;
const WORST = /\[Intelligence\] health:\s+(OK|STALE|DARK)\b/;
const CHECK_ERRORS = /\[(\d+) check error\(s\)\]/;

export function findStartupHealthLines(logText: string): StartupHealthLine[] {
  const out: StartupHealthLine[] = [];

  for (const line of logText.split('\n')) {
    if (!line.includes(STARTUP_HEALTH_MARKER)) continue;

    let message = line;
    let timestamp: string | undefined;
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { message?: string; timestamp?: string };
        if (typeof parsed.message === 'string') message = parsed.message;
        if (typeof parsed.timestamp === 'string') timestamp = parsed.timestamp;
      } catch {
        /* not JSON after all — fall through and read the raw line */
      }
    }

    const keys: string[] = [];
    CHECK.lastIndex = 0;
    for (let m = CHECK.exec(message); m; m = CHECK.exec(message)) keys.push(m[1]);

    out.push({
      raw: message,
      timestamp,
      worst: WORST.exec(message)?.[1],
      keys,
      checkErrors: Number(CHECK_ERRORS.exec(message)?.[1] ?? 0),
    });
  }

  return out;
}

/**
 * `ps -p <pid> -o lstart=` → a Date, or null.
 *
 * Null rather than `new Date(NaN)` deliberately: a NaN date compares false
 * against every timestamp, so an unparseable anchor would turn the journey's
 * "logged after this boot" check into an assertion that can never fail.
 */
export function parsePsStart(psOutput: string): Date | null {
  const text = psOutput.trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms);
}
