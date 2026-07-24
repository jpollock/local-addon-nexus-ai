# Nexus Chat Quality Sprint — Design Spec

**Date:** 2026-07-24  
**Branch:** main (feat/docked-panel already merged)  
**Scope:** Four independent improvements to the docked chat panel

---

## Overview

Four parallel improvements that transform readability and correctness of Nexus Chat, informed by analysis of the Walt hosted chat app:

1. **Markdown rendering** — render assistant output through `marked`
2. **Streaming header status** — thread live tool-progress label into DockedPanel header
3. **Tool result expansion** — keep chips visible after execution; let user expand raw output
4. **ContextSelector wiring + LLM history reload** — wire site picker and restore conversation history to LLM on session resume

All four are independent and non-conflicting. They can be implemented in parallel worktrees.

---

## 1. Markdown Rendering

### Library
`marked` — MIT, ~45KB, zero dependencies. Added to `package.json` as a runtime dependency.

### What renders as markdown
- **Assistant messages only** — `role === 'assistant'`. User bubbles stay plain text.
- **Tool result expansion panels** (item 3) — also rendered through `marked`.
- System messages (centered teal lines) stay as plain text.

### Implementation
- Call `marked.parse(content)` and set via `dangerouslySetInnerHTML` on the assistant bubble `<div>`.
- Pass a custom `Renderer` to `marked` that:
  - Strips `<script>` and `<iframe>` tags from output (sanitization)
  - Wraps the output root in `class="nexus-md"` for CSS scoping
- Add `nexus-md` CSS rules to `src/renderer/styles/agent-console.css`:
  - `pre + code`: dark background (`#1a1e24`), `font-family: monospace`, padding, border-radius
  - `p`: `margin: 0 0 8px`; last-child margin 0
  - `ul/ol`: left padding, `margin: 4px 0`
  - `h1/h2/h3`: font-weight 600, appropriate sizes, bottom border on h1/h2
  - `table`: full-width, border-collapse, `th` dark header, `td` border-bottom
  - `a`: teal color, no underline by default, underline on hover
  - `strong/em`: inherit from Local's color palette

### Files changed
- `package.json` — add `marked`
- `src/renderer/components/DockedPanel/PanelChat.tsx` — use `marked.parse()` in assistant bubble render
- `src/renderer/styles/agent-console.css` — add `.nexus-md` rules

---

## 2. Streaming Header Status

### Problem
`DockedPanel` accepts a `streamingStatus: string | null` prop that switches the header subtitle between "Follows you across tabs" (null) and a live cyan dot + text. `DockedPanelContainer` never passes this prop, so the header never updates.

### Solution
Lift `streamingStatus: string | null` into `DockedPanelContainer` state (default `null`). Expose `onStreamingStatusChange: (status: string | null) => void` as a prop on `PanelChat`. Pass `this.state.streamingStatus` down to `DockedPanel`.

### PanelChat call sites
PanelChat calls `onStreamingStatusChange` at:
- `tool_call_start` event → `"Running [TOOL_NAMES[name] ?? name]…"`
- `done` event → `null`
- `error` event → `null`
- `componentWillUnmount` → `null` (cleanup)

### Files changed
- `src/renderer/components/DockedPanel/DockedPanelContainer.tsx` — add state field, pass prop to PanelChat and DockedPanel
- `src/renderer/components/DockedPanel/PanelChat.tsx` — call `onStreamingStatusChange` at the right stream events

---

## 3. Tool Result Expansion

### Problem
When a tool finishes, the running indicator (`⚡ tool_name …`) disappears. The user cannot see what the tool returned — they only see the AI's synthesized text response.

### Design
After a `tool_call_result` event, keep the chip visible in a `done` state. Each chip shows:
- A checkmark (✓) or error (✗) icon
- Tool display name (from `TOOL_NAMES` map)
- A chevron (▸/▾) indicating expandability

Clicking the chip toggles an inline expansion panel below it showing the raw result. The panel:
- Renders through `marked.parse()` if the result is a string
- Renders as formatted JSON (`JSON.stringify(result, null, 2)` in a `<pre>`) if the result is an object/array
- Truncates at 2000 chars with a "Show more" link
- Has a subtle border-left teal accent to visually separate it from the message flow

