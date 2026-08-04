# WP-CLI Surface Matrix

**As of 2026-08-04, branch `feat/non-wpe-host-support`.** Every row was read from
source, not recalled. Re-derive rather than trust this file if it looks stale —
the commands to regenerate it are at the bottom.

This exists because the question "what can Nexus do with WP-CLI, where?" was
answered five different ways in one session, wrongly more than once. The
denominators kept shifting: CLI *commands*, MCP *tools*, GraphQL *call sites*
and WP-CLI *verbs* are four different populations.

---

## 1. The four populations

| Population | Count | What it is |
|---|---|---|
| CLI subcommands | 22 | `nexus wp …` in `src/cli/commands/wp.ts` |
| MCP tools | 19 | `wp_*` handlers in `src/main/mcp/modules/wp-cli/` |
| GraphQL call sites | 77 | textual references to `nexusWpCommand` in `wp.ts` — ~4 per command, not 77 commands |
| WP-CLI verbs | unbounded | `nexusWpCommand` takes arbitrary argv, so any verb WP-CLI accepts |

Confusing these is what produced "~80 commands". There are 22.

---

## 2. CLI subcommands — how each is serviced

`MCP-first` means the command tries `callMcpTool` and silently falls back to
GraphQL if the MCP server is unreachable. `--json` **skips the MCP path by
design** (`wp.ts:30` — "MCP returns markdown, not structured data").

| # | Command | MCP tool tried | GraphQL path | Reaches external? |
|---|---|---|---|---|
| 1 | `wp plugin list` | `wp_plugin_list` | `nexusWpPluginList` | **yes** |
| 2 | `wp plugin install` | — | `nexusWpCommand` | no |
| 3 | `wp plugin activate` | — | `nexusWpCommand` | no |
| 4 | `wp plugin deactivate` | — | `nexusWpCommand` | no |
| 5 | `wp plugin update` | `wp_plugin_update` | `nexusWpCommand` | **yes** (the only write) |
| 6 | `wp theme list` | — | `nexusWpCommand` | no |
| 7 | `wp theme activate` | — | `nexusWpCommand` | no |
| 8 | `wp core version` | `wp_core_version` | `nexusWpCommand` | **yes** |
| 9 | `wp core update` | — | `nexusWpCommand` | no |
| 10 | `wp db export` | — | `nexusWpCommand` | no |
| 11 | `wp db import` | — | `nexusWpCommand` | no |
| 12 | `wp db scan` | — | `nexusDbScan` | no — db-scanner is local-only by design |
| 13 | `wp db clean` | — | `nexusDbClean` | no — same |
| 14 | `wp db report` | — | `nexusDbReport` | no — same |
| 15 | `wp db search-replace` | — | `nexusWpCommand` | no |
| 16 | `wp post create` | — | `nexusWpCommand` | no |
| 17 | `wp post update` | — | `nexusWpCommand` | no |
| 18 | `wp post delete` | — | `nexusWpCommand` | no |
| 19 | `wp user-list` | — | `nexusWpCommand` | no |
| 20 | `wp option-get` | — | `nexusWpCommand` | no |
| 21 | `wp health` | `wp_site_health` | `nexusWpCommand` | **no** — see below |
| 22 | `wp users` | — | `nexusSiteUsers` | n/a — reads the graph DB, not WP-CLI |

**Three of 22 reach an external host.** Not four: `wp health` is wired to the
MCP path, but `wp_site_health` is local-only and ignores `ssh_target`, so it
fails with `Site "undefined" not found.` — verified live. It fails *because*
MCP is available; with MCP down it falls back to `nexusWpCommand`, which has no
`external` branch either.

**`nexusWpCommand` has no `external` branch** (`graphql/resolvers.ts:1663`
tests `parsed.type === 'local'`, else the WPE path). An `ssh:` target falls into
the WPE path and dies with `Cannot read properties of undefined (reading
'split')` — a raw TypeError, not a diagnosis. Verified live with
`wp option-get ssh:<alias>@production siteurl`.

