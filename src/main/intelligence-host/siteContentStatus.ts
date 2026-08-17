/**
 * WP-22b · the content age, made reachable from the renderer.
 *
 * `siteStatus()` (WP-21) already composes how old a copy's content is and where it
 * came from. WP-22 found that no renderer-side channel carried that fact: `GET_SITES`
 * has `created_at` (the first time Nexus indexed a site) and `GET_SITE_ROWS` has
 * `content_indexed_at` (when Nexus last indexed it). Both are INDEX ages. Rendering
 * either one under the words "pulled from the live site N days ago" would be a
 * different fact wearing the vocabulary's clothes — which is precisely why the strip
 * shipped name-only rather than with an approximation.
 *
 * So this module exists to be the logic behind ONE read-only IPC channel. It lives
 * here, not inlined in `ipc-handlers.ts`, because that file is the integration lock:
 * the handler is a minimal import + call and nothing else.
 *
 * **It returns the content slice and nothing else.** The chip renders one fact; a
 * payload carrying the copy's entity id, its branch or its rendered lines would be
 * handing the renderer material it has no vocabulary for.
 *
 * **`null` is a fourth answer, not a fallback.** A dark core means Nexus AI is not
 * recording — a fact about Nexus AI, with its own remedy. `unlinked` means the
 * records were consulted and hold nothing about this copy — a fact about the copy.
 * Collapsing them would put a false all-clear in front of someone about to trust
 * their content's age, exactly as `nexus_where_am_i` refuses to.
 *
 * READ-ONLY and non-fatal, like every path on this seam: any throw anywhere yields
 * `null`, and the strip renders without its chip.
 */
import { getIntelligenceCore } from './coreRegistry';
import { siteStatus, type ContentState } from './siteStatus';
import { describeEnvironmentsFor } from './taskFrame';

/**
 * The wire shape. Deliberately the same four states `siteStatus` distinguishes —
 * the chip renders only `pulled`, but a boundary that flattened the three absences
 * could not be un-flattened by a later surface, and each has a different remedy.
 */
export interface SiteContentStatus {
  state: ContentState;
  /** The source in the user's words, already translated (never an entity id). */
  sourceName?: string;
  /** How far behind the source this copy's content is. Time, never items (finding №3). */
  behindSeconds?: number;
}

/** Just the two service handles this read needs, structurally — not the whole bag. */
export interface SiteContentStatusDeps {
  siteData?: { getSites?: () => unknown };
  nexusServices?: unknown;
}

export async function readSiteContentStatus(
  deps: SiteContentStatusDeps,
  siteId: string
): Promise<SiteContentStatus | null> {
  try {
    const core = getIntelligenceCore();
    if (!core) return null;

    // A status is computed for a copy the user is standing in. An id Local's own
    // store cannot name is not one, and computing a status for it anyway would
    // report on an entity nobody could identify in the answer.
    const site = findLocalSite(deps.siteData, siteId);
    if (!site) return null;

    const status = siteStatus({
      core,
      localSiteId: site.id,
      siteName: site.name,
      describeEnvironment: await describeEnvironmentsFor(deps.nexusServices as never),
    });

    const { state, sourceName, behindSeconds } = status.model.content;
    return {
      state,
      ...(sourceName ? { sourceName } : {}),
      ...(behindSeconds !== undefined ? { behindSeconds } : {}),
    };
  } catch {
    return null;
  }
}

/** Local's store keyed by id; falls back to the id for a site with no name on record. */
function findLocalSite(
  siteData: SiteContentStatusDeps['siteData'],
  siteId: string
): { id: string; name: string } | null {
  if (!siteId || !siteData?.getSites) return null;
  const sites = siteData.getSites() as Record<string, { id?: string; name?: string }> | undefined;
  const row = sites ? sites[siteId] : undefined;
  if (!row) return null;
  return { id: row.id ?? siteId, name: typeof row.name === 'string' && row.name ? row.name : siteId };
}