### State
`expandedTools: Set<string>` in PanelChat state, keyed by tool call ID. Toggle on chip click.

ActionCard flows (Tier-3 approval) are unaffected — they have their own UI and don't need expansion.

### Files changed
- `src/renderer/components/DockedPanel/PanelChat.tsx` — add `expandedTools` state, update chip render, add expansion panel render

---

## 4. ContextSelector Wiring + LLM History Reload

### 4a. ContextSelector Wiring

**Problem:** `DockedPanelContainer` hardcodes `selectedSiteIds: []` when rendering PanelChat. The `ContextSelector` component is fully built but never rendered. Site-specific context is never injected into the system prompt.

**Solution:**
1. Add `selectedSiteIds: string[]` to `DockedPanelContainer` state (default `[]`).
2. Render `ContextSelector` in the DockedPanel body above PanelChat, passing `electron` and `onChange: (ids) => this.setState({ selectedSiteIds: ids })`.
3. Pass `selectedSiteIds` down to PanelChat as a prop.
4. PanelChat already passes `selectedSiteIds[0]` as `siteId` to `CHAT_SEND` — this already flows into `ChatService.buildSystemPrompt`'s site-specific block. No ChatService changes needed.
5. Update `persistSession` to write the session's scope correctly (already reads from `selectedSiteIds` for `scope_label` and `scope_site_ids`).

**Files changed:**
- `src/renderer/components/DockedPanel/DockedPanelContainer.tsx` — add state, render ContextSelector, pass prop

### 4b. LLM History Reload

**Problem:** When a user resumes a persisted session after an addon restart, `ChatService` has no in-memory record for that session ID. It creates a new in-memory session with a fresh system prompt and empty history. The LLM has no memory of prior conversation — sessions feel broken on resume.

**Solution:** In `ChatService.handleSend()`, before running the agent loop, check if the session ID is in the in-memory Map. If not:
1. Load the persisted session from SQLite via `getSession(db, sessionId)`.
2. Reconstruct the Anthropic message history array from `session.messages`, filtering out any `streaming: true` entries and mapping `role`/`content` fields.
3. Insert the reconstructed session into the in-memory Map with the correct history.
4. Proceed with the agent loop — Claude now has full prior context.

Tool call messages (assistant tool_use + user tool_result blocks) are included in the reconstructed history so the LLM can see what tools were called in prior turns.

**Files changed:**
- `src/main/chat/ChatService.ts` — add history reconstruction in `handleSend()` before agent loop

---

## Testing

Each improvement can be verified independently:

| Item | Verification |
|---|---|
| Markdown | Send a message that returns a bulleted list, code block, and table — confirm rendered, not raw |
| Streaming header | Watch header subtitle update during a multi-tool response |
| Tool expansion | Click a ✓ chip after a tool runs — confirm raw result appears and collapses |
| ContextSelector | Select a site, send "what plugins are active?" — confirm site-specific answer |
| LLM history | Start a session, restart Local, reopen session, send a follow-up — confirm Claude remembers the prior turn |

Unit tests:
- `tests/unit/renderer/docked-panel-container.test.ts` — extend to cover selectedSiteIds state and streamingStatus threading
- `tests/unit/chat/chat-service.test.ts` — add test for history reconstruction on session resume

---

## Implementation Order (parallel)

These four items touch distinct files and can be worked in parallel worktrees:

| Worktree | Items | Key files |
|---|---|---|
| `chat-markdown` | Markdown rendering | `PanelChat.tsx`, `agent-console.css`, `package.json` |
| `chat-streaming` | Streaming header + tool expansion | `PanelChat.tsx`, `DockedPanelContainer.tsx` |
| `chat-context` | ContextSelector wiring + LLM history | `DockedPanelContainer.tsx`, `ChatService.ts` |

The `chat-streaming` and `chat-markdown` worktrees both touch `PanelChat.tsx` — merge `chat-markdown` first (lower risk), then rebase `chat-streaming` on top.
