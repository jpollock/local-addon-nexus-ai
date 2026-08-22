/**
 * wpe_sync_sites — refresh the graph's WP Engine data.
 *
 * ── Why this tool exists (WP-61 / D5) ───────────────────────────────────────
 * The capability was never missing. `indexAllWpeContent` has three live
 * callers (`ipc-handlers.ts` per-site bulk, the Operations tab button in
 * `ipc/handlers/wpe-sync.ts`, and an interval scheduler in `index.ts`), and
 * `syncAllWPESites` has the WPE_SYNC_ALL IPC handler behind it.
 *
 * What was missing is a way for an AGENT to reach any of it. Eight error
 * strings named `wpe_sync_sites` as the remedy; the registry had no such tool.
 * A button and a timer are not remedies an agent can follow.
 *
 * ── The two modes, and why one tool carries both ────────────────────────────
 * The eight strings split into two complaints (see `sync-remedy.ts`):
 *
 *   metadata — the graph has no `wpe` rows, or its rows have gone stale.
 *              `syncAllWPESites` DISCOVERS installs from CAPI, so it is the
 *              only path that can fix "no installs found".
 *   content  — rows exist, but their posts are not in the vector index.
 *              `indexAllWpeContent` / `indexOneWpeContent`.
 *
 * They are one tool rather than two because `content: true` is a superset:
 * `syncContent` piggybacks a metadata sync on its already-warm SSH
 * ControlMaster (`WPESyncService.ts:554`), so indexing content refreshes
 * metadata as a side effect. Metadata alone does NOT index content —
 * `syncInstall` says so at `WPESyncService.ts:437`, deliberately, so that
 * startup and metadata sweeps never trigger embedding work.
 *
 * ── Why this is not gated on CAPI availability ──────────────────────────────
 * `isAvailable` gates on the sync service alone. Hiding the tool from a
 * logged-out user would put the product back where it started: eight messages
 * naming a tool the caller cannot see. The auth failure is explained at
 * execute time instead, where it can name `wpe_login`.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { WPE_SYNC_TOOL } from './sync-remedy';

/**
 * WPE rows in the graph whose name is what the caller typed.
 *
 * `.all()` rather than `LIMIT 1`, and pinned to `source='wpe'`: two installs
 * of the same name can exist in different accounts, and an unordered pick
 * between them would sync one install while the caller believed it had synced
 * the other. Same collision policy as `resolveRemoteGraphSite` (WP-58) —
 * declining is the answer, not choosing.
 */
function wpeRowsNamed(db: any, name: string): Array<{ id: string; name: string; remote_install_id: string | null; account_id: string | null }> {
  if (!db) return [];
  try {
    return (db.prepare(
      "SELECT id, name, remote_install_id, account_id FROM sites WHERE source='wpe' AND is_active=1 AND name=?",
    ).all(name) ?? []) as Array<{ id: string; name: string; remote_install_id: string | null; account_id: string | null }>;
  } catch {
    return [];
  }
}

