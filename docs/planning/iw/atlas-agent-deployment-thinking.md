# Atlas Agent Deployment — Thinking-in-Progress

**Status:** Parked — resume after other IW integration work is complete.
**Related:** Q5 (done), Q8 (open), Phase 4 (not started), Agent Platform Spec 03 (not started)
**Last updated:** 2026-07-27

---

## What we proved (Q5 spike)

Deployed `nexus-hello-agent` (minimal Node.js HTTP server) to Atlas.
Live at `htfqiga1ef8zmnpi7ip352h4c.js.wpenginepowered.com`.

**Confirmed runtime contract:**

| | |
|---|---|
| Auth | HTTP Basic — `ATLAS_API_USER:ATLAS_API_PASSWORD` (portal → Users → API Access) |
| Three-step deploy | create app → create env → upload zip |
| Zip structure | Files inside a named folder at zip root |
| Node.js | v20.20.2 LTS (pin via `"engines": {"node": "20"}`) — defaults to v24 with `>=18` |
| npm | v10.8.2 |
| Build step | `npm run build` — **required**. Missing = deploy fails. |
| Start command | `npm start` → reads `package.json scripts.start` |
| PORT | **`8080`** injected as `process.env.PORT`. App must listen on this. |
| NODE_ENV | Not set by default. Set via `shellVariables`. |
| URL | `{hash}.js.wpenginepowered.com` (hash-based, not app-name) |
| `wpEnvironment` | Required — must be a real WP install in the account. **Expected to become optional.** |
| Env vars / secrets | Via `shellVariables: [{key, value}]` at create-env, or portal post-deploy. Never in zip. |
| App-already-exists | Returns HTTP 400 `APP_ALREADY_EXISTS` (not 409). Handle both in re-deploy scripts. |
| package-lock.json | Recommended (Atlas warns without it) |