**Known defect, unrelated to external hosts:** `wp health` prints its error and
exits **0**. A failing command must not report success to a script.

---

## 3. MCP tools — how each is serviced

| Tool | Servicing | Operation | Local | WPE | External |
|---|---|---|---|---|---|
| `wp_core_version` | `resolveTransport` | `wpcli_read` | yes | yes | yes |
| `wp_option_get` | `resolveTransport` | `wpcli_read` | yes | yes | yes |
| `wp_plugin_list` | `resolveTransport` | `wpcli_read` | yes | yes | yes |
| `wp_theme_list` | `resolveTransport` | `wpcli_read` | yes | yes | yes |
| `wp_user_list` | `resolveTransport` | `wpcli_read` | yes | yes | yes |
| `wp_plugin_install` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_plugin_activate` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_plugin_deactivate` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_plugin_update` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_core_update` | `resolveTransport` | `wpcli` | yes | **dead** | yes |
| `wp_theme_activate` | `resolveTransport` | `wpcli` | yes | **dead** | yes |
| `wp_post_create` | `resolveTransport` | `wpcli` | yes | **dead** | yes |
| `wp_post_update` | `resolveTransport` | `wpcli` | yes | **dead** | yes |
| `wp_post_delete` | `resolveTransport` | `wpcli` | yes | **dead** | yes |
| `wp_eval` | `resolveTransport` | `wpcli` | yes | blocked | blocked |
| `wp_db_export` | `resolveSite` | — | yes | **no** | **no** |
| `wp_import_database` | `resolveSite` | — | yes | **no** | **no** |
| `wp_search_replace` | `resolveSite` | — | yes | **no** | **no** |
| `wp_site_health` | `resolveSite` | — | yes | **no** | **no** |

**"dead" on WPE** means the tool resolves a transport and then
`MCP_REMOTE_POLICY`'s whitelist refuses the command. Five tools, exactly as
`policy.ts:7` claims — verified by intersecting each tool's `<arg0> <arg1>`
against the whitelist.

**The four `resolveSite` tools have no remote path at all.** This is the more
interesting gap: `search-replace` against a remote host is domain migration, and
`db export` is how you get a backup off a VPS. Both are local-only *as tools*,
though the CLI reaches them on WPE through `nexusWpCommand`'s arbitrary argv.

**14 of 19 tools would work against an external host today.** They are not
reachable from the CLI (only three commands call `callMcpTool` with a working
tool) — but see §5.

---

## 4. Limits, by target and route

| Route | Command policy | Environment gate |
|---|---|---|
| **Local** (any surface) | none | exempt — `isGatedHost(host)` is `host !== 'local'` |
| **WPE via MCP tool** | `MCP_REMOTE_POLICY`: 14-command whitelist **and** blocklist (`eval`, `eval-file`, `shell`, `db query`, `db cli`) | `remoteOperationPermissions` |
| **WPE via `nexusWpCommand`** | inline blocklist only (`db query`, `eval`, `eval-file`, `shell`), `startsWith` matching, no whitelist | `remoteOperationPermissions` |
| **External via `resolveTransport`** | `EXTERNAL_REMOTE_POLICY`: blocklist only (`eval`, `eval-file`, `shell`, `db query`, `db cli`), **no whitelist** | `remoteOperationPermissions`, keyed on the **most restrictive** of the registered label and the target suffix |

### The environment gate is already unified

`DEFAULT_OPERATION_PERMISSIONS` (`mcp/utils/operation-permissions.ts:22-27`) is the
same table for WPE and external:

| operation | development | staging | production |
|---|---|---|---|
| `wpcli_read` | yes | yes | **yes** |
| `wpcli` | yes | yes | no |
| `push` | yes | yes | no |
| `delete` | no | no | no |

So on production, **reads are permitted and writes are refused** — for WPE and
external alike. The only difference is that external additionally takes the
most-restrictive of two environment labels.

