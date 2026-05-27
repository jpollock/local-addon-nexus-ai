# Ask/Tell Context Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ask/Tell robust enough for fleet management tasks: conversation persists across tab switches, "New Task" replaces Clear with the right mental model, the system prompt signals completed work clearly, and long conversations warn the user before context quality degrades.

**Architecture:** ChatTab is kept permanently mounted (CSS hide/show instead of conditional render) so its internal state — messages, session ID, stream listener — survives tab switches. Tool result compression happens server-side in ChatService, so the model receives lean history while the UI still renders full results. The system prompt teaches Claude to summarize completed work, preventing context pollution from stale state.

**Tech Stack:** TypeScript · React class components (React.createElement, no JSX) · Electron IPC · CSS vars for dark mode · existing ChatService / ChatTab / NexusOverview infrastructure

---

## Reference: key files

| File | Role |
|---|---|
| `src/renderer/components/ChatTab.tsx` | Chat UI — messages[], sessionId, Clear, stream listener |
| `src/renderer/components/NexusOverview.tsx` | Dashboard — renders ChatTab at case 'ask', controls tab visibility |
| `src/main/chat/ChatService.ts` | Server-side — session.messages[], sendMessage(), buildSystemPrompt() |

---

## Design decisions

### 1. Persistence via CSS mount (Task 1)
ChatTab manages a stream listener (IPC subscription), session ID, and streaming state. Lifting all this to NexusOverview would be a 200-line refactor with high risk. Instead: render ChatTab always (never unmount), hide/show with `display: 'none' / 'flex'`. One change in `renderActiveTab()`.

### 2. "New Task" mental model (Task 2)
Research is clear: the most important habit is starting a fresh session per task. Renaming "Clear" → "New Task" communicates that. Position: bottom of the chat, always visible. No confirmation required — the name itself signals intent. When conversation is empty, button is visually dimmed but still clickable (creates new session ID without any visible effect).

### 3. System prompt: task completion signal (Task 3)
Add a single instruction to `buildSystemPrompt()`. Claude will prefix completed-task responses with "✓ Done:" — this helps the model self-annotate what's resolved, reducing context pollution on subsequent turns.

### 4. Turn counter warning (Task 4)
Client-side only — count user messages (role='user') in the messages array. At 10+ user turns, show an amber warning bar above the input. Threshold of 10 is chosen because: most fleet management tasks complete in 3-7 turns; at 10 turns the context is getting long but not yet broken; this gives the user advance warning.

### 5. Tool result compression (Task 5)
Server-side in ChatService, before each LLM call. Rule: any `tool` role message whose content exceeds 800 chars AND is not from the most recent tool-use cycle gets compressed to its first 600 chars + a truncation note. The "most recent tool-use cycle" is the last block of consecutive tool calls before the current user message. This preserves fresh context fully while compressing stale results.

---

## File structure

### Modified files only (no new files)
- `src/renderer/components/NexusOverview.tsx` — keep ChatTab mounted; CSS hide/show
- `src/renderer/components/ChatTab.tsx` — rename Clear → New Task; dimming; turn warning
- `src/main/chat/ChatService.ts` — system prompt task-completion instruction; tool result compression

---

## Task 1: Conversation persistence via CSS mounting

