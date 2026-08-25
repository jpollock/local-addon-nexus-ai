/**
 * Where Nexus writes, in one place.
 *
 * fixes-082526 · issue 4: "I have no way to tell where the Nexus logs are."
 * The affordance existed — Settings → Advanced → Logs on disk reveals a
 * folder — but it was four levels down and named ONE root, while the product
 * writes four families with different jobs and different lifetimes. Someone
 * looking for "why didn't my agent run" needs the agent slice; someone
 * answering "what did it change" needs the compliance record; those are not
 * the same file and never were.
 *
 * This module is the single description of that surface, so the CLI and the
 * settings pane cannot drift into saying different things.
 */

export interface LogLocation {
  /** Path relative to the nexus-ai data directory. */
  relPath: string;
  label: string;
  /** What question this file answers — the reason to open THIS one. */
  answers: string;
}

/**
 * The four durable families, in the order someone hunting a problem wants
 * them: what happened, then what one agent did, then what was changed, then
 * the high-volume buffer.
 */
export const LOG_LOCATIONS: LogLocation[] = [
  {
    relPath: 'logs/nexus-YYYY-MM-DD.log',
    label: 'Activity log',
    answers: 'What Nexus did today — runs, phases, tool calls, refusals. Local time, one file per day.',
  },
  {
    relPath: 'logs/agents/<agent>-YYYY-MM-DD.log',
    label: 'Per-agent log',
    answers: 'One agent\'s slice of the same lines — "did my agent run, and why not".',
  },
  {
    relPath: 'operation-audit.log',
    label: 'Operation audit',
    answers: 'One line per change to a site. The compliance record; written synchronously, rotated, never trimmed.',
  },
  {
    relPath: 'audit.log',
    label: 'Tool audit buffer',
    answers: 'Every tool call including reads. Higher volume, flushed periodically.',
  },
];

/** Absolute paths for a given nexus-ai data directory. */
export function resolveLogLocations(dataDir: string): Array<LogLocation & { path: string }> {
  const sep = dataDir.endsWith('/') ? '' : '/';
  return LOG_LOCATIONS.map((l) => ({ ...l, path: `${dataDir}${sep}${l.relPath}` }));
}