export const syncSitesHandler: McpToolHandler = {
  definition: {
    name: WPE_SYNC_TOOL,
    description:
      'Refresh the local knowledge graph\'s WP Engine data. ' +
      'By default syncs METADATA fleet-wide: discovers installs from the WP Engine API and ' +
      'collects WordPress/PHP versions, plugins and users over SSH. This is what to run when ' +
      'a WPE install is missing from the graph entirely, or when a tool reports its data as stale. ' +
      'Pass content: true to also index the installs\' posts and pages for semantic search — ' +
      'that mode refreshes metadata too, but is much slower because it generates embeddings. ' +
      'Pass install_name to work on one install instead of the whole fleet; prefer this for ' +
      'content: true, which can take a long time across a large account. ' +
      'Fleet metadata sync skips installs already synced within the freshness threshold — ' +
      'a run reporting mostly "skipped" means the data was already current, not that it failed.',
    inputSchema: {
      type: 'object',
      properties: {
        install_name: {
          type: 'string',
          description:
            'WP Engine install name (e.g. "mysite-prod" — the install name, not the domain). ' +
            'Omit to run across the whole fleet.',
        },
        content: {
          type: 'boolean',
          description:
            'Index post/page content for semantic search as well as metadata (default: false). ' +
            'Slow — generates embeddings per post. Requires an SSH key and the embedding service.',
        },
      },
    },
    isAvailable: (services) => !!services.wpeSyncService,
  },

  async execute(args, services): Promise<McpToolResult> {
    const sync = services.wpeSyncService;
    if (!sync) {
      return error(
        'WP Engine sync service is not available. This addon starts it during initialisation; ' +
        'if it is missing, restart Local and check the Nexus AI log.',
      );
    }

    const installName = typeof args.install_name === 'string' && args.install_name
      ? args.install_name
      : undefined;
    const wantContent = args.content === true;

    // One install: resolve it before doing anything, so a name that matches
    // two installs refuses rather than syncing an arbitrary one.
    let row: { id: string; name: string; remote_install_id: string | null } | undefined;
    if (installName) {
      const db = (services as any).graphService?.getDb?.();
      const rows = wpeRowsNamed(db, installName);
      if (rows.length > 1) {
        return error(
          `"${installName}" matches ${rows.length} WP Engine installs across accounts — ` +
          `sync the whole fleet (omit install_name) or narrow by account: ` +
          rows.map((r) => `${r.name} (${r.account_id ?? 'unknown account'})`).join(', '),
        );
      }
      row = rows[0];
    }

    // ── Content mode ────────────────────────────────────────────────────────
    if (wantContent) {
      if (installName) {
        if (!row) {
          // Content indexing reads the graph's own row list; it cannot index
          // an install that is not in the graph. Say that, and name the mode
          // that WOULD put it there, rather than failing as "not found".
          return error(
            `"${installName}" is not in the graph, so its content cannot be indexed yet. ` +
            `Run ${WPE_SYNC_TOOL} without content: true first — a metadata sync discovers ` +
            `installs from the WP Engine API and creates their rows — then retry with content: true.`,
          );
        }
        try {
          await sync.indexOneWpeContent(row.id, row.name);
        } catch (err: any) {
          return error(`Content indexing failed for "${row.name}": ${err?.message ?? String(err)}`);
        }
        return ok(`✅ Indexed content for **${row.name}** (metadata refreshed on the same SSH session).`);
      }

      const result = await sync.indexAllWpeContent();
      // indexAllWpeContent returns {0,0} both for "nothing to do" and for
      // "dependencies missing" — it warns to the log and returns rather than
      // throwing. A bare "0 indexed" would read as success, so the zero case
      // names both reachable causes instead of picking one.
      if (result.indexed === 0 && result.errors === 0) {
        return ok(
          'No WP Engine content was indexed. Either there are no active WP Engine installs in ' +
          'the graph (run this tool without content: true first, which discovers them), or the ' +
          'SSH key / embedding service is not configured. The Nexus AI log names which.',
        );
      }
      return ok(
        `✅ WP Engine content index complete — ${result.indexed} install(s) indexed` +
        `${result.errors > 0 ? `, ${result.errors} failed (see the Nexus AI log)` : ''}.`,
      );
    }

    // ── Metadata mode ───────────────────────────────────────────────────────
    if (installName) {
      // `syncSingleSite` takes the CAPI install id, not the name. The graph
      // row usually carries it; when the install is not in the graph at all —
      // which is the case six of the eight remedy strings are written for —
      // fall back to CAPI, because that is the path that can actually add it.
      let installId = row?.remote_install_id ?? null;
      if (!installId) {
        if (!services.localServices?.isCAPIAvailable()) {
          return error(
            `"${installName}" is not in the graph and WP Engine is not authenticated, so its ` +
            `install id cannot be looked up. Call wpe_login, then retry.`,
          );
        }
        try {
          const installs = (await services.localServices.capiGetInstalls()) as any[];
          const match = (installs ?? []).filter((i: any) => i?.name === installName);
          if (match.length === 0) {
            return error(`No WP Engine install named "${installName}" exists on any account you can see.`);
          }
          if (match.length > 1) {
            return error(
              `"${installName}" matches ${match.length} WP Engine installs across accounts — ` +
              `sync the whole fleet (omit install_name) instead.`,
            );
          }
          installId = match[0].id;
        } catch (err: any) {
          return error(`WP Engine API lookup failed for "${installName}": ${err?.message ?? String(err)}`);
        }
      }

      try {
        await sync.syncSingleSite(installId!);
      } catch (err: any) {
        return error(`Metadata sync failed for "${installName}": ${err?.message ?? String(err)}`);
      }
      return ok(`✅ Refreshed WP Engine metadata for **${installName}**.`);
    }

    const result = await sync.syncAllWPESites();
    if (!result.success) {
      const first = result.errors?.[0]?.error ?? 'unknown error';
      return error(`WP Engine metadata sync failed: ${first}`);
    }

    const parts = [`${result.synced} synced`];
    if (result.skipped > 0) parts.push(`${result.skipped} already fresh (skipped)`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
    const detail = result.failed > 0 && result.errors?.length
      ? `\n\nFirst failure: ${result.errors[0].error}`
      : '';

    return ok(
      `✅ WP Engine metadata sync complete — ${parts.join(', ')}.${detail}` +
      (result.synced === 0 && result.skipped > 0
        ? '\n\nNothing was out of date. Pass install_name to re-sync one install regardless of freshness.'
        : ''),
    );
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
