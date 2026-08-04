import { parseTarget } from '../../common/target';
import { resolveSite } from '../mcp/site-resolver';
import type { NexusServices } from '../mcp/types';

/**
 * Translate a CLI-shaped target string into the args object resolveTransport
 * consumes (`site`, `install_name`, or `ssh_target`).
 *
 * THE BARE-NAME FALLBACK IS LOAD-BEARING. `nexus wp core version my-install`
 * with no prefix is a path users rely on: when a plain name is not a Local
 * site, it is looked up in the graph DB as an active WPE install and routed
 * remotely. resolveTarget does not do this — it keys off which argument was
 * supplied — so the behaviour lives here or nowhere. Deleting it breaks that
 * command silently, with a "site not found" error rather than a clue.
 *
 * A name that matches neither returns `{ site: name }` on purpose, so the
 * caller produces the familiar "Site not found" message.
 *
 * EVERY `install_name` THIS MAPPER EMITS CARRIES `install_name_explicit: true`.
 * `resolveTarget` treats a bare `install_name` as *possibly a local site name*
 * and looks that up first, which is correct for MCP tools (where the argument
 * genuinely is ambiguous) and wrong here (where the mapper has already decided
 * the target is remote). Without the flag, `wpe:acct/acme-prod@production` runs
 * against whatever install a *local* site called `acme-prod` is linked to —
 * silently, on production — or fails with "not connected to WP Engine" instead
 * of running remotely. Local sites named after the install they were pulled
 * from make that collision ordinary, not exotic.
 */
export function resolveTargetArgs(
  target: string,
  services: NexusServices,
): Record<string, unknown> {
  const parsed = parseTarget(target);

  if (parsed.type === 'external') return { ssh_target: target };

  if (parsed.type === 'wpe') {
    // installName may carry an account prefix; the transport wants the install only.
    const installName = parsed.installName!.split('/').pop() || parsed.installName!;
    return { install_name: installName, install_name_explicit: true };
  }

  const name = parsed.siteName!;
  if (resolveSite(name, services.siteData)) return { site: name };

  try {
    const db = services.graphService?.getDb?.();
    const row = db?.prepare(
      "SELECT name FROM sites WHERE source='wpe' AND LOWER(name)=? AND is_active=1 LIMIT 1",
    ).get(name.toLowerCase()) as { name?: string } | undefined;
    // Reached only after resolveSite came back empty, so re-running the local
    // lookup downstream cannot change the answer — but the flag keeps the
    // mapper's contract single: it never emits an ambiguous install_name.
    if (row?.name) return { install_name: row.name, install_name_explicit: true };
  } catch {
    // Graph DB unavailable or mid-migration — fall through to the local path,
    // which reports "not found". A lookup failure must not throw here.
  }

  return { site: name };
}
