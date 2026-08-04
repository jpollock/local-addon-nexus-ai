# CLI ↔ MCP Equivalence Inventory

**2026-08-04, branch `feat/non-wpe-host-support`.** Commissioned to answer: are the
CLI and MCP surfaces feature-equivalent, and where do they diverge?

**Short answer: they are two parallel implementations that share almost no code, so
equivalence is not something this codebase can currently hold.** The gaps are a
symptom; the structure is the cause.

---

## 1. What is solid

Counted from source, no inference:

| | count |
|---|---|
| CLI subcommands (`src/cli/commands/*.ts`) | **152** across 20 groups |
| MCP tool definitions (`src/main/mcp/modules/**`) | **187** across 14 modules |
| GraphQL resolver fields (`graphql/resolvers.ts`) | **133** |

### 1.1 The CLI barely uses MCP

| How a CLI command is serviced | count |
|---|---|
| via `callMcpTool` (the MCP path) | **4** |
| via a GraphQL mutation only | **135** |
| neither — local/other | 13 |

The "MCP path first, GraphQL fallback" architecture described in the project's own
notes exists in **four** places out of 152: `wp plugin list`, `wp plugin update`,
`wp core version`, `wp health`.

### 1.2 The GraphQL layer barely uses the tool registry

`registry.call(toolName, args, services, 'cli')` is the mechanism by which a
resolver can delegate to an MCP tool. It is used at **10 call sites covering 6
distinct tools**, against 133 resolver fields:

`nexus_site_status` · `nexus_site_refresh` · `nexus_fleet_refresh` ·
`local_wpe_pull` · `local_wpe_push` · `get_site_health`

**That is the root cause.** Roughly 6 of 133 resolvers share an implementation with
the MCP tool that does the same job. The other ~127 are a second implementation of
the same capability, with their own target resolution, their own policy checks and
their own permission-gate calls.

### 1.3 How MCP tools reach their targets

| servicing | tools |
|---|---|
| CAPI (WP Engine API) | 68 |
| `resolveSite` — local only | 54 |
| other | 30 |
| **`resolveTransport`** — the only path that reaches external hosts | **15** |
| `localServices` directly | 13 |
| graph DB | 7 |

Only 15 of 187 tools go through the transport abstraction Spec 0 built. That is why
external SSH hosts reach so little of the product: nearly everything else resolves
its target some other way.

---

## 2. What is not solid — and why I am not reporting it as fact

Automated CLI↔MCP correspondence by name matching is unreliable, and I can show it.
The matcher reported 12 CLI commands with "no plausible MCP counterpart". Spot-checking
by hand disproved **7 of the 12**:

| CLI command | matcher said | actually |
|---|---|---|
| `sites config-php` | no counterpart | `local_change_php_version` |
| `sites config-xdebug` | no counterpart | `local_toggle_xdebug` |
| `sites config-ssl` | no counterpart | `local_trust_ssl` |
| `fleet groups add/create/delete/remove` | no counterpart | `manage_site_group` (one tool covers all four) |

A 58% false-positive rate on the most important column makes the whole correspondence
table untrustworthy. Names diverge (`user-add` vs `create_account_user`), one tool
often covers several commands, and one command sometimes fans out to several tools.
Getting this right needs module-by-module human review, not fuzzy matching.

For the record, the matcher's raw output was: 84 CLI commands strongly matched, 56
weakly, 12 unmatched; and 99–112 of 187 MCP tools with no CLI counterpart. **Treat
those as a rough shape, not a finding.**

---

## 3. Why the correspondence table matters less than it looks

The instinct is to finish the matrix and close the gaps one by one. That is the wrong
move, for a reason the structural finding makes plain.

With ~6 of 133 resolvers sharing an implementation, CLI and MCP are not one product
with two front doors. They are two products that happen to agree on most things
today. A feature-parity audit produces a list that is correct on the day it is
written and starts drifting immediately, because nothing structural prevents the next
resolver from being written twice again.

The `wp` surface is the worked example, and every defect there is this shape:

- **Policy drift** — `MCP_REMOTE_POLICY` applies a 14-command whitelist; the GraphQL
  route applies a 4-item blocklist. A human at the CLI can do things an agent cannot,
  on the same install. Five MCP tools are permanently dead on WP Engine as a result.
