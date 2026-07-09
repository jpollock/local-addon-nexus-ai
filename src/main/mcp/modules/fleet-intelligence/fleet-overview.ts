import type { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetOverviewHandler: McpToolHandler = {
  definition: {
    name: 'fleet_overview',
    description:
      'Adaptive fleet overview — covers ALL WordPress sites you manage through Nexus AI. ' +
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

    // ── Detect fleet type from data presence ──────────────────────────────
    let wpeCount = 0;
    let wpeRows: Array<{
      count: number;
      total_posts: number | null;
      total_users: number | null;
      with_wp_version: number;
      with_post_count: number;
      most_recent_post: number | null;
    }> = [];

    if (db) {
      try {
        const probe = db.prepare(
          "SELECT COUNT(*) as c FROM sites WHERE source='wpe' AND is_active=1"
        ).get() as { c: number };
        wpeCount = probe?.c ?? 0;

        if (wpeCount > 0) {
          wpeRows = db.prepare(`
            SELECT
              COUNT(*) as count,
              SUM(post_count) as total_posts,
              SUM(user_count) as total_users,
              COUNT(CASE WHEN wp_version IS NOT NULL THEN 1 END) as with_wp_version,
              COUNT(CASE WHEN post_count IS NOT NULL THEN 1 END) as with_post_count,
              MAX(last_post_at) as most_recent_post
            FROM sites WHERE source='wpe' AND is_active=1
          `).all() as typeof wpeRows;
        }
      } catch { /* graph.db unavailable */ }
    }

    // ── Local site data from twin service ─────────────────────────────────
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
      lines.push(`**${totalSites} total sites** — ${localCount} local · ${wpeCount} WP Engine`);
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
    if (wpeCount > 0 && wpeRows.length > 0) {
      const row = wpeRows[0];
      lines.push('### WP Engine Installs');
      lines.push(`- **Installs:** ${row.count}`);
      lines.push(`- **With WP version (CAPI):** ${row.with_wp_version} of ${row.count}`);
      const sshSynced = row.with_post_count;
      if (sshSynced > 0) {
        lines.push(`- **SSH-synced (full data):** ${sshSynced} of ${row.count}`);
        if (row.total_posts) lines.push(`- **Posts (synced installs):** ${Number(row.total_posts).toLocaleString()}`);
        if (row.total_users) lines.push(`- **Users (synced installs):** ${Number(row.total_users).toLocaleString()}`);
      } else {
        lines.push(`- **SSH-synced:** 0 of ${row.count} — enable "Site info updates" in the Nexus AI Settings tab to schedule automatic syncs, or call \`wpe_site_deep_refresh\` for a specific install`);
      }
      if (row.most_recent_post) {
        const d = new Date(row.most_recent_post).toLocaleDateString();
        lines.push(`- **Last edited (synced):** ${d}`);
      }
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
    if (wpeCount > 0 && wpeRows[0] && wpeRows[0].with_post_count < wpeCount) {
      const pct = Math.round((wpeRows[0].with_post_count / wpeCount) * 100);
      lines.push(
        `> ℹ️ WPE post/user totals cover ${pct}% of installs. ` +
        `Enable "Site info updates" in the Nexus AI Settings tab to schedule automatic SSH syncs, ` +
        `or call \`wpe_site_deep_refresh\` for individual installs.`
      );
    }

    return ok(lines.join('\n'));
  },
};
