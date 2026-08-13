# Nexus as Local's Native Fleet Workspace — V1

**Status:** Design
**Date:** 2026-08-13
**Components:** `local-addon-nexus-ai`, `flywheel-local`

## Problem

Local's primary object is the local site. `sites.json` is a dictionary of sites
that exist on this machine, and a remote is an attribute of one of them —
`site.hostConnections[].remoteSiteId`. A site you have not pulled does not
exist. The app opens onto a list of working copies.

That is the wrong primary object for where the product is going. The Q326
strategy asserts the desktop should be the customer's primary surface for the
whole content lifecycle, across every site they are responsible for. Ten North
Star sessions ranked fleet health assessment the single most valuable capability
(six of the nine who ranked put it first). Nobody's fleet is "the sites on my
laptop."

The second problem is that the capability to answer fleet questions already
exists, in the wrong place and the wrong process. `local-addon-nexus-ai` has a
graph spanning local sites, WP Engine installs and external hosts; a semantic
index over site content; a GSC-backed content analysis agent; over 180 MCP tools;
and an agent runtime with capability scoping. It runs as a third-party add-on inside
Local's Electron main process, which means a fleet-wide search freezes the entire
Local UI (roadmap `T-PERF-THREAD`). The highest-value V1 interaction is exactly
the workload that triggers that freeze.

Third, the two systems cannot reliably agree on what a site *is*. Local stores a
UUID in `hostConnections[].remoteSiteId`; Nexus stores the CAPI install slug in
`sites.remote_install_id`. The resolution between them silently fails, so
local↔WPE joins produce nothing rather than an error. Today that is a nuisance.
Under a model where "www.jeremy.com, which may or may not be on my machine" is
the primary object, that join *is* the product.

## Decisions already taken

These were settled before this document and are treated as given:

| Decision | Value |
|---|---|
| Primary fleet source | WP Engine installs. Local sites become sandboxes. |
| External SSH hosts | Out of scope for V1. The code stays; the UI does not surface it. |
| Sandbox implementation | A normal Local site, provisioned through Local's existing path. |
| Canonical fleet store | Nexus's `graph.db`. |
| Paid-tier identity | WP Engine account. |
| Ownership | Nexus moves to WP Engine ownership, or into Local proper. Not resolved; V1 avoids depending on the answer. |

## Reframe

V1 is not "port an add-on." It is one loop over the fleet, with two lenses on it:

```
   SEE  ──────>  UNDERSTAND  ──────>  ACT  ──────>  VERIFY
   the fleet     what's wrong        remotely, or   re-assess and
   as one list   and why it          in a sandbox   show what moved
                 matters             and push
```

**Lens one — site health.** WPE configuration, PHP and core versions, plugin
vulnerabilities, cache misconfiguration, SSL and domain state, backup coverage,
drift across installs. Reads CAPI, remote WP-CLI and the sentinel scanner.

**Lens two — content health.** Semantic overlap, traffic decay, cannibalisation,
and contradiction against your own published library. Reads the content index
and Google Search Console.

Both lenses are the same operation — *assess the fleet from the customer's own
data, rank what is wrong, recommend, act through the sandbox when the blast
radius warrants it.* The loop is the product; the lenses are workloads on it.

### Why these two lenses and not others

Site health is ranked first by the research and is the one place where being the
host is a structural advantage. Session 1: *"that is what most people fail at...
for instance, enabling the WP Engine cache. I can't tell you how often I've seen
that not properly implemented."* No uptime monitor can see that.

Content health is the strategy's core assertion, and WP Engine's own content team
has independently specified the same pipeline (`Content Automation Pipeline`,
tabs 1–4). Their Steps 2–4 — Smart Search semantic audit, GSC performance audit,
update-versus-new-versus-prune routing — map onto capability Nexus already has.
Their pipeline runs against one site; ours runs against a fleet, which is a
strictly harder and more valuable question.

### The line that keeps reappearing

Three independent decisions land on the same boundary:

- Free versus paid: compute on the user's machine versus a machine that never
  sleeps.
- Differentiated health assessment versus commodity uptime alerting.
- Fleet-native content intelligence versus third-party market intelligence.

In every case the boundary is **what can be computed from the customer's own
fleet, versus what requires outside data or always-on infrastructure.** V1 takes
everything on the near side of that line.

One correction to the strategy document's stated AEO risk (*"WP Engine has
infrastructure-layer visibility but not AI-side data"*): the `log-processor`
agent streams raw WPE Apache access logs, and `seo-insights` has
`analyze_ai_crawl_health`, `analyze_404_demand` and `analyze_referral_sources`
built on them. Which AI agents actually crawled a site, how often, and what they
404'd on is AI-side data that Ahrefs and SEMRush cannot obtain. It is observed
behaviour on infrastructure we own rather than inferred SERP position. That is
the defensible AEO angle and it is already half-built.