- **Capability drift** — `resolveTransport` learned about external SSH hosts;
  `nexusWpCommand` did not. 3 of 22 `wp` commands reach an external host.
- **Gate drift** — `nexusWpCommand` re-implements the permission gate inline, calling
  `isOperationAllowed` at two separate sites with hand-derived arguments.
- **Silent failure** — an `ssh:` target through `nexusWpCommand` dies with
  `Cannot read properties of undefined (reading 'split')`, because nothing routes it.

None of these are missing features. They are all the same defect: the second
implementation didn't get the update.

---

## 4. Recommendation

**Make the GraphQL resolvers thin wrappers over the tool registry**, rather than
auditing 152×187 correspondences.

The mechanism already exists and is proven — `registry.call(tool, args, services,
'cli')`, used at 10 sites today. Generalising it means:

- equivalence holds **by construction**, not by audit — a resolver cannot lag its tool
  if it *is* its tool;
- policy, target resolution and the permission gate live in one place, so drift of the
  kind catalogued above becomes structurally impossible;
- external SSH support propagates for free, because `resolveTransport` already knows
  about it and everything would route through it;
- the ~127 duplicate resolver implementations shrink to argument marshalling.

This is a large change and it should be staged. The `wp` surface is the right first
slice: it has the worked analysis (`docs/wp-cli-surface-matrix.md`), the smallest
module (19 tools / 22 commands), and the sharpest existing pain. It also proves or
disproves the approach cheaply before the other 13 modules commit to it.

**What must be measured before each later slice**, because the `wp` slice showed
reasoning is not enough — four assumptions were wrong there, including a documented
"protection" (`wpeAllowedEnvironments`) that turned out to be dead code with zero
callers.

---

## 5. Reproducing this

```bash
# CLI commands and how each is serviced
python3 - <<'PY'
import re,glob,os
for f in sorted(glob.glob("src/cli/commands/*.ts")):
    top=os.path.basename(f)[:-3]; src=open(f).read().split("\n")
    groups={}; cmds=[]
    for i,l in enumerate(src):
        m=re.search(r"^const (\w+) = new Command\('([\w-]+)'\)",l)
        if m: groups[m.group(1)]=m.group(2)
        m2=re.search(r"\.command\('([^ '<\[]+)",l)
        if m2:
            g=None
            for j in range(i,max(0,i-8),-1):
                mm=re.search(r"^(\w+Command|\w+Cmd)\b",src[j])
                if mm and mm.group(1) in groups: g=groups[mm.group(1)]; break
            cmds.append((i+1,g,m2.group(1)))
    for k,(ln,g,name) in enumerate(cmds):
        end=cmds[k+1][0]-1 if k+1<len(cmds) else len(src)
        body="\n".join(src[ln-1:end])
        mcp=sorted(set(re.findall(r"callMcpTool\(\s*'([a-z_0-9]+)'",body)))
        gql=sorted(set(re.findall(r"\b(nexus[A-Z][A-Za-z]+)\b",body)))
        print(f"{top}\t{g or ''}\t{name}\t{','.join(mcp) or '-'}\t{','.join(gql) or '-'}")
PY

# MCP tools and how each resolves its target
python3 - <<'PY'
import re,glob,os
for f in glob.glob("src/main/mcp/modules/**/*.ts",recursive=True):
    if os.path.basename(f) in ("index.ts","preflight.ts","types.ts"): continue
    s=open(f).read(); mod=os.path.basename(os.path.dirname(f))
    for m in re.finditer(r"definition:\s*\{\s*name:\s*'([a-z_0-9]+)'",s):
        seg=s[m.start():m.start()+6000]
        svc=("resolveTransport" if "resolveTransport" in seg else
             "resolveSite(local)" if "resolveSite" in seg else
             "CAPI" if "capi" in seg.lower() else
             "graphDB" if "graphService" in seg else
             "localServices" if "localServices" in seg else "other")
        print(f"{mod}\t{m.group(1)}\t{svc}")
PY

# The structural numbers
grep -rc "registry\.call(" src/main/graphql/          # delegating resolvers
grep -c  "callMcpTool(" src/cli/commands/*.ts | grep -v ':0'   # CLI using MCP
```
