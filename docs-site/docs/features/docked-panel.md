---
title: Docked Panel & Citations
description: The chat surface — provenance, freshness, live re-checks, and citations
keywords: [chat, docked-panel, citations, provenance, freshness]
---

# Docked Panel & Citations

The Docked Panel is Nexus AI's chat surface inside Local, available alongside
every tab. It manages WordPress sites in natural language using the same MCP
tools external clients use — with three properties an ordinary chat doesn't
have.

## Answers carry their evidence

Every turn assembles context through the intelligence layer and writes an
auditable manifest of what the model was given (which policy version, which
procedure, what was retrieved, how fresh each fact was). Replies **cite the
records that supplied them** — a citation resolves to a ledger event or a tool
call of the current task. A citation that resolves is quiet; one that points
at a record nobody supplied is surfaced loudly, because it *looks* like
evidence.

## Freshness is disclosed, not hidden

Facts served from the local cache (the "twin") are labeled with their
observation age. When a fact is stale against its freshness target, the answer
says so and offers a **live re-check** rather than presenting old data as
current.

## Risky operations follow procedures

Write operations of consequence are governed by reviewed runbooks (see
[Procedures & Grants](procedures.md)). The panel walks the runbook's
checkpoints, shows what the platform can verify versus what it is only told,
and asks for your approval where the procedure requires it. A capability
without a grant is refused with the exact permission to change — not silently
skipped.

## Session re-entry

Leaving mid-task is normal. The **Now** tab shows a re-entry card for the
session you left — same session, same cursor, same pending approvals.

## See also

- [First AI Query](../getting-started/first-ai-query.md)
- [Procedures & Grants](procedures.md)
- [Permissions & Access Control](../reference/permissions-access-control-v2.md)
