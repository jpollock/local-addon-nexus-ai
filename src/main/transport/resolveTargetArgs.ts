import { parseTarget } from '../../common/target';
import { resolveLocalSiteResult } from '../mcp/site-resolver';
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
 * A name that matches neither returns `{ site: name }` — the caller's raw
 * spelling — on purpose, so the caller produces the familiar "Site not found"
 * message naming what the user typed. When a Local site DOES match, the site's
 * own `name` is returned instead, because downstream resolvers re-resolve
 * case-sensitively.
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
  // WP-58: `target`, not `name` — the `@local` suffix is the caller SAYING
  // which source it means, and `parsed.siteName` has already stripped it.
  // `resolveLocalSiteResult` reads the pin and skips the decline for it, which
  // is what makes the refusal below actionable rather than a dead end.
  const localResult = resolveLocalSiteResult(target, services.siteData, services.graphService);
  const localSite = localResult.kind === 'none' ? null : localResult.site;

  let wpeInstallName: string | undefined;
  try {
    const db = services.graphService?.getDb?.();
    const row = db?.prepare(
      "SELECT name FROM sites WHERE source='wpe' AND LOWER(name)=? AND is_active=1 LIMIT 1",
    ).get(name.toLowerCase()) as { name?: string } | undefined;
    wpeInstallName = row?.name;
  } catch {
    // Graph DB unavailable or mid-migration — fall through.
    // A lookup failure must not throw here.
  }

  // If the bare name matches both a Local site AND something in the graph,
  // refuse it — the user must disambiguate with @ naming.
  //
  // WP-58: the gate is now `localResult.kind === 'collision'`, not
  // `localSite && wpeInstallName`. The old pair covered a Local/WPE clash and
  // silently answered "local" for a Local/EXTERNAL one — the same hole, one
  // source over. The WPE-specific message is kept where it applies, because it
  // names the install and that is more useful than the generic form.
  const wpeAmbiguity = () =>
    new Error(
      `Ambiguous target "${name}" — it matches both a Local site and the WP Engine install "${wpeInstallName}". Specify which one you mean:\n` +
      `  ${name}@local\n` +
      `  wpe:<account>/${wpeInstallName}@production\n` +
      `  ssh:${wpeInstallName}@production`
    );

  if (localResult.kind === 'collision') {
    // The WPE-specific message where it applies: it names the install, which
    // is more useful than the generic form.
    throw wpeInstallName ? wpeAmbiguity() : new Error(localResult.message);
  }

  // PARITY BACKSTOP — the pre-WP-58 gate, kept verbatim in effect.
  //
  // The shared probe and this function's own WPE lookup are two independent
  // queries against the same database, and they can disagree: the probe
  // swallows a read failure and reports "no collision", which would turn a
  // refusal this function has always made into a silent run against the copy.
  // Deleting the old gate in favour of the new one would have been a fail-OPEN
  // change on the one path that already got this right.
  //
  // `localPinned` is the one thing the old gate was missing: it fired for
  // `mysite@local` too, refusing a target whose whole point is that the caller
  // already said which source they meant.
  const localPinned = target.endsWith('@local');
  if (!localPinned && localSite && wpeInstallName) throw wpeAmbiguity();

  // M11: return the site's OWN name, not the caller's spelling.
  // `resolveLocalSiteResult` here matches case-insensitively (and on
  // id/domain), but the GraphQL path's `findLocalSiteExact` re-resolves
  // case-SENSITIVELY on name/id/domain — so echoing back `MySite` for a site
  // named `mysite` produced a "Site not found" a step later. Returning the
  // canonical name closes the mismatch at the source. (WP-58 renamed both
  // functions so this sentence can name which is which; it did not merge
  // them, and this comment is the reason it did not.)
  if (localSite) return { site: localSite.name };

  // Reached only after the local lookup came back empty, so re-running the local
  // lookup downstream cannot change the answer — but the flag keeps the
  // mapper's contract single: it never emits an ambiguous install_name.
  if (wpeInstallName) return { install_name: wpeInstallName, install_name_explicit: true };

  return { site: name };
}
