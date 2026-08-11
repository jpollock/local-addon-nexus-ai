# Rail Signal Gap — Analysis

**Date:** 2026-08-11  
**Context:** Chat panel rail implementation (§3 of PANEL-IMPLEMENTATION.md)  
**Status:** Signal sources exist but are not wired to the rail

## What §3 requires

The rail must carry two indicators that scope together:

1. **Count badge** — inbox items waiting for the user (amber on white, `#0ECAD4`, hidden at zero)
2. **Stuck marker** — agents that are paused/blocked (amber `!` glyph, 30×30, only when something is stuck)

Both must scope to what the rail is showing:
- **Fleet context** (Nexus screens): badge shows total pending, stuck marker appears if any agent is stuck
- **Site context** (Local site screens): badge shows that site's pending count, stuck marker is **suppressed**

The spec is explicit: "Scoping the badge but not the marker — which the prototype did until review — puts a site-scoped number and a fleet-scoped alarm 40px apart with nothing saying they differ."

## What is currently hardcoded

```typescript
const badgeCount = 0; // placeholder
const hasStuck = false; // placeholder
const railLabel = 'INSIGHTS'; // placeholder: should be 'THIS SITE' on site screens
```

All three are wrong by design — they were left as placeholders to get the rail rendering, not because the data doesn't exist.

## Where the data lives

### Badge count (inbox pending items)

**Source:** `IPC_CHANNELS.GET_INBOX` → `PendingCounts` (type in `src/renderer/components/agents/pending.ts`)

**Current consumers:**
- `NexusOverview.tsx` (fetches via `ipc.invoke(IPC_CHANNELS.GET_INBOX)`)
- `AgentStore.ts` (stores as `pendingBySource: Record<string, number>`)
- `AgentsHub.tsx` (reads from AgentStore)

**Helpers already exist:**
- `totalPending(counts: PendingCounts): number` — sum across all agents
- `pendingForAgent(counts, agentId): number` — per-agent count
- `agentsWithPending(counts): number` — how many agents have pending items

**What needs wiring:**
1. `DockedPanelContainer` needs to subscribe to the same pending counts `NexusOverview` reads
2. Pass `badgeCount: number` down to `DockedPanel`
3. Scope it: fleet total on Nexus screens, site-specific count on Local site screens

**The scoping question:** How does the rail know which site screen it's on?

Possible approaches:
- Read from Local's router/context (if exposed)
- Compare `window.location` or URL fragments
- Read from a shared store that tracks "current site id"
- Wire through props from the root mount point

This is the **actual dependency** — not the count itself (that exists), but knowing when to scope it.

### Stuck marker (agents paused/blocked)

**Source:** Unknown — no `AgentStatus` enum or `stuck`/`paused`/`blocked` state was found in `src/main/agent-runtime`.

**Search performed:**
```bash
grep -r "stuck\|paused\|blocked" src/main/agent-runtime --include="*.ts" | grep -i "status\|state"
# (no output)

grep -rn "AgentStatus\|agentStatus" src/main/agent-runtime --include="*.ts"
# (no output)
```

**Inbox has a `paused` field:**
`GET_INBOX` returns `{ paused: string[] }` (agent IDs currently auto-paused), referenced in:
- `InboxTab.tsx:11` — "Agent ids currently auto-paused, from GET_INBOX"
- `AgentStore.ts:114-115` — `pendingBySource` and `pendingLoaded`

**So the stuck marker source IS `paused.length > 0`** from the same `GET_INBOX` call.

**What needs wiring:**
1. Read `paused: string[]` from `GET_INBOX` alongside `pendingBySource`
2. Pass `hasStuck: boolean` (derived as `paused.length > 0`) down to `DockedPanel`
3. Scope it: show on fleet screens, **suppress on site screens** (per spec)

## Rail label scoping

**Current:** Hardcoded `'INSIGHTS'`  
**Spec requires:** `'THIS SITE'` on Local site screens, `'INSIGHTS'` on fleet/Nexus screens

**Same scoping dependency as the badge** — needs to know "am I on a site screen or a fleet screen?"

## What to do next

### Option 1: Wire the data now

1. Add `GET_INBOX` subscription to `DockedPanelContainer` (same as `NexusOverview` does)
2. Compute `badgeCount = totalPending(counts)` and `hasStuck = paused.length > 0`
3. Pass both down to `DockedPanel` as props
4. Defer scoping until the "which screen am I on" question is answered

**Outcome:** Badge and marker appear, but always show fleet-wide counts (no site scoping yet).

**Why this is incomplete but not wrong:** The rail would show signal, just not scoped signal. A fleet-wide count on a site screen is better than no count at all, and it's visible progress toward the spec.

### Option 2: Solve scoping first, then wire data

1. Determine how to detect "site screen vs fleet screen" context
2. Add that detection to `DockedPanelContainer`
3. Wire `GET_INBOX` with the scoping logic in place from the start

**Outcome:** Signal appears correctly scoped when it lands.

**Why this is harder:** The scoping question is architectural — it may require changes to how Local's router context is exposed, or a new shared store. That is not a "finish the rail" task, it is a "design the context propagation" task.

### Option 3: Document the gap and move on

The rail renders. The state enum works. The tests pass. The baseline is maintained.

**What is missing:**
- Badge count wiring (source exists: `GET_INBOX`)
- Stuck marker wiring (source exists: `GET_INBOX.paused`)
- Rail label and tooltip scoping (dependency: "which screen am I on?")

**What blocks scoping:**
The rail does not yet know whether it is on a site screen or a fleet screen. This is a real architectural question:
- Does Local's router expose current context?
- Should there be a `CurrentSiteContext` provider?
- Should the rail read `window.location` and parse it?

None of these is a "just wire it" task. They are design decisions with implications for how other Nexus surfaces detect their context.

## Recommendation

**Implement Option 1 (wire data without scoping) as the next commit**, with the following constraints:

1. `DockedPanelContainer` subscribes to `GET_INBOX` on mount
2. Computes `totalPending(counts)` and `paused.length > 0`
3. Passes `badgeCount` and `hasStuck` to `DockedPanel`
4. Documents in code: "TODO: scope to site when on site screens — see docs/planning/2026-08-11-rail-signal-gap.md"

**Result:** The rail shows signal (§3's primary requirement), the scoping refinement is deferred as a known gap with a clear blocker.

**Why this is the right cut:** The spec says the rail must carry signal. It does not say the signal must be perfectly scoped before the rail can ship. Scoping is a refinement that depends on solving "how does any Nexus surface know which Local screen it is on?" — a question bigger than this task.

If you disagree and want to solve scoping as part of this task, say so explicitly and I will trace the context propagation architecture before proceeding.