**Goal:** ChatTab never unmounts when switching tabs. Conversation history, session ID, and stream listener survive.

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`

**Context:** `renderActiveTab()` currently uses a switch statement that returns nothing for non-active tabs, causing ChatTab to mount/unmount on every tab switch. The fix: always render ChatTab but hide it with CSS when the active tab is not 'ask'.

- [ ] **Step 1: Read current renderActiveTab structure**

```bash
grep -n "case 'ask'\|renderActiveTab\|return React.createElement" src/renderer/components/NexusOverview.tsx | tail -20
```

- [ ] **Step 2: Find the outer render container**

```bash
grep -n "renderTabBar\|renderActiveTab\|this.renderTabBar\|this.renderActiveTab" src/renderer/components/NexusOverview.tsx | head -10
```

- [ ] **Step 3: Replace conditional ChatTab render with always-mounted version**

In `NexusOverview.tsx`, find the `render()` method's main return. It calls `this.renderTabBar()` and `this.renderActiveTab()`. Add a persistently-mounted ChatTab div ALONGSIDE the tab content, not inside `renderActiveTab()`.

Find the `render()` method's main content area. It looks like:
```typescript
React.createElement('div', { style: { flex: 1, overflow: 'hidden' } },
  this.renderTabBar(),
  this.renderActiveTab(),
)
```

Replace with:
```typescript
React.createElement('div', { style: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const } },
  this.renderTabBar(),
  // Always-mounted ChatTab — hidden via CSS when not on Ask/Tell tab
  // This preserves conversation history, session ID, and stream listener across tab switches
  React.createElement('div', {
    style: {
      display: activeTab === 'ask' ? 'flex' : 'none',
      flex: 1,
      overflow: 'hidden',
      flexDirection: 'column' as const,
    },
  },
    React.createElement(ChatTab, { electron: this.props.electron }),
  ),
  // All other tabs render normally (mount/unmount on switch)
  activeTab !== 'ask'
    ? React.createElement('div', { style: { flex: 1, overflow: 'hidden' } },
        this.renderActiveTab(),
      )
    : null,
),
```

**Important:** Also remove the `case 'ask'` block from `renderActiveTab()` since ChatTab is now rendered outside it. Find the `case 'ask':` return in `renderActiveTab()` and delete it (or return null).

- [ ] **Step 4: Build**

```bash
npm run compile 2>&1 | tail -5
```
Expected: no errors. If you see "activeTab is not defined", add `const { activeTab } = this.state;` at the top of the render block.

- [ ] **Step 5: Verify manually**

Open Nexus dashboard → Ask/Tell tab → type a message → switch to Overview → switch back to Ask/Tell. Message should still be there.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/NexusOverview.tsx
git commit -m "feat(ask-tell): keep ChatTab mounted on tab switch — conversation persists"
```

---

## Task 2: "New Task" button — rename, reposition, dim when empty

**Goal:** Rename "Clear" → "New Task", make it always visible at the bottom of the chat area, dim it when there are no messages (it still works, but signals no action needed).

**Files:**
- Modify: `src/renderer/components/ChatTab.tsx`

**Context:** Currently `handleClear` exists at line 511 and the Clear button is rendered inside `renderInput()` at line 752. The function logic is correct — just UI changes.

- [ ] **Step 1: Rename handleClear to handleNewTask and update the method**

Find `handleClear` in `ChatTab.tsx`. Rename it to `handleNewTask`. The implementation is already correct:

```typescript
handleNewTask = (): void => {
  this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_CLEAR, this.state.sessionId);
  const newSessionId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  this.setState({
    messages: [],
    sessionId: newSessionId,
    isGenerating: false,
  });
};
```

- [ ] **Step 2: Update the button in renderInput()**

Find the Clear button in `renderInput()`. It's rendered with `onClick: this.handleClear` and the label `'Clear'`. Update:

```typescript
// Find this (exact text may vary):
React.createElement('button', {
  style: { ...btnStyle, color: ... },
  onClick: this.handleClear,
}, 'Clear'),

// Replace with:
React.createElement('button', {
  style: {
    ...btnStyle,
    color: this.state.messages.length === 0
      ? 'var(--nxai-card-sub, #6b7280)'
      : 'var(--nxai-card-text, #e6edf3)',
    opacity: this.state.messages.length === 0 ? 0.4 : 1,
    fontSize: '12px',
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid var(--nxai-card-border, #30363d)',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity .15s',
  },
  onClick: this.handleNewTask,
  title: 'Start a new task (clears conversation)',
}, '+ New Task'),
```

- [ ] **Step 3: Update any remaining references to handleClear**

```bash
grep -n "handleClear" src/renderer/components/ChatTab.tsx
```

Replace all remaining `handleClear` with `handleNewTask`.

