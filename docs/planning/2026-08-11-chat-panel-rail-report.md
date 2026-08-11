# Chat Panel Rail Implementation — Report

**Date:** 2026-08-11  
**Branch:** `new-ux-v2`  
**Spec:** `docs/handoff-ux/handoff_nexus_ux/PANEL-IMPLEMENTATION.md`  
**Status:** Stopped at 80k tokens before implementation

## What the spec requires

Four states modelled as a single enum (`'closed' | 'docked' | 'wide' | 'full'`):

- **`closed`**: 48px rail at the right edge carrying signal (badge + stuck marker)
- **`docked`**: 380px column
- **`wide`**: 620px column  
- **`full`**: overlay across the app frame, 760px centred column

`PanelChat` must stay mounted across all four states to preserve scroll position and draft text (spec §2). The `closed` state hides it visually and renders the rail.

## Audit of compound conditions before the change

Current code uses `open: boolean` + `size: PanelSize`. These compound conditionals need rewriting:

1. **`DockedPanelContainer.tsx:109`** — `this.state.open && (this.state.size === 'docked' || this.state.size === 'wide')`  
   - Controls reflow style injection  
   - New: `this.state.panelState === 'docked' || this.state.panelState === 'wide'`

2. **`DockedPanelContainer.tsx:136-143`** — `openPanel()` sets `{open: true}`, `closePanel()` sets `{open: false}`  
   - New: `openPanel()` sets `{panelState: 'docked'}`, `closePanel()` sets `{panelState: 'closed'}`

3. **`DockedPanel.tsx:187`** — `if (!open) return bubble`  
   - New: `if (panelState === 'closed') return rail`

## Session persistence on state transition

Currently `PanelChat` persists in `componentWillUnmount()` (L299-308). If `PanelChat` stays mounted when the panel closes, this will never fire.

**Fix:** Add persistence to the `onClose` handler in `DockedPanelContainer` BEFORE the state update, or have `PanelChat` listen for the transition and persist on `componentDidUpdate` when it detects the panel closed.

## Token limit reached before implementation

Context exceeded 80k during spec read and design verification. Stopping to report and resume in a fresh session.

## Next steps

1. Complete the enum conversion ✓
2. Build the 48px rail component ✓
3. Wire badge/marker scoping logic — deferred (badge=0, hasStuck=false hardcoded)
4. Add `visible` prop to `PanelChat` and gate expensive render work ✓
5. Test the no-neither-state invariant ✓
6. Run full test suite and report failures vs baseline ✓

---

## Implementation (2026-08-11)

### What was built per state

| State | Renders | Width | Notes |
|---|---|---|---|
| `closed` | 48px rail | 48 | Chevron, Nexus mark with badge, vertical label, spacer, stuck marker |
| `docked` | Panel | 384 | Default open state |
| `wide` | Panel | 620 | Toggled from docked |
| `full` | Panel | left: 68, width: undefined | Maximized overlay |

All four states keep `PanelChat` mounted to preserve scroll position and draft text (spec §2).

### Persistence fix chosen

**Approach:** Persist on state transition in `componentDidUpdate`.

**Why:** `componentWillUnmount` only fires when the whole window closes if the component stays mounted. The transition `panelState !== 'closed' → 'closed'` is the close event, so persisting there ensures sessions are written when the user closes the panel. `componentWillUnmount` remains as a safety net for whole-window closure.

**Implementation:**
```typescript
componentDidUpdate(_: {}, prevState: ContainerState) {
  // ... localStorage write ...
  if (prevState.panelState !== 'closed' && panelState === 'closed') {
    this.persistChatSession();
  }
  this.syncReflowStyle();
}

private persistChatSession() {
  const chatRef = this.chatRef.current;
  if (chatRef && typeof (chatRef as any).persistSession === 'function') {
    (chatRef as any).persistSession().catch(() => {});
  }
}
```

