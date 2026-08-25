---
title: Procedures & Grants
description: Reviewed runbooks and deny-by-default capability grants
keywords: [procedures, runbooks, grants, capabilities, safety]
---

# Procedures & Grants

Operations with real consequences — bulk updates, environment promotion,
incident remediation — are governed by two mechanisms working together.

## Runbooks

Seven reviewed runbooks ship in the addon's `law/` directory, covering bulk
plugin updates, site diagnosis, incident containment and remediation,
promotion preflight and execution, and WPE pull. A runbook is Markdown with a
frontmatter contract (id, version, capability, checkpoints, abort paths), and
comes in two ceremony levels:

- **Strict** — the platform enforces checkpoint order and records attestation
  per step. A checkpoint the platform can verify shows as verified; one it is
  only *told about* is marked as such and never rendered with a verified tick.
- **Guided** — the agent may adapt; deviations are logged with rationale.

Runbooks are pinned by content hash. If the document changes after a grant
was issued against it, the mismatch is disclosed — never silently re-pinned.

## Capability grants — deny by default

A capability without a grant is **refused**. Production-scoped capabilities
(environment promotion, incident remediation) always require an explicit
grant; new capabilities arrive denied. A refusal names the capability, the
environment, and where to change it — Settings → WPE Access / Operation
Permissions — so it's an actionable message, not a dead end.

This is also why an agent's "Remediate" button won't work out of the box:
remediation commands are gated on write permissions that are off for
production by default. The error tells you exactly what to grant.

## What this buys you

- **Nothing risky happens bare.** The write path is procedure-shaped, with
  the human at the checkpoints the procedure marks.
- **The record is complete.** Approvals, refusals, executed actions and their
  outcomes are events in the local ledger, joined by task id.

## See also

- [Docked Panel & Citations](docked-panel.md)
- [Permissions & Access Control](../reference/permissions-access-control-v2.md)
- [Safety System](safety-system.md)
