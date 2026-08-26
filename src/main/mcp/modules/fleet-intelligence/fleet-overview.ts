import type { McpToolHandler, McpToolResult } from '../../types';
import { collectFleetCounts } from '../../../fleet/collectFleetCounts';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetOverviewHandler: McpToolHandler = {
  definition: {
    name: 'fleet_overview',
    description:
      'Adaptive fleet overview — how many sites you have, and how the whole fleet is doing: site counts, totals, and health across ALL WordPress sites you manage through Nexus AI. ' +
      'Detects your fleet type from the data layer (no auth required): ' +
      'if no WP Engine installs are in the database, local sites ARE your complete fleet. ' +
      'If WPE installs exist, returns combined local + WPE summary. ' +
      'Use as the canonical answer to "tell me about my fleet" or "fleet overview" questions. ' +
      'Reads from graph.db and local twin cache — no live API calls.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Fleet Overview', readOnlyHint: true },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const db = (services as any).graphService?.getDb?.();

    // The canonical fleet counts — same population `collectFleetCounts` gives
    // every other surface (GET_FLEET_SUMMARY, GET_DASHBOARD_STATS). Used below
    // to replace the ad hoc `source IN ('wpe','external')` probe query with a
    // single shared definition, so this tool can't drift from theirs.
    const counts = collectFleetCounts({
      getSites: () => (services as any).siteData?.getSites?.() ?? {},
      getDb: () => db ?? null,
    });

    // ── Detect fleet type from data presence ──────────────────────────────
    // wpeCount here means "any remote install, WPE or external" — same value
    // the old `source IN ('wpe','external')` probe query produced, now sourced
    // from collectFleetCounts instead of a second, separately-maintained query.
    const wpeCount = counts.wpe.count + counts.external.count;
    let wpeRows: Array<{
      count: number;
      total_posts: number | null;
      total_users: number | null;
      with_post_count: number;
      most_recent_post: number | null;
      /** WP Engine installs only — every metric prefixed `wpe_` is scoped to these rows. */
      wpe_count: number;
      wpe_with_wp_version: number;
      wpe_with_post_count: number;
      /** External SSH hosts only. */
      external_count: number;
      external_with_wp_version: number;
    }> = [];

    if (db) {
      try {
        if (wpeCount > 0) {
          // Every coverage metric is counted over the same population it is
          // divided by. A numerator spanning both sources over a WPE-only
          // denominator printed "1 of 0" for a user with SSH hosts and no
          // WP Engine account.
          wpeRows = db.prepare(`
            SELECT
              COUNT(*) as count,
              SUM(post_count) as total_posts,
              SUM(user_count) as total_users,
              COUNT(CASE WHEN post_count IS NOT NULL THEN 1 END) as with_post_count,
              MAX(last_post_at) as most_recent_post,
              COUNT(CASE WHEN source = 'wpe' THEN 1 END) as wpe_count,
              COUNT(CASE WHEN source = 'wpe' AND wp_version IS NOT NULL THEN 1 END) as wpe_with_wp_version,
              COUNT(CASE WHEN source = 'wpe' AND post_count IS NOT NULL THEN 1 END) as wpe_with_post_count,
              COUNT(CASE WHEN source = 'external' THEN 1 END) as external_count,
              COUNT(CASE WHEN source = 'external' AND wp_version IS NOT NULL THEN 1 END) as external_with_wp_version
            FROM sites WHERE source IN ('wpe', 'external') AND is_active=1
          `).all() as typeof wpeRows;
        }
      } catch { /* graph.db unavailable */ }
    }

    // ── Local site data from twin service ─────────────────────────────────
    // Deliberately NOT collectFleetCounts().local.count here: every figure in
    // this section (localIndexed, post/user totals, WP version histogram) is
    // computed by iterating `twins`, and localCount is the denominator those
    // figures are reported against. Swapping only localCount's source to
    // Local's own site store while leaving the rest twin-scoped would let
    // localIndexed (a subset of twins) exceed localCount whenever the twin
    // cache and Local's store briefly disagree — the exact "numerator and
    // denominator from different populations" bug this file's own comment
    // below already guards against for the WPE/external split. The twin cache
    // is a legitimate, documented population for local detail (CLAUDE.md,
    // "Fleet counts") — counts.local.count is used above only for the
    // combined `wpeCount` gate, whose population (WPE + external, from the
    // graph) is unrelated to `twins`.
    const twins = (services as any).twinService?.getAll?.() ?? [];
    const localCount = twins.length;
    const localIndexed = twins.filter((t: any) =>
      t.completeness === 'indexed' || t.completeness === 'metadata'
    ).length;
    const localPostTotal = twins.reduce((sum: number, t: any) => sum + (t.postCount ?? 0), 0);
    const localUserTotal = twins.reduce((sum: number, t: any) => sum + (t.userCount ?? 0), 0);
    const localMostRecent = twins.reduce((max: number | null, t: any) =>
      t.lastPostAt && (!max || t.lastPostAt > max) ? t.lastPostAt : max, null as number | null
    );
    const localWpVersions = new Map<string, number>();
    for (const t of twins) {
      const v = (t.wpVersion as string | undefined) ?? 'unknown';
      localWpVersions.set(v, (localWpVersions.get(v) ?? 0) + 1);
    }

    // ── No sites at all ───────────────────────────────────────────────────
    if (localCount === 0 && wpeCount === 0) {
      return ok('No sites found in your fleet. Create a site in Local or sync your WP Engine account.');
    }

    const lines: string[] = ['## Your Fleet'];
    lines.push('');

    // ── Fleet type header ──────────────────────────────────────────────────
    if (wpeCount === 0) {
      lines.push(`**${localCount} site${localCount !== 1 ? 's' : ''}** — ${localIndexed} with full data`);
    } else {
      const totalSites = localCount + wpeCount;
      lines.push(`**${totalSites} total sites** — ${localCount} local · ${wpeCount} remote`);
    }
    lines.push('');

    // ── Local section ─────────────────────────────────────────────────────
    if (localCount > 0) {
      if (wpeCount > 0) lines.push('### Local Sites');
      lines.push(`- **Sites:** ${localCount} (${localIndexed} indexed)`);
      if (localPostTotal > 0) lines.push(`- **Posts:** ${localPostTotal.toLocaleString()}`);
      if (localUserTotal > 0) lines.push(`- **Users:** ${localUserTotal.toLocaleString()}`);
      if (localMostRecent) {
        const d = new Date(localMostRecent).toLocaleDateString();
        lines.push(`- **Last edited:** ${d}`);
      }
      const wpEntries = Array.from(localWpVersions.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      if (wpEntries.length > 0) {
        lines.push(`- **WordPress:** ${wpEntries.map(([v, c]) => `${v} (${c})`).join(', ')}`);
      }
      lines.push('');
    }

    // ── WPE section ───────────────────────────────────────────────────────
    // Scoped to WP Engine rows only (the `wpe_*` aggregates above): "(CAPI)" is
    // a WP Engine concept, and an external SSH host has no CAPI record to have
    // come from. External hosts get their own section below.
    if (wpeRows.length > 0 && wpeRows[0].wpe_count > 0) {
      const row = wpeRows[0];
      lines.push('### WP Engine Installs');
      lines.push(`- **Installs:** ${row.wpe_count}`);
      lines.push(`- **With WP version (CAPI):** ${row.wpe_with_wp_version} of ${row.wpe_count}`);
      const sshSynced = row.wpe_with_post_count;
      if (sshSynced > 0) {
        lines.push(`- **SSH-synced (full data):** ${sshSynced} of ${row.wpe_count}`);
        if (row.total_posts) lines.push(`- **Posts (synced installs):** ${Number(row.total_posts).toLocaleString()}`);
        if (row.total_users) lines.push(`- **Users (synced installs):** ${Number(row.total_users).toLocaleString()}`);
      } else {
        lines.push(`- **SSH-synced:** 0 of ${row.wpe_count} — enable "Site info updates" in the Nexus AI Settings tab to schedule automatic syncs, or call \`wpe_site_deep_refresh\` for a specific install`);
      }
      if (row.most_recent_post) {
        const d = new Date(row.most_recent_post).toLocaleDateString();
        lines.push(`- **Last edited (synced):** ${d}`);
      }
      lines.push('');
    }

    // ── External SSH hosts ────────────────────────────────────────────────
    if (wpeRows.length > 0 && wpeRows[0].external_count > 0) {
      const row = wpeRows[0];
      lines.push('### External SSH Hosts');
      lines.push(`- **Hosts:** ${row.external_count}`);
      lines.push(`- **With WP version:** ${row.external_with_wp_version} of ${row.external_count}`);
      lines.push(
        `- **Data:** populated only when you run a command against the host — ` +
        `there is no background refresh for external hosts, so plugin, theme and PHP data stay empty until then`
      );
      lines.push('');
    }

    // ── Combined totals (WPE customers with synced data) ──────────────────
    if (wpeCount > 0 && wpeRows[0]?.with_post_count) {
      const wpeRow = wpeRows[0];
      const combinedPosts = localPostTotal + (Number(wpeRow.total_posts) || 0);
      const combinedUsers = localUserTotal + (Number(wpeRow.total_users) || 0);
      if (combinedPosts > 0 || combinedUsers > 0) {
        lines.push('### Combined Totals (partial — based on synced data)');
        if (combinedPosts > 0) lines.push(`- **Posts:** ${combinedPosts.toLocaleString()}`);
        if (combinedUsers > 0) lines.push(`- **Users:** ${combinedUsers.toLocaleString()}`);
        lines.push('');
      }
    }

    // ── Data freshness note ────────────────────────────────────────────────
    // WPE-only, numerator and denominator both.
    if (wpeRows[0] && wpeRows[0].wpe_count > 0 && wpeRows[0].wpe_with_post_count < wpeRows[0].wpe_count) {
      const wpeOnly = wpeRows[0].wpe_count;
      const pct = Math.round((wpeRows[0].wpe_with_post_count / wpeOnly) * 100);
      lines.push(
        `> ℹ️ WPE post/user totals cover ${pct}% of installs. ` +
        `Enable "Site info updates" in the Nexus AI Settings tab to schedule automatic SSH syncs, ` +
        `or call \`wpe_site_deep_refresh\` for individual installs.`
      );
    }

    return ok(lines.join('\n'));
  },
};