- [ ] **Step 4: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ChatTab.tsx
git commit -m "feat(ask-tell): rename Clear → New Task — communicates task-scratchpad mental model"
```

---

## Task 3: System prompt — task completion signal

**Goal:** Claude prefixes completed-task responses with "✓ Done:" which marks prior state as resolved. This prevents the model from treating completed work as pending on subsequent turns.

**Files:**
- Modify: `src/main/chat/ChatService.ts`

**Context:** `buildSystemPrompt()` builds the system prompt for each new session. It's at line ~330. Add the task-completion instruction to the `lines` array.

- [ ] **Step 1: Find the system prompt lines array in ChatService.ts**

```bash
grep -n "lines.*push\|After completing\|task.*complet\|summarize.*task" src/main/chat/ChatService.ts | head -10
```

- [ ] **Step 2: Add task completion instruction**

In `buildSystemPrompt()`, find where the lines array is built. After the existing fleet management tool instructions, add:

```typescript
lines.push('');
lines.push('## Task completion protocol');
lines.push('When you finish a multi-step task (updated plugins, started a site, ran an audit, etc.), begin your final response with:');
lines.push('  ✓ Done: [one sentence past-tense summary of what was accomplished]');
lines.push('');
lines.push('This clearly marks completed work so follow-up questions are not confused with pending work.');
lines.push('Example: "✓ Done: Updated 3 plugins on pm-bulletin (Elementor, WooCommerce, ACF). Site is still running."');
lines.push('');
lines.push('For new tasks in the same conversation, treat previously completed work as resolved unless the user explicitly revisits it.');
```

- [ ] **Step 3: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/main/chat/ChatService.ts
git commit -m "feat(ask-tell): system prompt teaches Claude to signal completed tasks with Done prefix"
```

---

## Task 4: Turn counter warning

**Goal:** When a conversation reaches 10 or more user turns, show an amber warning bar above the input suggesting the user start a New Task.

**Files:**
- Modify: `src/renderer/components/ChatTab.tsx`

**Context:** The warning is purely client-side. Count messages where `role === 'user'`. Render a warning div between the message list and the input bar when the threshold is met.

**Turn threshold rationale:** Fleet tasks complete in 3-7 turns. At 10 user turns (~20 messages) the context is getting long but the model is not yet broken. This gives the user advance warning.

- [ ] **Step 1: Find where renderInput is called in the render() method**

```bash
grep -n "renderInput\|messageListStyle\|containerStyle" src/renderer/components/ChatTab.tsx | tail -10
```

- [ ] **Step 2: Add turn warning between message list and input**

In `render()` (at the bottom of the component, the main return), find where `this.renderInput()` is called. Add a warning div just before it:

```typescript
// Add this constant near the top of the component class or file:
// const LONG_CONVERSATION_THRESHOLD = 10; // user turns

// In render(), before this.renderInput():
const userTurnCount = this.state.messages.filter(m => m.role === 'user').length;
const showContextWarning = userTurnCount >= 10;
```

Then add this element before `this.renderInput()` in the render return:

```typescript
showContextWarning
  ? React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 14px',
        background: 'rgba(245,158,11,0.08)',
        borderTop: '1px solid rgba(245,158,11,0.2)',
        fontSize: '12px',
        color: '#fbbf24',
        flexShrink: 0,
      },
    },
      React.createElement('span', null, '⚠'),
      React.createElement('span', { style: { flex: 1 } },
        `Long conversation (${userTurnCount} turns) — context quality may degrade. `,
      ),
      React.createElement('button', {
        onClick: this.handleNewTask,
        style: {
          fontSize: '11px',
          fontWeight: 700,
          padding: '3px 8px',
          borderRadius: '5px',
          border: '1px solid rgba(245,158,11,0.3)',
          background: 'rgba(245,158,11,0.1)',
          color: '#fbbf24',
          cursor: 'pointer',
          fontFamily: 'inherit',
        },
      }, '+ New Task'),
    )
  : null,
```

