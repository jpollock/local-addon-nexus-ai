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

`MCP-first` means the command tries `callMcpTool` first. For plugin list,
plugin update and core version this silently falls back to GraphQL
(`nexusWpCommand`) if the MCP server is unreachable; `wp health` has no
fallback and errors out instead — see below. `--json` **skips the MCP path by
design** (`wp.ts:30` — "MCP returns markdown, not structured data").

| # | Command | MCP tool tried | GraphQL path | Reaches external? |
|---|---|---|---|---|
| 1 | `wp plugin list` | `wp_plugin_list` | `nexusWpPluginList` | **yes** (MCP-first) |
| 2 | `wp plugin install` | — | `nexusWpCommand` | **yes** |
| 3 | `wp plugin activate` | — | `nexusWpCommand` | **yes** |
| 4 | `wp plugin deactivate` | — | `nexusWpCommand` | **yes** |
| 5 | `wp plugin update` | `wp_plugin_update` | `nexusWpCommand` | **yes** (MCP-first) |
| 6 | `wp theme list` | — | `nexusWpCommand` | **yes** |
| 7 | `wp theme activate` | — | `nexusWpCommand` | **yes** |
| 8 | `wp core version` | `wp_core_version` | `nexusWpCommand` | **yes** (MCP-first) |
| 9 | `wp core update` | — | `nexusWpCommand` | **yes** |
| 10 | `wp db export` | — | `nexusWpCommand` | **yes** |
| 11 | `wp db import` | — | `nexusWpCommand` | **yes** |
| 12 | `wp db scan` | — | `nexusDbScan` | no — db-scanner is local-only by design |
| 13 | `wp db clean` | — | `nexusDbClean` | no — same |
| 14 | `wp db report` | — | `nexusDbReport` | no — same |
| 15 | `wp db search-replace` | — | `nexusWpCommand` | **yes** |
| 16 | `wp post create` | — | `nexusWpCommand` | **yes** |
| 17 | `wp post update` | — | `nexusWpCommand` | **yes** |
| 18 | `wp post delete` | — | `nexusWpCommand` | **yes** |
| 19 | `wp user-list` | — | `nexusWpCommand` | **yes** |
| 20 | `wp option-get` | — | `nexusWpCommand` | **yes** |
| 21 | `wp health` | `wp_site_health` | none — no fallback | **yes** (MCP-only) |
| 22 | `wp users` | — | `nexusSiteUsers` | n/a — reads the graph DB, not WP-CLI |

**18 of 22 reach an external host** — every command routed through `nexusWpCommand`,
which now delegates to `resolveTransport`. Four are MCP-first (plugin list, plugin
update, core version, health), trying the MCP tool first. **Only three of them fall
back to `nexusWpCommand`** when MCP is unreachable (plugin list, plugin update, core
version). `wp health` does not: there is no WP-CLI/GraphQL command that replicates
`wp_site_health`, so its `action()` prints "The wp health command requires the MCP
server to be running" and exits 1 if the MCP call throws or errors — verified against
`src/cli/commands/wp.ts`.

**`wp health` used to fail with `Site "undefined" not found.`** because `wp_site_health`
was local-only. It was ported onto `resolveTransport` in this change and now works on
all three targets (via `wp_site_health`, not via a GraphQL fallback).

**The 4 that do not work:**
- `db scan`, `db clean`, `db report` — local-only by design (separate resolvers)
- `users` — reads the graph DB, not WP-CLI