## Design

### 1. Fleet and site identity

**Grain.** The list shows WPE **installs**, grouped by WPE **site** — CAPI's own
grouping of production / staging / development. We inherit the upstream shape
rather than inventing one. `WPESyncService` already syncs installs into
`graph.db` with `source='wpe'` on startup and hourly, so the data exists today.

Local-only sites (`source='local'` with no link) remain in the list as their own
group. This costs almost nothing and matters commercially: Local's install base
is much larger than WP Engine's customer base, so a WPE-installs-only list would
open empty for most users. Their empty state is "connect your WP Engine account,"
which is the conversion path.

**Identity.** The canonical identifier is the CAPI install id — server-authoritative
and stable, unlike anything held on the client.

A local sandbox attaches to an install through an explicit link record. New table
in `graph.db`:

```sql
CREATE TABLE site_links (
  local_site_id     TEXT NOT NULL,
  wpe_install_id    TEXT NOT NULL,
  wpe_install_name  TEXT NOT NULL,
  link_source       TEXT NOT NULL,   -- 'hostConnection' | 'user' | 'inferred'
  verified_at       INTEGER,
  PRIMARY KEY (local_site_id, wpe_install_id)
);
CREATE INDEX idx_site_links_install ON site_links(wpe_install_id);
```

This replaces the implicit UUID lookup rather than repairing it. Inference will
keep failing — renamed installs, restored backups, cloned sites — and a silently
wrong join is worse than a missing one. So the link records where it came from,
when it was last confirmed, and **is user-correctable**. The reconciliation UI is
a required surface, not a fallback path.

**Migration.** On first run after upgrade, resolve every existing local site's
`hostConnections` against CAPI and write the results into `site_links` with
`link_source='hostConnection'`. Anything unresolved surfaces in the
reconciliation UI as "is this the same site?", which doubles as the manual link
path for sites that were never Connect-linked.

**Provenance.** Every fleet row carries where its data came from and how old it
is, using the four-level ladder already implemented in
`src/main/mcp/modules/composite/plugin-audit.ts`:

| Level | Meaning |
|---|---|
| live | WP-CLI executed against the install just now |
| configured cache | last known good values from the digital twin |
| index snapshot | derived from the content index |
| no data | never successfully reached |

Nothing stale is ever rendered as current. This is a hard rule, not a
preference — the loop's credibility depends on it.

**Capability is derived, never stored.** Given an install, whether a sandbox is
linked, and whether that sandbox is running, compute the available actions:

```
read anything                    → always (live or cached)
content edits                    → remote WP-CLI
plugin / config changes          → remote WP-CLI, higher tier
code changes                     → sandbox required
structural changes               → sandbox required
```

The sandbox prompt fires at that boundary. `src/main/mcp/safety.ts` already
computes the blast-radius half of the decision, so the prompt is derived rather
than hand-authored per action.

**What this does to Local's data model: nothing.** `graph.db` becomes canonical
for the *fleet*. `sites.json` remains authoritative for *local sandboxes* —
Local still owns provisioning, ports and services. They own different things, so
there is no two-masters problem, and we avoid touching Local's core while the
ownership question is open.

### 2. Process architecture — `nexusd`

The extraction is justified on quality grounds, not future-proofing. V1's central
interaction is a fleet-wide assessment across hundreds of installs; today that
work runs on Local's main thread and freezes the UI. Worker threads inside
Electron would be a partial, throwaway version of the same fix.

**What moves into `nexusd`** — everything that does not need Local:

- `GraphService` / `graph.db`, `SqliteVecStore` / `vectors.db`
- `EmbeddingService` and the ONNX runtime
- `ContentPipeline`, extractors, `RemoteContentExtractor`
- `WPESyncService` and CAPI access
- `WpeSshTransport`, `src/main/transport/policy.ts`
- `ToolRegistry` and all tool modules
- The agent runtime (`AgentRegistry`, `AgentRunner`, `AgentScheduler`,
  `DaemonManager`, `AgentEventBus`)
- `McpServer`, `AiProxyServer`, `AIGatewayRoutes`
- Health and scan engines, the sentinel scanner, `SmartSearchHandler`
- `InboxStore`, telemetry, logging, audit

**What stays in Local**, exposed as a `LocalHostAdapter` — the subset of
`LocalServicesBridge` that genuinely touches Local's own services:

- Site provisioning and lifecycle (create, delete, clone, start, stop, restart)
- Local WP-CLI execution (`LocalTransport`)
- WPE pull and push (MagicSync — deeply Electron-coupled, stays where it is)
- PHP version changes, SSL trust, blueprints

