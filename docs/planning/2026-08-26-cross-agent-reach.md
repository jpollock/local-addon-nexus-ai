# Cross-agent reach — the §D.7 ruling, and the caller the dispatch seam never carried

*Owner ruling 2026-08-26: **C, the conjunction.** Every party to a contributed-tool
call must hold the same declaring capability. Cited by this packet, per the
design note's own instruction that a packet cites the ruling rather than the note.*

## Why this exists

`docs/intelligence/agent-actor-design-note.md:458-474` (§D.7) required this
ruling **before** actor-scoping shipped:

> Both have holes, so neither may be a default, and this must be ruled before
> actor-scoping ships — an unruled default here is a hole that arrives *with*
> the mechanism meant to close one.

Actor-scoping shipped 2026-08-26 (`docs/planning/2026-08-26-agent-addressed-grants.md`).
That spec contains the word "contributed" zero times. The default was therefore
set by accident, and it was option (B): check the contributor.

## Measured seams (2026-08-26, `14b11f7d`)

**`AgentDispatcher.dispatch(agentName, toolName, args, task?)` has no caller
parameter, and all FOUR of its entry points know their caller and drop it:**

| entry point | who is calling | what it passes | frame? |
|---|---|---|---|
| `NexusToolProvider.ts:330` | the running agent | contributor only | **no** |
| `McpServer.ts:373` | an external MCP client / the CLI | contributor only | **no** |
| `ChatService.ts:487` | the docked panel (`chat`) | contributor only | yes |
| `ipc-handlers.ts:1077` | the agent's own workspace UI | contributor only | **no** |

`agentName` in every case is the tool's OWNER — `contributedRegistry.get(agentName,
toolName)` requires the pair to match, so the dispatched name can never be the
caller unless they coincide.

Three consequences follow from the one missing parameter:

1. **The gate asks the wrong party.** `AgentDispatcher.ts:103` passes `agentName`
   as the grantee, so `reachRefusal` consults the CONTRIBUTOR's grants. A
   capability a human granted to log-processor is reachable by anything that can
   name one of its tools. On the `McpServer` path the escaping party is
   `mcp-client` — an external, user-facing surface.
2. **The audit record names the wrong actor.** `operation: ${agentName}/${toolName}`
   (`:107`), `source: agentName` (`:149`), `actor: agentActorId(agentName)` (`:221`).
   A cross-agent act reads as if the contributor did it unprompted.
3. **The run correlation is lost.** Three of the four entry points pass no task
   at all, so `taskId` is `undefined` and nothing ties the act to the run that
   caused it. G5 says history is emitted by construction; here it is emitted
   naming the wrong actor with no thread back to the cause.

**Latency of the hole, measured:** no grantee holds any capability (the
fail-closed flip revoked all), and no runbook in `law/` names an agent-contributed
tool, so `capabilitiesDeclaringTool` returns empty and no refusal fires on any
path today. Nothing is exploitable. The default is nonetheless SET, in code,
with no ruling, no comment and no pin — and it becomes load-bearing at the first
re-grant or the first runbook authored against a contributed tool (itself open
question 3 in the design note, a phase-5 precondition).

The population is real and shipped: `agents/seo-insights/nexus.agent.yaml:31`
declares log-processor's `get_log_aggregates`.

## The ruling, stated precisely

**A contributed-tool call passes the reach check only if there exists a single
declaring capability that EVERY party to the call holds.**

- Parties are the CALLER (the surface or agent that initiated) and the
  CONTRIBUTOR (the agent whose code executes).
- The disjunction across capabilities survives — any ONE declaring capability
  is enough — but it must be the SAME capability for every party. Letting A
  hold `c1` and B hold `c2` would let two partial authorities combine into one
  neither was granted.
- An unattributable party holds nothing (the existing rule), so a call with no
  identifiable caller is refused rather than credited to the contributor.
- When caller and contributor coincide (the workspace-UI path, and any agent
  calling its own tool) the conjunction collapses to today's single check —
  byte-identical behaviour.

**Applied uniformly to all four surfaces, including `chat` and `mcp-client`.**
The narrower alternative — conjunction for agent→agent only, caller-check for
the builtin surfaces — was considered and not taken: it needs two rules where
one will do, and its only advantage is sparing a human from granting the owning
agent a capability they already granted chat. That advantage is hypothetical
today (nothing declares a contributed tool) and the refusal message names the
missing party, so the remedy is discoverable. If a real case argues for the
narrower rule, narrow it then, with the case in hand — which is the whole
lesson of this packet.

## Scope — what this packet does NOT answer

**Whether the ledger's `actor` for a dispatched act should be the executor or
the initiator is left unruled.** The act runs as the contributor's code; the
initiator caused it. Both readings are defensible and the choice has ADR weight.
This packet threads the caller through and records it in the AUDIT entry (the
compliance record, where "who asked" is the question), and leaves
`actor: agentActorId(agentName)` alone. Answering it here would repeat the
mistake this packet exists to correct — and it is the same discipline the
dispatcher already applies to `taskId`, which it passes through and never mints
because "is a dispatch its own run?" is unruled.

## Build

1. `dispatch()` gains a caller parameter; all four entry points name themselves.
   The two that have a frame pass it; the two that do not keep passing none
   (`taskId` is passed through, never minted).
2. `checkCheckpointSequence` accepts one grantee or several; `reachRefusal`
   applies the conjunction and names every party that lacks the capability.
   **Named limit:** `GovernDoorTarget` stays `{surface, section, capability,
   runbookId}` — it carries no grantee, so with per-grantee grants the door
   says which capability to grant but not to whom. The refusal MESSAGE names
   the lacking party, so the remedy is stated; moving it into the door is a
   renderer-contract change and belongs to whoever next touches that contract.
3. The audit entry carries the initiator when it differs from the contributor.
4. Tests: a cross-agent call where only the contributor holds it (refused —
   this is the shipped hole), only the caller holds it (refused), both hold the
   same capability (passes), each holds a DIFFERENT declaring capability
   (refused — the combination rule), an unattributable caller (refused), and
   the same-agent path (unchanged). Plus a pin that every dispatch entry point
   names a caller, so a fifth one cannot be added silently.

## Correction to the record

`AgentDispatcher.ts:102` carries the comment *"Phase 2 (fixes-082526): the
dispatcher knows exactly who is asking."* In the contributed path it does not —
it knows who IMPLEMENTS and assumes that is who asked. The comment was
introduced by the grants packet and is corrected here.