**Previously-known defect, now fixed:** `wp health` used to print its error and exit
**0**. It now exits **1** on a failed or unreachable MCP call
(`src/cli/commands/wp.ts`'s `health` action checks `isError` / catches and calls
`process.exit(1)`).

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
| `wp_core_update` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_theme_activate` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_post_create` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_post_update` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_post_delete` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_search_replace` | `resolveTransport` | `wpcli` | yes | yes | yes |
| `wp_site_health` | `resolveTransport` | `wpcli_read` | yes | yes | yes |
| `wp_eval` | `resolveTransport` | `wpcli` | yes | blocked | blocked |
| `wp_db_export` | `resolveSite` | — | yes | **no** | **no** |
| `wp_import_database` | `resolveSite` | — | yes | **no** | **no** |

**All `resolveTransport` tools now work on all three targets.** The five tools
previously "dead" on WPE (`core_update`, `theme_activate`, `post_create/update/delete`)
now work because `REMOTE_POLICY` is blocklist-only — the whitelist that refused
them is gone.

**`wp_search_replace` and `wp_site_health` were ported** onto `resolveTransport`
and now reach WPE and external hosts. Both were `resolveSite` (local-only) before.

**The two `resolveSite` tools remain local-only.** `db export` and `import database`
have no remote path: `db_export` calls Local's own `dumpDatabase` API (not WP-CLI),
and `import_database` reads a file from the machine running Nexus, then passes that
local path to WP-CLI — which does not exist on the remote host. The CLI reaches
them on WPE through `nexusWpCommand`'s arbitrary argv, but the tools themselves
cannot.

**17 of 19 tools work against an external host.** All are reachable from the CLI
through either MCP-first commands or `nexusWpCommand`.

---

## 4. Limits, by target and route

| Route | Command policy | Environment gate |
|---|---|---|
| **Local** (any surface) | none | exempt — `isGatedHost(host)` is `host !== 'local'` |
| **Remote** (WPE or external, any surface) | `REMOTE_POLICY`: blocklist only (`eval`, `eval-file`, `shell`, `db query`, `db cli`), **no whitelist** | `remoteOperationPermissions`, keyed on environment label from install cache (WPE) or the **most restrictive** of the registered label and the target suffix (external) |

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

**`wp db export` classifies as `wpcli`, not `wpcli_read`.** It only reads the
database, but it writes the dump to disk: with no path argument WP-CLI drops
`<dbname>-<date>.sql` into the SSH login directory, which is the web root on
many shared hosts and VPS layouts — every user hash and every option row at a
guessable URL. It was in `WPCLI_READ_COMMANDS` and is not any more, so it is
refused on production like any other write.

**`wpeAllowedEnvironments` is dead code.** All four exported functions of
`mcp/utils/environment-filter.ts` have **zero callers** outside their own test
file. It was superseded by the granular permissions above — `types.ts:299` says
"Replaces wpeAllowedEnvironments", `schemas.ts:77` marks it "legacy — kept for
migration", and `operation-permissions.ts:133` is the one-way converter. Any
claim that it "blocks SSH/WP-CLI on production by default" is false: nothing
consults it.

### The unified policy

**All remote targets now share one policy** (`REMOTE_POLICY`, `transport/policy.ts`):
blocklist-only, no whitelist. Five commands are blocked everywhere: `eval`,
`eval-file`, `shell`, `db query`, `db cli`.

This was three separate policies before:
- **MCP:** 14-command whitelist + blocklist (five tools were "dead" on WPE)
- **GraphQL (`nexusWpCommand`):** inline blocklist only, no whitelist
- **External:** blocklist only, no whitelist

The unification chose blocklist-only for two measured reasons (`policy.ts:6-19`):
1. Adopting the whitelist would break 8 of the 17 CLI commands on WP Engine
   (a capability regression for existing users)
2. The whitelist protected less than it appeared: no MCP tool accepts arbitrary
   command arrays — every tool emits a fixed command shape, and the one free-form
   tool (`wp_eval`) is in the blocklist

So removing the whitelist grants agents exactly five capabilities they lacked
before (`core_update`, `theme_activate`, `post_create/update/delete`) — capabilities
a human at the CLI already had.

**What protects production is the permission gate**, not the command policy.
`wpcli` (writes) and `push` are refused on production; `delete` is refused
everywhere (`DEFAULT_OPERATION_PERMISSIONS`, `mcp/utils/operation-permissions.ts`).

---

## 5. Summary — surface is unified

**CLI:** 18 of 22 commands reach an external host. `nexusWpCommand` delegates to
`resolveTransport`, so every command routed through it works on Local, WPE and
external hosts. Four do not: three are local-only by design (db scanner), and
one reads the graph DB (users).

**MCP tools:** 17 of 19 work on all three targets. Two are local-only (db export,
import database) because they depend on local filesystem state or Local's own
APIs, not WP-CLI. All `resolveTransport` tools declare `ssh_target` and `wp_path`
in their `inputSchema`, so agents can discover them.

**One policy, three targets.** `REMOTE_POLICY` (blocklist-only) applies to WPE
and external hosts alike. The environment permission gate is the same table for
both: writes are refused on production, reads are permitted everywhere.

**The two surfaces diverged before.** A human at the CLI could run arbitrary
WP-CLI on WPE (subject to a 4-item blocklist); an agent could run only the 14
whitelisted commands, and five tools were unreachable. That divergence is gone:
both surfaces share `resolveTransport`, and the blocklist is the only policy.

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
