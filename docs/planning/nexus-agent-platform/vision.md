# Nexus Agent Platform — Vision

**Date:** 2026-07-12  
**Branch:** `feat/nexus-agent-platform`  
**Status:** Vision approved — drilling into Spec 01 (SDK + Runtime) next  

---

## What We're Building

Nexus Agent Platform is a three-layer system that lets developers build, run, and distribute AI agents for WordPress and WP Engine — locally for development, and in production on Atlas or a future hosted runtime.

The foundation is a standalone SDK (`@nexus-ai/agent-sdk`) that defines the agent contract. Every layer above it is built on that contract, which means agents authored locally run unmodified on Atlas, and agents distributed via npm work whether or not Local is installed.

---

## The Stack

```
┌─────────────────────────────────────────────────────┐
│  Publisher        deploy to Atlas, publish to npm   │
│                   Spec 03                           │
├─────────────────────────────────────────────────────┤
│  Builder          author, dev, validate, package    │
│                   Spec 02                           │
├─────────────────────────────────────────────────────┤
│  Runtime          task agents, reactive agents,     │
│                   daemon agents, state, sandboxing  │
│                   Spec 01 (part 2)                  │
├─────────────────────────────────────────────────────┤
│  Event Bus        route events → agent subscriptions│
│                   Spec 01 (part 1)                  │
├─────────────────────────────────────────────────────┤
│  Event Sources    WordPress sites · WP Engine       │
│                   platform · Local lifecycle ·      │
│                   external webhooks                 │
├─────────────────────────────────────────────────────┤
│  SDK              defineAgent, triggers, on(),      │
│                   stream(), state API, lifecycle    │
│                   Spec 01 (foundation)              │
└─────────────────────────────────────────────────────┘
```

---

## Sub-Platform Specs

| # | Spec | Status | File |
|---|---|---|---|
| 01 | SDK + Event Bus + Runtime | In progress | [spec-01-sdk-runtime.md](./spec-01-sdk-runtime.md) |
| 02 | Builder (authoring toolchain) | Not started | spec-02-builder.md |
| 03 | Publisher (Atlas deploy + npm registry) | Not started | spec-03-publisher.md |

---

## Agent Execution Modes

The SDK defines three agent execution modes, each with a distinct lifecycle:

| Mode | Lifecycle | Typical use |
|---|---|---|
| **Task** | Runs to completion, exits | Nightly plugin updater, scheduled health report |
| **Reactive** | Wakes on a single event, runs to completion, sleeps | On post.published → SEO audit; on deploy → smoke test |
| **Daemon** | Always-on process, maintains state across events, subscribes to a continuous stream | WooCommerce order monitor, uptime watcher, fraud detector |

All three modes share the same `defineAgent` API — the trigger type determines which mode the runtime uses.

---

## The SDK Contract

An agent is a TypeScript module that exports a `defineAgent` call:

```typescript
import { defineAgent, cron, on, stream, webhook } from '@nexus-ai/agent-sdk';

export default defineAgent({
  name: 'nightly-plugin-updater',
  version: '1.0.0',
  description: 'Updates plugins across all local sites every night',

  // Triggers determine execution mode
  triggers: [
    cron('0 2 * * *'),                               // Task — scheduled
    on('wp:post.published', { site: 'my-store' }),   // Reactive — site event
    on('wpe:deploy.completed'),                      // Reactive — platform event
    stream('wp:order.*'),                            // Daemon — always-on stream
    webhook('/on-external-signal'),                  // Reactive — external HTTP
  ],

  // Tools available to this agent (scoped subset of Nexus MCP tools, or custom)
  tools: ['wp_plugin_update', 'wp_site_health', 'nexus_list_sites'],

  model: 'claude-sonnet-5',

  async run({ event, trigger, tools, state, ai, log }) {
    // Agent logic here — same code runs locally and on Atlas
  },
});
```

When deployed to Atlas, `@nexus-ai/agent-sdk` bundles a self-contained runtime. The agent calls WP REST API and WP Engine CAPI directly — no dependency on Local being installed.

---

## Event Sources

Nexus already receives events from WordPress sites via the `nexus-ai-connector` plugin and the HTTP event interface (`/wp-events`). The Event Bus extends this into a first-class routing layer.

