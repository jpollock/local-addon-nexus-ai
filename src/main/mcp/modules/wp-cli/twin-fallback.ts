const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns a header line to prepend to cached tool output.
 * Uses asOf to compute how old the data is and applies the appropriate tone.
 */
export function cachedDataNote(asOf: number, siteName: string): string {
  const ageMs = Date.now() - asOf;
  const h = Math.floor(ageMs / (60 * 60 * 1000));
  const d = Math.floor(h / 24);

  if (ageMs > ONE_DAY_MS) {
    const str = d >= 1 ? `${d}d ago` : `${h}h ago`;
    return `> ⚠️ Stale cached data (${str}) — site is halted. Run \`nexus sites refresh ${siteName}\` to update.`;
  }

  const str = h >= 1 ? `${h}h ago` : 'recently';
  return `> _(cached ${str} — site is halted)_`;
}

export function haltedNoDataError(siteName: string): string {
  return (
    `Site "${siteName}" is halted and no cached data exists. ` +
    `Start it with \`nexus sites start ${siteName}\` or run \`nexus sites refresh ${siteName}\`.`
  );
}
