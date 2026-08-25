---
title: What's New — August 2026
description: The intelligence spine, agents, procedures, and the fleet collapse
keywords: [whats-new, changelog, august-2026]
---

# What's New — August 2026

The largest change in the project's history: the intelligence-spine work
(644 commits) merged to main on 2026-08-25.

## The intelligence layer

Every observation about your fleet now lands in an **append-only local
ledger** with provenance and freshness stamped on it. Answers in the chat and
fleet tools disclose the age of the data they rest on, offer live re-checks,
and **cite the records that supplied them**. Nothing leaves your machine.

## The fleet collapse — one Sites list

The Inbox, Installs, and Fleet tabs are retired. The **Sites** tab (the
Properties view) is now the single fleet list — local, WP Engine, and external
SSH sites together, with search-becomes-filters, a needs-you column, and bulk
actions over exactly the rows you tick. The UI is now five tabs: **Now ·
Sites · Record · Agents · Settings**, plus the Docked Panel chat.

## Agents & procedures

Four autonomous agents ship with schedules, workspaces, and audited runs (see
[Agents](../features/agents.md)). Risky operations are governed by reviewed
runbooks with checkpoint attestation, and capability grants are
**deny-by-default** (see [Procedures & Grants](../features/procedures.md)).

## External SSH hosts

Any SSH-reachable WordPress site can join the fleet:
[External SSH Hosts](../features/external-hosts.md).

## Under the hood

- Vector search migrated **LanceDB → sqlite-vec** — 13× faster at p50 with
  identical results.
- A defect campaign across the remote indexing pipeline (FTS keyword search,
  SSH connection lifecycle, double-indexing, ACF meta, CPT-aware counts,
  honest bulk outcomes).
- 675 test suites / 9,300+ tests green at the merge.

Earlier notes: [May 2026](archive/whats-new-may-2026.md) ·
[July 2026](archive/whats-new-july-2026.md)