| Source | Event namespace | Examples |
|---|---|---|
| WordPress sites | `wp:*` | `wp:post.published`, `wp:user.registered`, `wp:plugin.activated`, `wp:order.placed`, `wp:hook.*` |
| WP Engine platform | `wpe:*` | `wpe:deploy.completed`, `wpe:backup.finished`, `wpe:ssl.expiring`, `wpe:traffic.spike` |
| Local lifecycle | `local:*` | `local:site.started`, `local:site.stopped`, `local:plugin.installed`, `local:clone.completed` |
| External | `webhook` | Arbitrary HTTP POST to agent's webhook endpoint |

---

## User Segments

| Segment | How they use Nexus Agent Platform |
|---|---|
| **Local developer** | Personal automation — local-only agents, dev/test loop, never published |
| **WP Engine customer** | Publish agents to Atlas; agents manage production WordPress sites |
| **Agent distributor** | `nexus agent publish` → `@nexus-agents/my-agent` on npm; shared with other Local users |
| **Intelligent Web customer** | WP Engine's hosted AI capabilities exposed as SDK-registered tools; no Local required |

---

## Distribution Model

Agents are distributed as npm packages under a scoped org (e.g., `@nexus-agents/`). This gives versioning, semver, and discoverability for free.

```bash
# Install a community agent
nexus agent install @nexus-agents/seo-auditor

# Publish your own
nexus agent publish
```

Local-only agents never need to be published — they live in a local `agents/` directory and are registered directly with the runtime.

---

## Build Order

The SDK contract must be stable before any other layer is built. Each spec depends on the previous.

```
Spec 01: SDK + Event Bus + Runtime  ← we are here
Spec 02: Builder (authoring toolchain)
Spec 03: Publisher (Atlas deploy + npm registry)
```

---

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-12 | SDK-first architecture | Portability across all four user segments; npm distribution is natural; clean contracts between layers |
| 2026-07-12 | npm as distribution mechanism | Versioning, semver, and discoverability are free; fits Node.js-native stack |
| 2026-07-12 | Code-first builder (no visual UI for now) | Faster to ship; visual layer can be added later without changing the SDK contract |
| 2026-07-12 | Three execution modes (task / reactive / daemon) | Covers scheduled automation AND always-on event-driven agents in one unified model |
| 2026-07-12 | Atlas-deployed agents are self-contained | No Nexus dependency at runtime; WP REST + CAPI + npm packages only |
| 2026-07-12 | Local agents stay local by choice | Some automation is dev-only; publishing is opt-in, not required |

---

## Risks

| Risk | Severity | Notes |
|---|---|---|
| **SDK contract churn** | High | Wrong API is expensive post-publish. Spec 01 must nail the contract before any tooling is built on top. |
| **Daemon agent resource usage** | High | Always-on agents in Local can accumulate and drain memory. Process lifecycle management is non-negotiable in Spec 01. |
| **Agent sandboxing** | High | Malicious or buggy agents must not crash Local or leak credentials. Tool scoping + process isolation needed. |
| **Atlas integration unknown** | Medium | Atlas deploy mechanism needs validation against actual Atlas API before Spec 03 begins. |
| **State durability** | Medium | Agents that fail mid-run need recoverable state. sqlite is likely the right store (Nexus already uses it). |
| **"Intelligent Web" scope** | Medium | Undefined. Needs its own discovery exercise before it can be designed into the SDK as a tool category. |
| **Event bus scalability** | Low (now) | In-process pub/sub is fine for Local. Atlas-deployed daemons will eventually need an external bus (Redis Streams etc.) — design the abstraction so it's swappable. |
| **npm org ownership** | Low | `@nexus-agents/` needs to be claimed before Spec 03 ships. |

---

## What This Is Not (scope boundaries)

- **Not a general-purpose workflow engine** — agents are WordPress/WP Engine-aware by design
- **Not a hosted runtime (yet)** — Atlas is the production target; a hosted Nexus Agent Service is a future consideration
- **Not a visual builder (yet)** — code-first for now; visual layer is Spec 02 v2
- **Not an MCP server replacement** — agents consume MCP tools; they don't replace the tool registry
