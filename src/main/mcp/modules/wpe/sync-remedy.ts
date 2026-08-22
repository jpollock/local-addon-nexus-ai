/**
 * The WP Engine sync remedy, written down once.
 *
 * ── Why this file exists (WP-61 / the fleet-tool report's D5) ────────────────
 * Eight strings across five files told the reader to run `wpe_sync_sites`, and
 * `ToolRegistry` had never carried a tool by that name. The capability was
 * real — the Operations tab has a button and there is an interval timer — but
 * **an agent has no button**, and those eight sentences were an agent's only
 * instruction. They named nothing callable.
 *
 * The fix is two-sided and both sides are needed: the tool is registered
 * (`sync-sites.ts`), and the sentences that name it are extracted here so
 * there is one place to be right rather than eight places to drift.
 *
 * ── Why there are TWO remedies and not one ──────────────────────────────────
 * Reading the eight strings as one complaint cannot see that they are two.
 * Six of them are missing METADATA — a graph with no `wpe` rows at all, or
 * rows whose `last_sync_at` has gone stale. Two of them are missing CONTENT —
 * rows that exist but whose posts are not in the vector index.
 *
 * `indexAllWpeContent` selects `FROM sites WHERE source='wpe' AND is_active=1`,
 * so it cannot put an install into the graph that is not already there. A
 * single remedy pointing at content indexing would have been a real tool name
 * attached to a fix that does not work for six of the eight — and a check that
 * reads the tool surface would have been green about it, because a registry
 * can confirm that a name resolves and cannot confirm that a remedy helps.
 *
 * ── Why the tool name is written literally here ─────────────────────────────
 * `tests/unit/mcp/tool-remedy-references.test.ts` sweeps string literals for
 * imperative tool references and checks them against the live registry. An
 * interpolated `${WPE_SYNC_TOOL}` would be invisible to that sweep, so this
 * one file — the only place the name is typed — would be the one place the
 * instrument could not see. The literal is written out, and
 * `WPE_SYNC_TOOL` is pinned against both sentences and against the handler's
 * own `definition.name` by that same test.
 */

/** The registered name. Pinned against `syncSitesHandler.definition.name`. */
export const WPE_SYNC_TOOL = 'wpe_sync_sites';

/**
 * For: the graph has no WP Engine rows, or its rows are stale.
 *
 * Names CAPI explicitly because discovery is the part that matters here — a
 * metadata sync fetches the install list, so it can fix "no installs found",
 * which content indexing cannot.
 */
export const WPE_SYNC_REMEDY_METADATA =
  'Run `wpe_sync_sites` to refresh WP Engine install metadata (installs, WordPress ' +
  'and PHP versions, plugins, users) from the WP Engine API and SSH.';

/**
 * For: the install's row exists but its posts are not searchable.
 *
 * Names the argument, because the default mode does not do this and a reader
 * who runs the tool bare will get a successful sync and an unchanged index.
 */
export const WPE_SYNC_REMEDY_CONTENT =
  'Run `wpe_sync_sites` with `content: true` to index WP Engine install content ' +
  'for search.';
