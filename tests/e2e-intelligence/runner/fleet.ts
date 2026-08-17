/**
 * WP-18 · Picking a target site out of `nexus_list_sites`.
 *
 * `nexus_list_sites` is the tool the fleet's own instructions name as the first
 * call before any site workflow, so the journeys use it rather than reaching
 * into Local's site store. It renders running sites bold and halted ones plain
 * in a single list; only the `[status]` tag distinguishes them, and
 * `verify_site_live` refuses anything that is not running.
 */

export interface LocalSiteRow {
  name: string;
  domain: string;
  status: string;
}

const LOCAL_HEADING = '### Local Sites';
/** `- **name** (domain) [status]` with an optional ` ↔ wpe:…` suffix. */
const SITE = /^-\s+(?:\*\*)?(.+?)(?:\*\*)?\s+\(([^)]*)\)\s+\[([^\]]+)\]/;

export function localSites(markdown: string): LocalSiteRow[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === LOCAL_HEADING);
  if (start === -1) return [];

  const rows: LocalSiteRow[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith('###')) break; // next section
    const m = SITE.exec(line);
    if (!m) continue;
    rows.push({ name: m[1].trim(), domain: m[2], status: m[3] });
  }
  return rows;
}

/**
 * The first running local site, or undefined.
 *
 * Undefined rather than "the first site": handing a halted site to
 * `verify_site_live` produces a refusal that reads as a defect in the live-check
 * path when it is really an environment gap, and the journey should say so in
 * its own words instead.
 */
export function firstRunningLocalSite(markdown: string): string | undefined {
  return localSites(markdown).find((s) => s.status === 'running')?.name;
}