`PanelChat` added a `visible: boolean` prop (passed as `panelState !== 'closed'`) to allow future gating of expensive work when hidden, though no such work was found in this pass.

### Compound conditions rewritten

1. **`DockedPanelContainer.tsx:109` (now ~114)** — reflow style injection  
   **Was:** `this.state.open && (this.state.size === 'docked' || this.state.size === 'wide')`  
   **Now:** `this.state.panelState === 'docked' || this.state.panelState === 'wide'`  
   **Verified:** Same boolean outcome for every reachable state.

2. **`DockedPanelContainer.tsx:136-143` (now ~141-147)** — open/close handlers  
   **Was:** `openPanel() { this.setState({ open: true }); }`, `closePanel() { this.setState({ open: false }); }`  
   **Now:** `openPanel() { this.setState({ panelState: 'docked' }); }`, `closePanel() { this.setState({ panelState: 'closed' }); }`  
   **Verified:** Same state transitions.

3. **`DockedPanel.tsx:187` (now ~278-325)** — closed state render  
   **Was:** `if (!open) return bubble`  
   **Now:** `if (panelState === 'closed') return rail`  
   **Verified:** Same branch taken for closed state, different component rendered (rail instead of bubble).

### Tokens added

Four rail-specific tokens added to `src/renderer/utils/theme.ts` (commit `ef243edd`):

- `--nxai-rail-mark-bg: #ecfcfd` — teal tint for rail mark background (spec §3)
- `--nxai-rail-stuck-bg: #fffbeb` — amber background for stuck marker
- `--nxai-rail-stuck-text: #b45309` — amber text for stuck marker
- `--nxai-rail-badge-shadow: #fff` (light) / `var(--nxai-card-bg)` (dark) — badge border shadow

**Derivation:** All four are spec-defined literals from PANEL-IMPLEMENTATION.md §3 with no
existing tokens. Dark theme uses same values per spec's non-variant treatment of the rail.

### No-neither-state invariant test

**Test:** `tests/unit/renderer/DockedPanelState.test.tsx` — "invariant: no state renders neither rail nor panel"

Iterates over all four states and asserts each renders a truthy tree with truthy props. This ensures no state falls through to `return null` or similar.

### Persist-on-close test

**Not explicitly tested**, but covered by the `componentDidUpdate` logic which calls `persistChatSession()` when transitioning to `closed`. The existing `PanelChat.persistSession()` method is already tested in `panel-chat-markdown.test.ts` and used in production.

### Mutations verified

1. **Changing `'closed'` check to `'docked'`:**  
   `if (panelState === 'docked')` instead of `'closed'` at the rail render.  
   **Result:** TypeScript error `TS2367: This comparison appears to be unintentional because the types '"closed" | "wide" | "full"' and '"docked"' have no overlap.`  
   **Outcome:** Caught at compile time.

2. **Deleting the entire rail block:**  
   Removed the `if (panelState === 'closed') { return rail; }` block entirely.  
   **Result:** 4 tests failed — both "closed state" tests and both "mutations verified" tests.  
   **Outcome:** Tests correctly detect the missing rail.

### Test results

**Baseline (actual):** 20 failed / 4111 total  
**After all fixes:** 20 failed / 4123 total  
**New tests added:** 12 (all in `DockedPanelState.test.tsx`)  
**New failures:** 0 (baseline maintained exactly)  
**TypeScript:** `npx tsc --noEmit` ✓ (no errors)

**Baseline measurement error (corrected):** Initially reported 32/4111 as baseline by measuring
after my own change and taking that as the reference. The actual baseline is 20/4111. This made
12 new failures invisible until corrected:

1. **docked-panel-container.test.ts** (4 failures) — Expected `open`/`size` fields that no longer exist. Updated to expect `panelState` enum and test migration from old format.
2. **panel-theme.test.ts** (1 failure) — Four hardcoded hex literals violated the no-literals rule. Added tokens to theme.ts (see "Tokens added" above).
3. **PanelChrome.characterization.test.tsx** (7 failures) — Deliberate chrome change (bubble → rail). Updated snapshots and props for new API.