**Deploy script:** `/Users/jeremy.pollock/development/wpengine/wpe-internal-walt/scripts/deploy-atlas.mjs` (adapt from Walt's working script)

**Re-deploy command (env already exists):**
```
ATLAS_API_USER=... ATLAS_API_PASSWORD=... node deploy.mjs --account w7579 --env-id 45f6f177-ef59-a5e0-1885-08a733921e46
```

---

## The gap: local Nexus agent → Atlas Nexus agent

A locally-running Nexus agent has infrastructure that doesn't exist on Atlas:

| Capability | Local | Atlas |
|---|---|---|
| MCP transport | stdio | Needs MCP-over-HTTP (SSE) — remote MCP server model |
| Site access | WP-CLI via Local, filesystem, graph.db, IPC | None — cloud equivalents needed |
| WPE site access | Local WP-CLI (if site is running) | SSH + remote WP-CLI via CAPI |
| Power-connected sites | Power API + KB | Same — direct Power API calls |
| Local dev sites | Full access | ❌ Not reachable |
| Credentials | `ctx.credentials` → Local KeyVault | `process.env.*` only |
| State / persistence | Local graph.db, index registry, site metadata cache | No persistent disk assumed |
| Multi-site context | All Local sites visible by default | Must be parameterized or discovered via CAPI |
| Invocation | User-triggered via Nexus UI/CLI | HTTP request / webhook / cron — TBD |

---

## Tool portability map

| Local tool | Atlas equivalent | Portable? |
|---|---|---|
| `wp_eval` / WP-CLI | Remote WP-CLI over SSH (CAPI provides SSH access) | ⚠ needs SSH key setup |
| `fleet_search` / `search_site_content` | Power KB search API | ✅ (if KB synced) |
| `get_site_structure` | CAPI + remote WP-CLI | ⚠ partial |
| `iw_search_kb` | Same Power API call | ✅ direct |
| `wpe_get_installs` / CAPI reads | Same CAPI | ✅ direct |
| `read_file` / filesystem tools | ❌ | ❌ not applicable |
| `local_start_site` / `local_stop_site` | ❌ | ❌ meaningless |
| `fleet_sql` (graph.db) | ❌ local state | ❌ needs rethink |
| `iw_list_kb_collections` | Same Power API | ✅ direct |

---

## Open questions (parking lot)

### Architecture

**Q-A: Invocation model**
Is an Atlas agent a persistent HTTP server (one per deployment) or request-scoped (serverless)? This determines cost, latency, and state model. Atlas appears to be persistent (long-running Node process), not serverless — but we haven't confirmed this.

**Q-B: Topology — per agent type, per account, or per site?**
A fleet agent serving all sites of an account is very different from a per-site agent. Billing, permissions, and credential scope all depend on this.
- Per-agent-type: one Atlas app, serves multiple accounts/sites via request params
- Per-account: one Atlas app per WPE account
- Per-site: one Atlas app per WP install

**Q-C: MCP-over-HTTP transport**
Atlas agent becomes a *remote MCP server*. What transport does it use? MCP-over-SSE is the current spec for remote servers. Does the Nexus runtime ship this, or does each agent author it?

**Q-D: Authentication — two directions**
1. Calling client → Atlas agent: how does the client authenticate? Bearer token? WPE OAuth?
2. Atlas agent → WPE infrastructure (CAPI, Power API, SSH): env vars, but how are per-site SSH keys injected?

**Q-E: Nexus runtime shim**
Does Agent Platform Spec 01/02 ship a runtime that handles MCP-over-HTTP plumbing on Atlas, or does each agent author that themselves? A runtime shim would make atlas-deployed agents look identical to local ones from the tool-author's perspective.

### Data / state

**Q-F: State model**
Which Nexus tools depend on local state (graph.db, index registry)? For Atlas, those tools either:
(a) become stateless (re-derive from CAPI/Power each call), or
(b) use external storage (Postgres? Atlas-provided DB?), or
(c) are simply not available on Atlas

**Q-G: Multi-site identity**
Locally, the agent runtime resolves `site` → Local site object. On Atlas, what is a "site" reference? A WPE install ID? A domain? How does the agent know which sites it has access to at runtime?

### Deployment UX

**Q-H: `wpEnvironment` constraint**
Currently required — must be a real WP install in the account. WP Engine expects this to become optional for pure Node.js apps. Nexus Publisher (Spec 03) should track this and expose it as an optional field, defaulting to the primary account install if the field becomes optional.

**Q-I: Agent update / redeploy flow**
How does a user update an agent running on Atlas? Nexus Publisher would need a `nexus agent deploy --update` command that re-zips and re-uploads to the existing env ID. The env ID needs to be persisted per-agent.

**Q-J: Logs / observability**
Atlas portal shows build logs. For runtime logs, what's the story? Is there a streaming log endpoint? How does an agent author debug a running Atlas agent?

---

## Thinking so far

The cleanest mental model: **an Atlas-deployed Nexus agent is a remote MCP server**.

- It exposes the same tool surface as the local agent
- But execution happens server-side, calling WPE cloud APIs (CAPI, Power, SSH) instead of Local's infrastructure
- The "Nexus runtime" on Atlas handles MCP-over-HTTP plumbing, credential injection, and CAPI client setup
- Tools that are inherently local (`local_start_site`, filesystem) are simply not registered on the Atlas runtime
- Tools that work the same way cloud-side (`iw_search_kb`, `wpe_get_installs`) need no changes

The hardest unsolved problem: **multi-site tool execution on Atlas without Local's unified proxy layer**. Locally, `wp_eval(site='myloop')` resolves through Local's WP-CLI manager. On Atlas, that same call would need to SSH into the WPE install and run WP-CLI remotely — requiring CAPI auth + SSH key management per install.

---

## What to do before resuming this

Phase 4 of the IW plan (this is the IW-side contribution to Spec 03) requires Q5 and Q8. Q5 is now done. Q8 (agent secrets across Local→Atlas) should be spiked next as a complement:
- Q8 spike: verify Atlas env secrets are available at runtime via `process.env`
- Add a `WPE_KEY` env var to the hello-agent and confirm it reads `process.env.WPE_KEY`
- This is a 15-minute follow-on to the Q5 spike using the existing env ID

Then the outputs (Q5 contract + Q8 secrets model + this thinking doc) feed Spec 03.
