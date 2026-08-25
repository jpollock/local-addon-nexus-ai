import { compareVersions } from '../mcp/modules/fleet/version-utils';

const WP_ORG_UPDATE_URL = 'https://api.wordpress.org/plugins/update-check/1.1/';
const TIMEOUT_MS = 10_000;

export class WordPressOrgClient {
  static async checkUpdates(
    plugins: Array<{ slug: string; version: string }>,
  ): Promise<Map<string, string>> {
    if (plugins.length === 0) return new Map();

    // The request key is `<dir>/<bootstrap-file>.php`, and the filename half
    // is a GUESS. Plugins routinely name that file something else — ACF PRO
    // lives at `advanced-custom-fields-pro/acf.php` — and the real path is
    // not available to us: the graph's `plugins` table has no file column and
    // `slug` is WP-CLI's directory name. Sending the true path would need a
    // column, a migration and every writer, which is its own change.
    //
    // The guess is tolerable ONLY because the answer is checked for identity
    // below: wp.org states which plugin it matched, and an answer about a
    // different plugin is discarded rather than compared. Without that check
    // a mismatch returns a genuinely higher version for the wrong plugin,
    // which a version comparison waves straight through.
    const checked: Record<string, string> = {};
    for (const p of plugins) {
      checked[`${p.slug}/${p.slug}.php`] = p.version;
    }

    const body = JSON.stringify({
      plugins: checked,
      active: Object.keys(checked),
    });

    try {
      const response = await fetch(WP_ORG_UPDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `plugins=${encodeURIComponent(body)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const data = await response.json() as {
        plugins?: Record<string, { new_version?: string; slug?: string; plugin?: string }>;
      };
      const updates = new Map<string, string>();

      // A0 — an update is reported only when there IS one.
      //
      // This used to gate on truthiness alone. WordPress.org's update-check
      // endpoint returns entries whose `new_version` EQUALS, or is LOWER
      // than, the version submitted, so every one of them became an
      // "available update": measured across 42 local sites, 175 reported,
      // ~95 genuine, 78 equal-version and 2 outright downgrades. This is the
      // number a person acts on, so a wrong one discredits every figure
      // printed beside it.
      const installedBySlug = new Map(plugins.map((p) => [p.slug, p.version]));

      for (const [path, info] of Object.entries(data?.plugins ?? {})) {
        const slug = path.split('/')[0];
        const latest = info.new_version;
        if (!latest) continue;

        // Identity before version. wp.org echoes our key but states its OWN
        // slug for whatever it matched; when the two disagree, the answer is
        // about a different plugin and its version means nothing to us.
        // Absence is not a mismatch — some responses omit the field, and
        // withholding on absence would stop reporting real updates.
        if (info.slug && info.slug !== slug) continue;

        const installed = installedBySlug.get(slug);
        // Withhold rather than guess. An invented update IS the bug, so a
        // version we cannot read is not evidence of anything — and
        // `compareVersions` coerces non-numeric segments to 0, which would
        // silently rank 'unknown' below every real version and report an
        // update for it.
        if (!isComparableVersion(installed) || !isComparableVersion(latest)) continue;

        if (compareVersions(installed as string, latest) < 0) {
          updates.set(slug, latest);
        }
      }

      return updates;
    } catch {
      return new Map();
    }
  }
}

/**
 * Whether a version string can be compared numerically at all.
 *
 * `compareVersions` is deliberately lenient (non-numeric segments become 0),
 * which is right for ordering real versions and wrong for deciding whether we
 * know anything: 'unknown' would parse to 0 and rank below everything. This
 * guard is what makes withholding possible.
 *
 * A prerelease like `6.8.0-beta2` (live on this fleet) passes: it reads as
 * 6.8.0, so it withholds against 6.8.0 and reports against 6.8.1 — both safe.
 */
function isComparableVersion(v: string | undefined): boolean {
  return typeof v === 'string' && /^\d+(\.\d+)*/.test(v.trim());
}