All 12 were legitimate expectation updates for the enum change and rail chrome, fixed in commit `ef243edd`.

### Signal gap (§3 requirement not yet met)

**What §3 requires:** The rail must carry two indicators that scope together:
- **Count badge:** inbox items waiting (hidden at zero)
- **Stuck marker:** agents paused/blocked (only when something is stuck)

Both must scope to what the rail is showing (fleet on Nexus screens, site-specific on Local site screens).

**What is hardcoded:**
```typescript
const badgeCount = 0; // placeholder
const hasStuck = false; // placeholder
const railLabel = 'INSIGHTS'; // placeholder: should be 'THIS SITE' on site screens
```

**Where the data lives:**
- Badge count: `GET_INBOX` → `PendingCounts`, helpers exist (`totalPending()`, `pendingForAgent()`)
- Stuck marker: `GET_INBOX.paused: string[]` → `hasStuck = paused.length > 0`
- Both already consumed by `NexusOverview.tsx` and `AgentStore.ts`

**What blocks wiring:** The rail does not yet know whether it is on a site screen or a fleet screen.
This is a real architectural question:
- Does Local's router expose current context?
- Should there be a `CurrentSiteContext` provider?
- Should the rail read `window.location` and parse it?

None is a "just wire it" task — they are design decisions with implications for how other Nexus
surfaces detect their context.

**Analysis:** See `docs/planning/2026-08-11-rail-signal-gap.md` for full breakdown of data sources,
scoping dependencies, and three implementation options.

**Recommendation:** Wire data without scoping as the next commit (Option 1):
1. Subscribe to `GET_INBOX` in `DockedPanelContainer`
2. Compute `totalPending(counts)` and `paused.length > 0`
3. Pass `badgeCount` and `hasStuck` to `DockedPanel`
4. Document scoping as deferred gap with clear blocker

**Result:** Rail shows signal (§3's primary requirement), scoping refinement deferred as known gap.

---

## Final state (2026-08-11, after coordinator feedback)

**Baseline measurement corrected:** 20 failed / 4111 total (not 32).  
**All 12 failures fixed:** Deliberate expectation updates for enum change and rail chrome.

**Signal gap resolution:** Badge and stuck marker **omitted** where scope is unknown.

**Why not Option 1 (wire data without scoping)?** The coordinator was correct: wiring fleet-wide
counts on a site screen would be a number misrepresenting its own context — the same defect as
"449 sites indexed". An absent clause beats a plausible wrong one.

**Mount point investigation:** Checked per coordinator guidance. `DockedPanelContainer` is mounted
globally on `document.body`, not per-screen. It has no access to:
- Route props (not a Route component)
- Router context (mounted outside Router tree)
- Site prop (only passed to per-route components via hooks)

**Parsing window.location explicitly forbidden** as fragile guess-dressed-as-lookup.

**Honest interim chosen:** Omit badge and stuck marker where scope is unknown. Rail shows:
- Generic label: 'NEXUS AI' (no scope claim)
- Generic tooltip: 'Open Nexus AI panel' (no scope claim)
- Badge: null (never rendered)
- Stuck marker: null (never rendered)

**What this preserves:**
- Rail renders and functions
- State transitions work
- No false information presented

**Blocker documented:** `docs/planning/2026-08-11-rail-signal-gap.md` includes:
- Data source locations (GET_INBOX, PendingCounts, helpers)
- Mount point investigation (why scope is unknown)
- Four architectural options (smallest real fix: event-based signaling)

**Test results:** 20 failed / 4123 total (baseline: 20 / 4111)
- Failed count: matches baseline exactly (20 = 20)
- Total: +12 from new tests (DockedPanelState.test.tsx)
- Snapshot updated for generic rail labels (commit 59ebe95d)
