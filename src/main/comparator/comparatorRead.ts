/**
 * WP-41 · the one read behind the comparator's IPC channels.
 *
 * It lives here and not inlined in `ipc-handlers.ts` because that file is the
 * integration lock: a handler there is a minimal import plus a call, and the
 * logic is somewhere it can be tested. `siteContentStatus.ts` is the precedent
 * and this follows it exactly.
 *
 * WHY THIS DIRECTORY AND NOT `intelligence-host/`. It belongs beside
 * `divergenceReport.ts` on architecture — same species, same seam side. It is
 * here because `src/main/intelligence-host/` is a SERIALIZED surface and WP-20g
 * holds its lock for the whole of Wave 6. Splitting a module across a lock
 * boundary to respect the lock is worse than a directory that states why it
 * exists, so: this is a lock consequence, not a design position, and folding it
 * back into `intelligence-host/` when that lock lifts costs one `git mv`.
 *
 * READ-ONLY and NON-FATAL. Every path returns an empty answer rather than
 * throwing: a dark core, an unreadable graph or a fold mid-flight costs the
 * matrix, never the panel.
 */
import { getIntelligenceCore } from '../intelligence-host/coreRegistry';
import { describeEnvironmentsFor } from '../intelligence-host/taskFrame';
import { buildSiteAtPlaces, comparatorIdFor } from './siteAtPlaces';
import type { SiteAtPlacesMatrix } from './siteAtPlaces';

/** The fact keys a comparator can be opened over, derived from what is held. */
export interface ComparableFact {
  /** The twin fact key, e.g. `plugin:woocommerce`. */
  fact: string;
  /** What the user reads. The slug, from the key — never a prettified guess. */
  label: string;
  /** How many entities hold it. The reason to offer it, and to order by it. */
  places: number;
}

/**
 * Which comparisons this machine can actually draw.
 *
 * Derived from the twins rather than from a list: a hard-coded menu would offer
 * comparisons that return nothing and withhold ones that would work. Ordered by
 * reach, then by name, so the answer is stable across calls.
 *
 * PLUGINS ONLY, in v0, and the omission is deliberate rather than partial:
 * `wp.version` and the theme facts are equally servable, but each wants its own
 * row semantics at the surface and XD-9's rows-are-facts ruling is the
 * designer's to spend. Offering one shape well beats offering three shapes the
 * loop has not seen.
 */
export function listComparableFacts(limit = 40): ComparableFact[] {
  try {
    const core = getIntelligenceCore();
    if (!core) return [];
    const counts = new Map<string, number>();
    for (const row of core.twins.search('plugin:')) {
      counts.set(row.fact, (counts.get(row.fact) ?? 0) + 1);
    }
    return [...counts]
      .map(([fact, places]) => ({ fact, label: fact.slice('plugin:'.length), places }))
      .filter((f) => f.places > 1) // one place is not a comparison
      .sort((a, b) => b.places - a.places || a.fact.localeCompare(b.fact))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * The matrix for one fact.
 *
 * **`exclusions` IS DELIBERATELY EMPTY, AND THAT IS AN ESCALATION, NOT A TODO.**
 * A world exclusion must carry the record that caused it —
 * `WorldExclusionRecord.causedBy` is `{recordId, topic, observedAt}`, and
 * `procedureScope.ts` says why in its own words: *"the reason is copied from the
 * record, never composed beside it — 'Excludes: Foxtrot — halted, and said so'
 * is only honest if something recorded that it said so."*
 *
 * Measured on this branch: the ledger's entire emitted topic set is
 * `state.plugin.observed`, `state.plugin.removed`, `state.theme.observed`,
 * `state.user.observed`, `state.site.observed` (site_initialized only),
 * `semantic.content.changed`, `state.drift.detected` and the incident topic.
 * **Nothing records a site as halted.** `scopeModel.FIXTURE_SELECTION` cites
 * `topic: 'site.status.observed'`, which names a producer that has never
 * existed — legitimate in a fixture, and the reason the WP-37 smoke read as
 * though a path existed behind it.
 *
 * So this reads halted-ness from NOWHERE rather than from Local's live site
 * store. A live status read would produce a reason composed beside the data
 * instead of copied from a record, which is precisely the defect the type
 * exists to prevent — and it would put a `causedBy` on screen pointing at no
 * record at all. Escalated to the owner; the seam is here and takes a producer
 * the day one exists, with no change to anything downstream.
 */
export async function readSiteAtPlaces(
  services: unknown,
  fact: string
): Promise<SiteAtPlacesMatrix> {
  const empty: SiteAtPlacesMatrix = {
    fact,
    filter: filterFor(fact),
    comparatorId: comparatorIdFor(fact),
    columns: [],
    rows: [],
    verdictCoverage: { cells: 0, verdicts: 0 },
  };
  try {
    const core = getIntelligenceCore();
    if (!core || !fact) return empty;
    const describe = await describeEnvironmentsFor(services as never);
    return buildSiteAtPlaces(fact, filterFor(fact), {
      ledger: core.ledger,
      twins: core.twins,
      ...(core.entities ? { entities: core.entities } : {}),
      ...(describe ? { describe } : {}),
    });
  } catch {
    return empty;
  }
}

/**
 * The filter, as APPLIED — it rides verbatim onto `ScopeFrom.filter`, so it must
 * describe what the render actually did and nothing more.
 *
 * There is no "behind newest" filter here, and that absence is load-bearing.
 * The designer's sheet shows one, but "newest" is an update-availability fact
 * and CLAUDE.md records that update availability is persisted NOWHERE: neither
 * `plugins` nor `themes` carries a latest-version column, and every
 * `updateAvailable` in the codebase is computed live at query time. A
 * fleet-relative maximum would be a different fact wearing that word's clothes.
 * Escalated with the exclusions above rather than approximated.
 */
function filterFor(fact: string): string {
  return `${fact.replace(':', '=')}`;
}
