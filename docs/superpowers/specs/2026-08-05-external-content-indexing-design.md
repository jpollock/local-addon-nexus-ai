# Spec 4b — External host content indexing (L3)

**Status:** approved
**Branch:** `feat/non-wpe-host-support`
**Depends on:** Spec 4a (external metadata refresh, L1+L2) — `ExternalRefreshScheduler`,
`resolveTransport`, the honesty rule (never fabricate an absent value)
**Follows:** the fleet-visibility plan; the remote-access-permissions UI plan

---

## 1. Problem

External SSH hosts show 0% Searchable in the Data Completeness widget. Nothing extracts their
post content, embeds it, or indexes it for semantic search — the L3 gap this project has
documented and deliberately deferred since the fleet-visibility plan:

> **L3 (content indexing) is not implemented for external hosts** — Spec 4b. They show 0%
> Searchable in Data Completeness, which is the true number.

WP Engine installs do not have this problem: `WPESyncService.syncContent()` extracts posts over
SSH via `RemoteContentExtractor`, embeds them, stores vectors, and marks the install
`state: 'indexed'` in `IndexRegistry`, on its own opt-in interval
(`wpeContentIndexAutoEnabled`).

## 2. Goal, in the project's own terms

Completing the L1/L2/L3 model for external hosts, which Spec 4a brought through L2:

| Level | Meaning | External, before this spec | External, after |
|---|---|---|---|
| L1 Scanned | WP version, installed plugins/themes | ✅ Spec 4a | unchanged |
| L2 Configured | active plugins, users, post counts, PHP version, site URL | ✅ Spec 4a | unchanged |
| L3 Searchable | post content extracted, embedded, indexed | ❌ none | ✅ this spec |

## 3. Scope

**In:**
- `ExternalContentIndexScheduler` — opt-in, interval-driven, staleness-tracked, settings-reactive
- Generalizing `RemoteContentExtractor` to take a resolved `SiteTransport` instead of calling
  WP Engine's SSH bridge directly
- A new `ExternalContentIndexService` (parallel to `WPESyncService`, not a modification of it)
  doing extraction → embedding → vector storage → `IndexRegistry` update
- `nexus host index <alias>` — run one host's content index on demand
- Two new settings, wired into `onSettingsUpdated`
- Data Completeness's Searchable count includes external hosts once they're indexed

**Out:**
- Any change to `WpeRefreshScheduler`, `WPESyncService`, or the WP Engine content-index path —
  this spec adds a parallel path, it does not touch the existing one
- `ControlMaster` on external SSH — still ruled out, per Spec 4a's §6
- Chunking, or anything beyond WP Engine's existing "one document per post" approach — matching
  the existing behavior, not improving on it
- Incremental/delta indexing — like WP Engine's content index today, each cycle re-extracts and
  re-embeds a host's full published-post set

## 4. Why a separate connection, not a fifth batch on Spec 4a's session

WP Engine's `syncContent()` piggybacks a full metadata sync onto the same SSH session content
extraction opens, because `buildWpeSshArgs` sets `ControlMaster=auto` /
`ControlPersist=30s` — the connection stays warm for 30 seconds after the first command, so a
second round of WP-CLI calls costs 1-3s instead of a fresh 13-30s cold start.