- [ ] **Step 3: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ChatTab.tsx
git commit -m "feat(ask-tell): turn counter warning at 10 user turns with New Task shortcut"
```

---

## Task 5: Tool result compression in session history

**Goal:** Before each LLM call, compress tool results older than the most recent tool-use cycle to ≤600 chars. The model receives lean history; the UI still renders full results (UIMessage is client-side only).

**Files:**
- Modify: `src/main/chat/ChatService.ts`

**Context:** `ChatSession.messages` is the server-side history (role: system/user/assistant/tool). `tool` role messages contain the raw tool result. Large tool results (e.g., `nexus_plugin_audit` with 57 entries) consume thousands of tokens. After the model has responded to a result, that result is stale context.

**Compression rule:**
- A `tool` role message is **old** if there are 2+ assistant messages after it in the session history
- Old tool results longer than 800 chars get compressed to first 600 chars + `"\n[…compressed for context efficiency — ${originalLength} chars total]"`
- Recent tool results (from the last tool-use cycle) are never compressed

**Why 2 assistant messages:** The first assistant response after the tool call incorporates the result. The second confirms we're in a new turn. At that point the raw result is redundant.

- [ ] **Step 1: Add compression helper function in ChatService.ts**

Find the class body of `ChatService`. Add this private method:

```typescript
/**
 * Compress stale tool results in session history before each LLM call.
 * Tool results more than 1 assistant-response old are trimmed to 600 chars.
 * This prevents context bloat from large tool outputs (e.g., nexus_plugin_audit).
 */
private compressStaleToolResults(messages: ChatMessage[]): ChatMessage[] {
  const COMPRESS_THRESHOLD = 800;  // chars — results longer than this get compressed
  const COMPRESS_TO         = 600;  // chars — keep this many chars

  // Find the index of the second-to-last assistant message.
  // Tool results before that index are considered stale.
  let assistantCount = 0;
  let compressBefore = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      assistantCount++;
      if (assistantCount >= 2) {
        compressBefore = i;
        break;
      }
    }
  }

  if (compressBefore < 0) return messages; // not enough history yet

  return messages.map((msg, idx) => {
    if (idx >= compressBefore) return msg; // recent — keep as-is
    if (msg.role !== 'tool') return msg;   // not a tool result — keep as-is
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length <= COMPRESS_THRESHOLD) return msg; // short enough — keep
    return {
      ...msg,
      content: content.slice(0, COMPRESS_TO) +
        `\n[…compressed for context efficiency — ${content.length} chars total]`,
    };
  });
}
```

- [ ] **Step 2: Call compression before runAgentLoop**

In `sendMessage()`, find the line:
```typescript
await this.runAgentLoop(session, providerConfig.providerId, config);
```

Just before it, apply compression:
```typescript
// Compress stale tool results to keep context lean
session.messages = this.compressStaleToolResults(session.messages);

await this.runAgentLoop(session, providerConfig.providerId, config);
```

- [ ] **Step 3: Write unit tests**

Create `tests/unit/chat/ChatService.compression.test.ts`:

```typescript
// Access the private method via any-cast for unit testing
import { ChatService } from '../../../src/main/chat/ChatService';

function makeService(): any {
  // Minimal mock — we only need the private method
  return new (ChatService as any)(null, null, null);
}

function msg(role: string, content: string) {
  return { role, content };
}

test('does not compress when fewer than 2 assistant messages', () => {
  const svc = makeService();
  const messages = [
    msg('system', 'system prompt'),
    msg('user', 'hello'),
    msg('assistant', 'hi'),
    msg('tool', 'x'.repeat(1000)),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[3].content).toHaveLength(1000); // unchanged
});

