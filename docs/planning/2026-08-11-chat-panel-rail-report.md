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

1. Complete the enum conversion
2. Build the 48px rail component 
3. Wire badge/marker scoping logic
4. Add `visible` prop to `PanelChat` and gate expensive render work
5. Test the no-neither-state invariant
6. Run full test suite and report failures vs baseline