**`wpeAllowedEnvironments` is dead code.** All four exported functions of
`mcp/utils/environment-filter.ts` have **zero callers** outside their own test
file. It was superseded by the granular permissions above — `types.ts:299` says
"Replaces wpeAllowedEnvironments", `schemas.ts:77` marks it "legacy — kept for
migration", and `operation-permissions.ts:133` is the one-way converter. Any
claim that it "blocks SSH/WP-CLI on production by default" is false: nothing
consults it.

### Two consequences worth stating plainly

- **External hosts already have the most permissive command policy of the
  three.** Spec 1 chose blocklist-only deliberately — applying MCP's whitelist
  would have reproduced the five dead tools on day one. The restriction on
  external hosts is not policy, it is plumbing.
- **A human at the CLI gets more on WPE than an agent does.** The
  `nexusWpCommand` route has no whitelist; the MCP route has a 14-command one.
  `policy.ts:7` calls the divergence "real and load-bearing"; Spec 0 preserved
  it deliberately.

### What migrating `nexusWpCommand` onto `resolveTransport` would cost

Scored every argv the CLI sends against `MCP_REMOTE_POLICY`'s whitelist. **Eight
of the 17** `nexusWpCommand` commands would stop working on WP Engine if
migrated as-is:

`theme activate` · `core update` · `db export` · `db import` · `search-replace` ·
`post create` · `post update` · `post delete`

The remaining nine (`plugin install/activate/deactivate/update`, `theme list`,
`core version`, `user list`, `option get`, `site health`) are whitelisted and
would survive. So the migration cannot adopt MCP's policy unchanged — it must
either pass a CLI-shaped policy through `resolveTransport`, or unify the two
policies deliberately.

---

## 5. The agent gap is discoverability, not capability

`ssh_target` is declared in **no** tool's `inputSchema`. But
`McpServer.ts:303` reads `params.arguments` and passes it through unmodified —
there is no JSON-Schema validation and no stripping of unknown keys. And
`resolveTransport` checks `args.ssh_target` before anything else.

So an agent that already knows the parameter name can drive **14 tools** against
an external host right now. What it cannot do is *discover* that the parameter
exists.

That makes declaring `ssh_target` (and `wp_path`) on the 15 `resolveTransport`
tools a small change that unlocks 14 operations for agents — a different and
much cheaper problem than the CLI's, which needs real plumbing.

---

## 6. Regenerating this

```bash
# CLI: which mutation/tool services each subcommand
python3 - <<'PY'
import re
src=open("src/cli/commands/wp.ts").read().split("\n")
groups={}; cmds=[]
for i,l in enumerate(src):
    m=re.search(r"^const (\w+) = new Command\('(\w+)'\)",l)
    if m: groups[m.group(1)]=m.group(2)
    m2=re.search(r"\.command\('([^ '<\[]+)",l)
    if m2:
        g=None
        for j in range(i,max(0,i-8),-1):
            mm=re.search(r"^(\w+Command)\b",src[j])
            if mm and mm.group(1) in groups: g=groups[mm.group(1)]; break
        cmds.append((i+1,g,m2.group(1)))
for k,(ln,g,name) in enumerate(cmds):
    end=cmds[k+1][0]-1 if k+1<len(cmds) else len(src)
    body="\n".join(src[ln-1:end])
    mcp=re.findall(r"callMcpTool\(\s*'([a-z_]+)'",body)
    gql=sorted(set(re.findall(r"(nexus[A-Z][A-Za-z]+)",body)))
    print(f"wp {g+' ' if g and g!='wp' else ''}{name:20} MCP:{','.join(mcp) or '-':18} GQL:{','.join(gql) or '-'}")
PY

# MCP tools: servicing + operation
grep -l . src/main/mcp/modules/wp-cli/*.ts | while read f; do
  n=$(grep -m1 -oE "name: 'wp_[a-z_]+'" "$f" | sed "s/name: '//;s/'//")
  [ -z "$n" ] && continue
  if grep -q resolveTransport "$f"; then
    printf "%-22s resolveTransport %s\n" "$n" "$(grep -m1 -oE "'(wpcli|wpcli_read)'\)" "$f" | tr -d "')")"
  else printf "%-22s LOCAL ONLY\n" "$n"; fi
done | sort
```
