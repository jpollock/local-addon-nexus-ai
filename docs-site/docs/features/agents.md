---
title: Agents
description: The shipped autonomous agents — schedules, workspaces, and audit
keywords: [agents, security-sentinel, log-processor, web-analytics, seo-insights]
---

# Agents

Nexus AI ships four autonomous agents. Each has a workspace under the
**Agents** tab — console output, run history, and settings — and can also be
driven from the CLI (`nexus agent list / run / logs / status`).

| Agent | Schedule | What it does |
|---|---|---|
| **security-sentinel** | Daily 03:00 + plugin-activated / user-created events | Fleet security sweep: absolute checks (backdoor slugs, default salts, exposure), baseline diffs, log-backed checks; escalates to an LLM-powered sandbox investigation on critical findings |
| **log-processor** | Nightly 03:00 | Ingests WP Engine access logs from your S3 bucket into per-site aggregates |
| **web-analytics** | Weekly (Mon 08:00) | GA4 traffic summaries, page performance, anomaly scans |
| **seo-insights** | Weekly (Mon 07:00) + WPE sync events | SEO checks across the fleet |

## Schedules are honest

An agent's schedule comes from its **manifest**. A cadence you explicitly pick
in its settings overrides the manifest — and only an explicit pick does. An
agent whose manifest has no schedule shows "not scheduled" instead of dead
controls.

## Runs are on the record

Every run is bracketed by `task.run.assigned` / `task.run.completed` events in
the local ledger, and an agent's tool calls carry the run and task ids into
the audit log. Findings become ledger incidents the chat can retrieve — and
check the agent's own report against.

## Safety

Agents run under the same permission gates as everything else: production
writes are refused unless you granted them, remediation is procedure-governed,
and destructive steps run in a local sandbox — never against the live site —
until you explicitly approve a push.

## See also

- [Procedures & Grants](procedures.md)
- CLI: `nexus agent --help`