External hosts deliberately have no `ControlMaster` (Spec 4a §6: shared hosting commonly caps
`MaxSessions`, a command-line `-o` would override the user's own `~/.ssh/config`, and holding a
socket open to a third party's server after the work finished is not something this addon does).
Without a warm connection to reuse, folding content extraction into the existing 4-batch
metadata session would only couple the two schedules together without saving a connection.

**Decision:** a fully independent `ExternalContentIndexScheduler`, its own SSH session per host
per cycle, its own opt-in setting and interval — the same shape Spec 4a itself uses relative to
WP Engine's `WpeRefreshScheduler`: a parallel component, not a shared one.

## 5. Component

`src/main/startup/ExternalContentIndexScheduler.ts`, mirroring `ExternalRefreshScheduler`'s
shape exactly:

- `start()` — idempotent; a second call while running is a no-op and logs
- `stop()`
- `restart(intervalMs: number)` — stop, adopt new interval, start
- `stalenessThresholdMs` defaults to `intervalMs`
- Never throws; a failure on one host does not abort the cycle
- Concurrency: `p-limit(3)`, same reasoning as Spec 4a — bounds local resource use, not a remote
  connection limit, since these are unrelated servers

**Selection.** Rows where `source='external' AND is_active=1`, whose `content_indexed_at` is
NULL or older than `stalenessThresholdMs`. `is_active=1` is load-bearing for the same reason it
is everywhere else in this project: `nexusHostRemove` soft-deletes, and a removed host must
never be reconnected to.

**New column:** `content_indexed_at INTEGER` on graph `sites`, added via the same migration
pattern `WpeRefreshScheduler`/`ExternalRefreshScheduler` already use for `ssh_last_sync_at`
(a column-existence check + `ALTER TABLE` on first run). Distinct from `ssh_last_sync_at` —
metadata refresh and content indexing are independently scheduled and must be independently
staleness-tracked, exactly as `last_sync_at` and `ssh_last_sync_at` are already kept separate.

## 6. Extraction — generalizing `RemoteContentExtractor`

`RemoteContentExtractor` has exactly two WP-Engine-specific lines today
(`src/main/content/RemoteContentExtractor.ts`):

```ts
const result = await this.localServices.remoteWpCliRun(installName, [...], { skipPlugins: false, skipThemes: false });
// ...
siteInfo: { name: installName, url: `${installName}.wpengine.com`, wpVersion: '' },
```

**Change 1.** Replace the `localServices: LocalServicesBridge` dependency with a resolved
`SiteTransport` (from `resolveTransport`), and call `transport.runWpCli(args, opts)` instead.
`RunOpts.skipPlugins`/`skipThemes` are already generic transport-level options
(`src/main/transport/types.ts:25-26`) — WP Engine's builder honors them, and
`buildExternalWpCliCommand` has no skip flags at all (CLAUDE.md: *"No --skip-plugins/
--skip-themes: those exist for WP Engine's mu-plugin environment, and suppressing plugins on
someone else's host would change what wp reports without them asking"*), so passing the same
`{ skipPlugins: false, skipThemes: false }` to an external transport is inert — plugins and
themes are already always loaded there. No CPT-registration gap to work around on external
hosts.

**Change 2.** `extract()` takes an identifier and a label rather than an `installName` used for
both routing and display — `extract(transport: SiteTransport, siteLabel: string)`. WP Engine's
call site continues passing the install name for both; the external call site passes the
resolved transport and the host's alias. `siteInfo.url` becomes `''` when nothing better is
known — consistent with Spec 4a's honesty rule (an unknown value is absent, not guessed), and
nothing today reads this field for indexing purposes, so this is a safe default rather than a
new fabrication.

No change to post fetching, CPT handling, `EXCLUDED_POST_TYPES` filtering, or content cleaning —
all identical for both target types.

## 7. Storage — a new parallel service, not a shared one

`src/main/events/ExternalContentIndexService.ts` (new), structured like the extraction half of
`WPESyncService.syncContent()` but standalone:

1. `extractor.extract(transport, alias)` → posts
2. For each post: `graphService.upsertContent({ site_id: externalSiteId(alias), ... })` —
   unchanged shape, the real `ssh:<alias>` id, no translation needed (it's a DB column, not a
   sqlite-vec table name)
3. Build `VectorDocument`s, embed in batches of 10 (matching `WPESyncService`'s existing batch
   size — no reason to diverge)
4. **`metadata: JSON.stringify({ ..., source: 'external' })`** — not `'wpe'`, not omitted. This
   is the fabricated-value class of bug this project has spent this entire branch hunting; the
   WP Engine path hardcodes `'wpe'` and the external path must not copy it
5. `vectorStore.upsert(vectorSiteId(externalSiteId(alias)), embeddedDocs)` — see §8 for
   `vectorSiteId`
6. `indexRegistry.update(externalSiteId(alias), { state: 'indexed', lastIndexed, documentCount,
   chunkCount, durationMs })` — same real `ssh:<alias>` id; `IndexRegistry` is an electron-store
   key-value map with no character restriction, unlike the vector store
7. On failure: `indexRegistry.update(id, { state: 'error', lastIndexed: Date.now() })`, do not
   throw — content indexing is optional, matching WP Engine's own "don't throw, metadata sync
   already succeeded" reasoning, adapted here since there is no metadata sync to protect in the
   same call, but the principle (one host's indexing failure must not look like a crash) still
   applies

`indexAllExternalContent(): Promise<{ indexed: number; errors: number }>` — the method the
scheduler and the manual CLI command both call, selecting `WHERE source='external' AND
is_active=1` (never `source='wpe'`, never a merged query touching both — see §3's Out list).

## 8. The vector-store siteId blocker, and its fix

`SqliteVecStore.validateSiteId` (`src/main/vector-store/SqliteVecStore.ts:27-31`) requires
`^[a-zA-Z0-9_-]+$`. External site IDs are `ssh:<alias>` — the colon fails validation
immediately, and `upsert()` would throw on the first call.

**Fix — translate only at the vector-store boundary, change nothing else.** Changing
`externalSiteId()`'s canonical format now would ripple through every call site Spec 4a, the
fleet-visibility plan, and the settings UI plan already shipped against the `ssh:<alias>` id —
not worth it for one component's character restriction.

```ts
/** sqlite-vec table names can't contain ':' — translate only at this boundary.
 *  The graph, IndexRegistry, and content table all keep the real ssh:<alias> id;
 *  only the vector store's table-name-derived siteId changes. */
function vectorSiteId(siteId: string): string {
  return siteId.replace(/:/g, '_');
}
```

`ssh:hostinger-test` → `ssh_hostinger-test`, which satisfies `validateSiteId`. Local and WPE
ids (`mmWgjXGRS`, `wpe-<uuid>`) contain no colons, so `vectorSiteId` is a no-op for them — safe
to apply unconditionally rather than branching on source.

## 9. Settings

| Setting | Default | Notes |
|---|---|---|
| `externalContentIndexAutoEnabled` | **`false`** | Opt-in, matching every other external-host schedule. |
| `externalContentIndexIntervalHours` | `24` | Matches `wpeContentIndexIntervalHours`'s default. |

Both added to `UpdateSettingsSchema` (`.strict()` — a key missing there is silently stripped on
save, the exact bug this project has already shipped once) and `DEFAULT_SETTINGS`
(`ipc-handlers.ts`). Wired into `onSettingsUpdated`, which — since the final-review fix in the
metadata-refresh plan — is now reachable from every settings-write path (GraphQL and IPC alike),
not just the IPC one.

## 10. `nexus host index <alias>`

GraphQL `nexusHostIndex(alias: String!): NexusHostIndexResult!`, `{ success, error,
postsIndexed, documentsIndexed }` — same shape as `nexusHostRefresh`. Resolves the alias to a
transport via `resolveTransport(..., 'wpcli_read')`, calls the same
`ExternalContentIndexService` method the scheduler uses for one host, independent of whether
the scheduler is enabled — mirrors Spec 4a's `nexus host refresh` exactly, same reasoning: a
user should not have to wait for or enable a timer to see indexing work once.

Not audited — every remote command here is a read (`post list`), and the only mutation is the
local graph/vector-store/registry write, matching this codebase's read-only-paths-not-audited
convention.

## 11. Surfaces that change

**Data Completeness.** No code change needed beyond what already exists — the widget already
checks `indexedSet.has(site.id)` against `IndexRegistry` entries for external hosts (added when
the fleet-visibility plan widened the completeness counts). Once `ExternalContentIndexService`
starts writing `state: 'indexed'` entries keyed by the real `ssh:<alias>` id, the existing
Searchable count picks them up automatically.

**CLI.** `nexus host index <alias>`, alongside `add`/`test`/`list`/`remove`/`refresh`.

**Settings UI.** Out of scope for this spec — the remote-access-permissions UI plan already
shipped the External SSH Hosts card with one schedule row (metadata refresh). Adding a second
row for content indexing is follow-up UI work once this backend exists, not part of this spec.

## 12. Constraints

- **Nothing is ever written to the user's remote server.** `post list` is the only remote
  command; read-only, matching `wpcli_read`'s classification (not on `REMOTE_POLICY`'s
  blocklist).
- **No SSH key material is stored.** Unaffected — this spec adds no new credential path.
- **`ssh-args.ts` remains the only place an SSH invocation is constructed.** This spec adds no
  new builder; it reuses `resolveTransport`.
- **No `ControlMaster` on external SSH**, per §4 — this spec does not revisit that decision.
- **Read-only paths are not audited.** The scheduler and `nexus host index` mutate only the
  local graph/vector-store/registry; neither should call `auditDirectOperation`.
- **`resolveTransport` is the only router.** No target resolution or command policy added here.
- **Do not modify `WPESyncService` or `WpeRefreshScheduler`.** This spec's storage and
  scheduling are new, parallel components.

## 13. Error handling

- The scheduler never throws; each host is wrapped individually.
- `getDb()` returning null during startup: tolerate it, return an empty result, try again next
  cycle — same as every other scheduler in this project.
- A host refused by `isOperationAllowed` (a `remoteSiteExceptions` entry denying it) is skipped,
  logged at info, not counted as failed.
- Zero published posts is not an error — logged at info, `IndexRegistry` still marked
  `state: 'indexed'` with `documentCount: 0`, matching WP Engine's own handling of an empty
  result.
- An embedding-service or vector-store dependency being unavailable degrades the same way
  `WPESyncService.syncContent` does: log a warning, return, do not throw.

## 14. Testing

**`RemoteContentExtractor` generalization:** existing WP Engine tests must pass unchanged
(behavior-preserving refactor — same output shape, same CPT/exclusion logic); new tests for the
external path using a mock `SiteTransport`, confirming `{ skipPlugins: false, skipThemes: false
}` is passed through harmlessly.

**`vectorSiteId`:** a colon-bearing id translates correctly; an id with no colon is unchanged
(local/WPE ids are a no-op); the translated id satisfies `SqliteVecStore.validateSiteId`'s
regex directly (test against the real regex, not a copy of it).

**`ExternalContentIndexScheduler`:** selection respects `is_active=1` and staleness exactly like
`ExternalRefreshScheduler`'s own test suite verified; one host's extraction throwing does not
abort the cycle for others; a permission refusal counts as skipped, not failed; `start()` is
idempotent.

**`ExternalContentIndexService`:** the vector document's `metadata` field contains
`source: 'external'`, asserted explicitly — this is the regression this spec exists to prevent,
and it needs its own named test, not just incidental coverage. Zero posts still marks the
`IndexRegistry` entry `indexed` with `documentCount: 0`, not `error`.

**Live verification, against the registered host:** run one manual index cycle and confirm the
`sites` table's `content` count for that `site_id` rises, an `IndexRegistry` entry with
`state: 'indexed'` exists for the real `ssh:<alias>` id, `nexus content search
ssh:<alias>@production "<known term>"` returns a result from that host, and Data
Completeness's Searchable count for external hosts is no longer 0. Every prior
task in this branch's history that skipped live verification shipped something a unit-test
suite could not see was broken; this spec's live check is not optional.