`resolveTransport()` in `src/main/transport/resolve.ts` already draws this line
between `LocalTransport` and the remote transports. We are formalising a boundary
the code has.

**Channels.**

- `nexusd` runs as a child process of Local's main process, spawned at app start
  and terminated on quit. It has no independent lifetime in V1.
- The desktop UI talks to `nexusd` over **loopback HTTP with a bearer token**,
  reusing the shape `McpServer` already implements (127.0.0.1 binding, port scan
  from 10800, `isLocalHostHeader` anti-rebinding guard, connection info written
  0600). The CLI and third-party MCP clients share that endpoint.
- `nexusd` calls back into Local for host operations over **Node child-process
  IPC**. No second port, no auth surface.

**Credentials.** `src/main/security/KeyVault.ts` encrypts secrets with Electron
`safeStorage`, which `nexusd` will not have. For V1, **Local unlocks credentials
and injects them into `nexusd` at spawn; `nexusd` holds them in memory only and
never writes them to disk.** Consequences worth stating plainly: closing Local
revokes the daemon's ability to act, which is a reasonable V1 safety property,
and the paid tier will need its own secret store — that is deliberately deferred.

**The payoff.** Paid becomes a *deployment* of the same binary running WPE-side,
without the Local host adapter, rather than a second implementation. That is the
entire reason to do the extraction now rather than later.

### 3. The sandbox loop

A sandbox is a normal Local site, provisioned through Local's existing path and
linked to an install via `site_links`.

```
  install ──[risky action requested]──> "make this change in a sandbox?"
     │
     ├─ no sandbox linked  → provision + pull  ─┐
     └─ sandbox linked     → refresh or reuse  ─┤
                                                ▼
                                         change applied
                                                ▼
                                        diff against install
                                                ▼
                                       human approves diff
                                                ▼
                                          push + verify
```

Two things move onto the critical path because of this:

**`T-BACKUP-GATE` is now a prerequisite, not a roadmap item.** `local_wpe_pull`
currently overwrites a local site at Tier 2 with no gate at all. Once pulling is
a routine automated step rather than a deliberate user action, that is data loss.
The gate must be a real precondition, not the advisory string it is today.

**Divergence handling.** Production can move while the sandbox is open, which
makes push destructive. MagicSync already does manifest diffing, so the machinery
exists; V1 must re-diff at push time and refuse silently-conflicting pushes
rather than trusting the diff computed at pull time.

**Lifecycle.** V1 keeps sandboxes after push, visible as attachments on their
install, with an explicit discard action. Ephemeral sandboxes are a better answer
and are deferred — the accumulation problem is real but is a V2 concern.

### 4. Trust posture

Five commitments, each traceable to a research finding, each cheap:

**Recommend by default; act on explicit approval.** Session 6: *"I would never
want to give an AI agent code access, but I would love for it to have its
insights."* Session 7 had reservations about action and confidence in analysis.
Acting is opt-in per site, not a global toggle.

**Not chat-only.** Session 9's example is decisive: *"if I say update the H2
title to XYZ, and there's two H2s on a page... whereas if I can click a thing and
just make an edit, that's easier."* Every tool is already invocable from the UI
through `ToolRegistry.call()`, so this is a design commitment rather than a
build.

**Findings go where people already work.** Webhook egress to Slack, ClickUp and
PagerDuty. Session 6 explicitly does not want another dashboard to log into;
Session 7 already routes through UptimeRobot → PagerDuty → Slack.

**Second-model verification.** Sessions 1 and 2 independently asked to check the
AI with another AI. Nexus is already multi-provider; exposing "verify this
recommendation with a different model" is nearly free and buys disproportionate
trust.

**Explain the why.** Session 7 asked for the AI to explain the value of applying
a recommendation, for less advanced users. Findings carry rationale and expected
impact, not just a severity.

### 5. Free and paid

**Free** — desktop plus `nexusd` on the user's machine. Both lenses, the sandbox
loop, the full tool surface, agents running opportunistically while the machine
is awake. Marginal cost to WP Engine is approximately zero. Inference defaults to
bring-your-own-key or Ollama; included inference is a later decision.

**Paid** (not V1) — the always-on deployment. 24/7 monitoring, alerting that
reaches a phone overnight, shared visibility, client approval flows. Attaches to
a WP Engine account. Every one of these needs something awake when the laptop is
shut, and every one carries genuine marginal cost.

The free tier is not a crippled demo; it is most of the product. The paywall sits
on continuity, not capability.

## Sequencing

This is more than one implementation plan. It decomposes into four tracks, two of
which can run in parallel because they touch disjoint code.

**Track 1 — Identity and provenance.** `site_links`, the CAPI resolution
migration, the reconciliation UI, and provenance on every fleet row. Deliverable:
the fleet list is correct and honest about what it knows. Depends on nothing;
everything else depends on it.