test('compresses tool result older than 2 assistant messages', () => {
  const svc = makeService();
  const longResult = 'A'.repeat(1000);
  const messages = [
    msg('system', 'sys'),
    msg('user', 'q1'),
    msg('tool', longResult),       // this should be compressed
    msg('assistant', 'answer1'),   // first assistant
    msg('user', 'q2'),
    msg('assistant', 'answer2'),   // second assistant — threshold
    msg('user', 'q3'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[2].content.length).toBeLessThan(700);
  expect(result[2].content).toContain('[…compressed');
  expect(result[2].content).toContain('1000 chars total');
});

test('does not compress short tool results even if old', () => {
  const svc = makeService();
  const messages = [
    msg('system', 'sys'),
    msg('tool', 'short result'),   // short — never compress
    msg('assistant', 'a1'),
    msg('assistant', 'a2'),
    msg('user', 'q'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[1].content).toBe('short result');
});

test('preserves recent tool results (after second-to-last assistant)', () => {
  const svc = makeService();
  const longRecent = 'B'.repeat(1000);
  const messages = [
    msg('system', 'sys'),
    msg('user', 'q1'),
    msg('assistant', 'a1'),
    msg('user', 'q2'),
    msg('assistant', 'a2'),
    msg('tool', longRecent),       // recent — preserve
    msg('user', 'q3'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[5].content).toHaveLength(1000); // unchanged
});

test('compresses only tool role — leaves other roles untouched', () => {
  const svc = makeService();
  const longUser = 'C'.repeat(1000);
  const messages = [
    msg('user', longUser),
    msg('assistant', 'a1'),
    msg('assistant', 'a2'),
  ];
  const result = svc.compressStaleToolResults(messages);
  expect(result[0].content).toHaveLength(1000); // user message untouched
});
```

Run: `npm test -- --testPathPattern="compression" --no-coverage 2>&1 | tail -10`
Expected: FAIL — method not yet accessible (or passes if private method test works).

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="compression" --no-coverage 2>&1 | tail -10
```
Expected: 5 tests PASS.

- [ ] **Step 5: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/main/chat/ChatService.ts tests/unit/chat/ChatService.compression.test.ts
git commit -m "feat(ask-tell): compress stale tool results in session history — prevents context bloat"
```

---

## Task 6: Final build + verify

- [ ] **Step 1: Run all new tests**

```bash
npm test -- --testPathPattern="compression" --no-coverage 2>&1 | tail -10
```
Expected: 5 pass.

- [ ] **Step 2: Full test suite**

```bash
npm test -- --no-coverage 2>&1 | grep -E "Tests:|Test Suites:" | tail -3
```
Expected: same pre-existing failures, no new failures.

- [ ] **Step 3: Full build**

```bash
npm run build 2>&1 | tail -8
```

- [ ] **Step 4: Manual verification checklist**

Reload Local. Verify:

1. **Persistence** — type a message in Ask/Tell, switch to Overview, switch back → message is still there
2. **New Task** — button is visible, dimmed when empty, bright when conversation exists, creates new session
3. **Task completion** — ask Claude to do a fleet task → response starts with "✓ Done:" after completing
4. **Warning** — send 10+ user messages → amber warning appears with "New Task" shortcut
5. **Compression** — in a long conversation, open browser devtools → check that old tool results in the session history are shorter than recent ones (requires network inspection or server logging)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ask-tell): context management complete — persistence, New Task, turn warning, compression"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Conversation persists across tab switches | Task 1 |
| "New Task" replaces/renames Clear button | Task 2 |
| Button dimmed when empty | Task 2 |
| System prompt signals completed work | Task 3 |
| Turn counter warning at threshold | Task 4 |
| Warning includes quick New Task button | Task 4 |
| Tool result compression for old turns | Task 5 |
| Compression preserves recent results | Task 5 |
| Compression only affects tool role | Task 5 |
| Tests for compression logic | Task 5 |

**Placeholder scan:** None found.

**Type consistency:**
- `handleNewTask()` defined Task 2, referenced in Tasks 2 and 4 ✓
- `compressStaleToolResults(messages: ChatMessage[]): ChatMessage[]` defined Task 5, called in Task 5 ✓
- `CHAT_CLEAR` IPC channel already exists in constants — no new channels needed ✓
- `this.state.messages.filter(m => m.role === 'user').length` in Task 4 — `UIMessage.role` is `'user' | 'assistant'`, so this filter is correct ✓