**Track 2 — `nexusd` extraction.** The process split, loopback HTTP channel,
`LocalHostAdapter`, credential injection, supervision and shutdown. Deliverable:
identical functionality with no UI freeze during a fleet assessment. Touches
almost none of Track 1's code, so the two can proceed together. The two riskiest
parts are credential injection (replacing an Electron-only `safeStorage`
dependency) and re-pointing the 20 Playwright suites that live in
`flywheel-local`.

**Track 3 — Backup gate and the sandbox loop.** `T-BACKUP-GATE` first, as a real
precondition, then provision-or-reuse, pull, diff, approve, push, re-verify, and
push-time re-diff for divergence. Depends on Track 1 for the install↔sandbox
link. **The gate must land before pulling becomes an automated step**, not
alongside it.

**Track 4 — The two lenses.** Health and content assessment producing ranked
findings with rationale, plus webhook egress and second-model verification.
Depends on Track 1 for identity and benefits from Track 2 for responsiveness, but
the assessment logic itself is largely assembly of existing tools.

## Out of scope for V1

Each of these is *unblocked* by this architecture rather than complicated by it:

- **Always-on / the paid tier.** Needs WPE-side deployment, a server-side secret
  store, and billing.
- **Actor model, multi-user, collaboration.** Every session raised permissions —
  developer versus contributor roles, restricted client access, per-agent rules —
  and it is the single largest gap in Nexus today, which has excellent *tool*
  authorization and no concept of *who is asking*. It needs the WP Engine account
  identity work, and Talissa's ICP research is unfinished. Deferring it is a
  sequencing choice, not a judgement that it is unimportant.
- **Web and mobile surfaces.** Three sessions preferred web, three wanted mobile
  alerts. Held until the marketer readout, since surface priority depends on ICP.
- **External SSH hosts.** Code remains; UI does not surface it.
- **Market intelligence.** Ahrefs, Google AI Overview scraping, YouTube chapter
  extraction, organic SERP scraping. Fragile, against Google's terms in the
  scraping cases, competing where incumbents are strong, and on the far side of
  the own-data line.
- **Draft generation and the Phase 2 QA suite.** The content team's contradiction
  audit and internal-link networker sit on substrate we have and are the natural
  first additions after V1; the code-linting, Codex-validation, brand-style and
  CTA checks are not.

## Risks

**The fleet is WPE-only, so the free tier's reach is bounded by WP Engine account
ownership, not Local installs.** Mitigated by keeping local-only sites in the
list, but it does weaken the "free for all Local users" distribution argument and
should be watched.

**The ICP is unvalidated.** Talissa is ten sessions in and has not yet spoken to
a marketer, while the Q326 strategy is premised on the expanding marketer. The
strongest adopters so far are solo agency owners, whom the strategy does not
centre. This design is robust to that — persistent service, derived capability
and provenance are required under every reading — but surface and workload
priority are not.

**Nexus ownership is unresolved.** The repository is under a personal GitHub
account, published to `@local-labs-jpollock`, with 1,276 commits never pushed to
any origin. Shipping this as WP Engine software requires a transfer and a
licensing pass, including `T-UNBUNDLE-AI` — redistributing a third party's GPL
plugin is a materially different question when WP Engine is the distributor.

**Test coupling.** `flywheel-local`'s master branch carries 20
`addons-nexus-ai-*.playwright.ts` suites plus helpers, symlinking the addon from
a hardcoded `$HOME/development/wpengine/local-addon-nexus-ai`. Extracting
`nexusd` breaks the IPC assumptions those suites make. They need re-pointing as
part of the work, not after it.

**Naming.** Session 2: *"it's a little confusing in my mind because I'm thinking
Local is local. I'm not thinking about production sites."* The strategy document
independently warns not to assume Local is the right home. V1 keeps the name and
solves the confusion in the information architecture; the naming question is
real and deferred.

## Success criteria

- Opening the app shows every WPE install in the account, grouped by site, with
  provenance and age on every row, and no blocked UI during a full fleet
  assessment.
- A local site that was Connect-linked before the upgrade appears as a sandbox
  attached to the correct install, without user intervention. Anything that
  cannot be resolved is offered for manual linking rather than dropped.
- Both lenses produce a ranked list of findings with rationale, across the whole
  fleet, from the customer's own data.
- A risky change proposed against an install routes through the sandbox, produces
  a diff, requires approval, pushes, and is re-verified — with a real backup gate
  in front of the pull.
- `nexusd` starts, is supervised, and shuts down cleanly with Local; no
  credentials touch disk outside Local's `safeStorage`.
- The same `nexusd` binary runs with the Local host adapter absent, proving the
  paid deployment path without shipping it.
