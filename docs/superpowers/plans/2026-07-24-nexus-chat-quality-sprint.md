# Nexus Chat Quality Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four independent improvements to the Nexus docked chat panel: markdown rendering, streaming header status, tool result expansion, and ContextSelector wiring + LLM history reload on session resume.

**Architecture:** Three parallel worktrees (`chat-markdown`, `chat-streaming`, `chat-context`) work independently. Merge order: `chat-markdown` first, then `chat-context`, then `chat-streaming` (rebase onto `chat-markdown` since both touch `PanelChat.tsx`). All changes are in `src/renderer/components/DockedPanel/` and `src/main/chat/ChatService.ts`.

**Tech Stack:** TypeScript, React 16 class components (no JSX — use `React.createElement()`), `marked` (new dep), Jest, better-sqlite3, Electron IPC.

## Global Constraints

- No JSX anywhere — all renderer code uses `React.createElement()` only
- No React hooks — class components only
- `marked` must be imported as `import { marked } from 'marked'` (named export, v5+)
- `marked.parse()` is synchronous and returns `string` — use directly, no `await`
- Sanitize HTML: strip `<script>` and `<iframe>` tags from `marked` output before setting via `dangerouslySetInnerHTML`
- Test command: `npm test -- --testPathPattern=<path> --no-coverage`
- Build command: `npm run build`
- Commit after every task, not after every step

---

## Worktree A — `chat-markdown`

Create worktree: `git worktree add .worktrees/chat-markdown -b chat-markdown`

### Task A1: Install `marked` and add `.nexus-md` CSS

**Files:**
- Modify: `package.json`
- Modify: `src/renderer/styles/agent-console.css`

**Interfaces:**
- Produces: `marked` available for import in renderer; `.nexus-md` CSS class available globally

- [ ] **Step 1: Install marked**

```bash
npm install marked
```

- [ ] **Step 2: Verify marked is importable**

```bash
node -e "const { marked } = require('marked'); console.log(marked.parse('**bold**'));"
```
Expected output: `<p><strong>bold</strong></p>\n`

- [ ] **Step 3: Add `.nexus-md` rules to agent-console.css**

Append to the end of `src/renderer/styles/agent-console.css`:

```css
/* ── Markdown rendering in chat panel ─────────────────────────────────── */
.nexus-md { font-size: 13px; line-height: 1.55; color: #e4e7ec; }
.nexus-md p { margin: 0 0 8px; }
.nexus-md p:last-child { margin-bottom: 0; }
.nexus-md ul, .nexus-md ol { padding-left: 20px; margin: 4px 0 8px; }
.nexus-md li { margin-bottom: 3px; }
.nexus-md h1, .nexus-md h2, .nexus-md h3 { font-weight: 600; margin: 12px 0 6px; color: #f2f4f6; }
.nexus-md h1 { font-size: 16px; border-bottom: 1px solid #2c313a; padding-bottom: 4px; }
.nexus-md h2 { font-size: 14px; border-bottom: 1px solid #2c313a; padding-bottom: 3px; }
.nexus-md h3 { font-size: 13px; }
.nexus-md code { background: #1a1e24; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 12px; color: #5fd2e5; }
.nexus-md pre { background: #1a1e24; border-radius: 6px; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
.nexus-md pre code { background: none; padding: 0; color: #c9d1d9; font-size: 12px; }
.nexus-md table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
.nexus-md th { background: #1a1e24; color: #868d98; font-weight: 600; text-align: left; padding: 6px 10px; border-bottom: 1px solid #2c313a; }
.nexus-md td { padding: 5px 10px; border-bottom: 1px solid #23272f; }
.nexus-md tr:last-child td { border-bottom: none; }
.nexus-md a { color: #29b6cf; text-decoration: none; }
.nexus-md a:hover { text-decoration: underline; }
.nexus-md blockquote { border-left: 3px solid #29b6cf; margin: 8px 0; padding: 4px 12px; color: #868d98; }
.nexus-md hr { border: none; border-top: 1px solid #2c313a; margin: 12px 0; }
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/styles/agent-console.css
git commit -m "feat(chat): add marked dep and .nexus-md CSS rules"
```

---

### Task A2: Render assistant messages as markdown

**Files:**
- Modify: `src/renderer/components/DockedPanel/PanelChat.tsx`
- Test: `tests/unit/renderer/panel-chat-markdown.test.ts`

**Interfaces:**
- Consumes: `marked` from `'marked'`; `.nexus-md` CSS class from Task A1
- Produces: `renderMarkdown(content: string): string` — sanitized HTML string

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panel-chat-markdown.test.ts`:

```typescript
import { renderMarkdown } from '../../../src/renderer/components/DockedPanel/PanelChat';

describe('renderMarkdown', () => {
  it('converts bold to <strong>', () => {
    const html = renderMarkdown('**hello**');
    expect(html).toContain('<strong>hello</strong>');
  });

  it('converts backtick code to <code>', () => {
    const html = renderMarkdown('`npm install`');
    expect(html).toContain('<code>npm install</code>');
  });

  it('converts fenced code block to <pre><code>', () => {
    const html = renderMarkdown('```\nconsole.log("hi")\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code>');
  });

  it('strips <script> tags', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips <iframe> tags', () => {
    const html = renderMarkdown('<iframe src="evil.com"></iframe>');
    expect(html).not.toContain('<iframe>');
  });

  it('converts bullet list to <ul><li>', () => {
    const html = renderMarkdown('- foo\n- bar');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>foo</li>');
    expect(html).toContain('<li>bar</li>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=panel-chat-markdown --no-coverage
```
Expected: FAIL — `renderMarkdown` not exported

- [ ] **Step 3: Add `renderMarkdown` export to PanelChat.tsx**

Add after the existing imports at the top of `src/renderer/components/DockedPanel/PanelChat.tsx`:

```typescript
import { marked } from 'marked';

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content) as string;
  // Strip script and iframe tags to prevent XSS
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern=panel-chat-markdown --no-coverage
```
Expected: PASS — 6 tests passing

- [ ] **Step 5: Update `renderMessage` to use markdown for assistant messages**

In `renderMessage` in `PanelChat.tsx`, find the `bubbleContent` block (around line 590) and the assistant bubble render. Replace:

```typescript
// BEFORE — find this block:
const bubbleStyle = msg.role === 'user' ? styles.userBubble : styles.assistantBubble;
// ...
const bubbleContent = msg.content
  ? msg.content
  : msg.streaming
  ? React.createElement('span', { style: { color: '#868d98', letterSpacing: '0.15em', opacity: 0.7 } }, '· · ·')
  : '';

return React.createElement(
  'div',
  { key: msg.id },
  React.createElement('div', { style: bubbleStyle }, bubbleContent),
  ...toolCards,
);
```

```typescript
// AFTER:
const bubbleStyle = msg.role === 'user' ? styles.userBubble : {
  ...styles.assistantBubble,
  whiteSpace: 'normal' as const,  // markdown handles whitespace
};

let bubbleElement: React.ReactNode;
if (msg.role === 'assistant') {
  if (msg.streaming && !msg.content) {
    bubbleElement = React.createElement(
      'div',
      { style: { ...styles.assistantBubble, whiteSpace: 'normal' as const } },
      React.createElement('span', { style: { color: '#868d98', letterSpacing: '0.15em', opacity: 0.7 } }, '· · ·'),
    );
  } else {
    bubbleElement = React.createElement('div', {
      style: { ...styles.assistantBubble, whiteSpace: 'normal' as const },
      className: 'nexus-md',
      dangerouslySetInnerHTML: { __html: renderMarkdown(msg.content) },
    });
  }
} else {
  // User bubble — plain text, no markdown
  bubbleElement = React.createElement('div', { style: styles.userBubble }, msg.content);
}

return React.createElement(
  'div',
  { key: msg.id },
  bubbleElement,
  ...toolCards,
);
```

- [ ] **Step 6: Remove `whiteSpace: 'pre-wrap'` from `assistantBubble` style**

Find `assistantBubble` in the `styles` object near the top of PanelChat.tsx and remove the `whiteSpace` line:

```typescript
assistantBubble: {
  alignSelf: 'flex-start',
  background: '#2c313a',
  color: '#e4e7ec',
  borderRadius: '2px 12px 12px 12px',
  padding: '8px 12px',
  fontSize: 13,
  maxWidth: 580,
  wordBreak: 'break-word' as const,
  // whiteSpace: 'pre-wrap' — removed; markdown renderer handles whitespace
},
```

- [ ] **Step 7: Build to check for TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/DockedPanel/PanelChat.tsx tests/unit/renderer/panel-chat-markdown.test.ts
git commit -m "feat(chat): render assistant messages as markdown via marked"
```

---

## Worktree B — `chat-streaming`

Create worktree: `git worktree add .worktrees/chat-streaming -b chat-streaming`

**Important:** After both A and B are implemented, rebase B onto A before merging (`git rebase chat-markdown`) since both modify `PanelChat.tsx`.

### Task B1: Thread streaming header status

**Files:**
- Modify: `src/renderer/components/DockedPanel/DockedPanelContainer.tsx`
- Modify: `src/renderer/components/DockedPanel/PanelChat.tsx`

**Interfaces:**
- Produces: `onStreamingStatusChange: (status: string | null) => void` prop on `PanelChat`
- Produces: `streamingStatus: string | null` state in `DockedPanelContainer`

- [ ] **Step 1: Add `streamingStatus` to `DockedPanelContainer` state**

In `DockedPanelContainer.tsx`, find the `ContainerState` type and add the field:

```typescript
// Find the ContainerState type (near top of file) and add:
interface ContainerState {
  open: boolean;
  size: 'docked' | 'full';
  activeSessionId: string | null;
  showSessions: boolean;
  sessionListVersion: number;
  streamingStatus: string | null;  // ADD THIS
}
```

In `readState()`, add `streamingStatus: null` to the returned object:

```typescript
// In the try block return:
return {
  open: false,
  size: parsed.size === 'full' ? 'full' : 'docked',
  activeSessionId: parsed.activeSessionId ?? null,
  showSessions: false,
  sessionListVersion: 0,
  streamingStatus: null,  // ADD THIS
};
// In the fallback return:
return { open: false, size: 'docked', activeSessionId: null, showSessions: false, sessionListVersion: 0, streamingStatus: null };
```

- [ ] **Step 2: Pass `onStreamingStatusChange` to PanelChat and `streamingStatus` to DockedPanel**

In `DockedPanelContainer.render()`, find where PanelChat is created and add the prop:

```typescript
const panelContent = React.createElement(PanelChat, {
  electron: this.props.electron,
  sessionId: activeSessionId,
  selectedSiteIds: [],
  onSessionCreated: (id: string) => this.setState({ activeSessionId: id }),
  onSessionSaved: () => this.setState((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),
  onStreamingStatusChange: (status: string | null) => this.setState({ streamingStatus: status }),  // ADD
});
```

Find where DockedPanel is created and pass the prop:

```typescript
return React.createElement(
  DockedPanel,
  {
    open,
    size,
    onOpen: this.openPanel,
    onClose: this.closePanel,
    onSetSize: this.setSize,
    onNewChat: this.newChat,
    sessionsSidebar,
    showSessions,
    onToggleSessions: () => this.setState((s) => ({ showSessions: !s.showSessions })),
    streamingStatus: this.state.streamingStatus,  // ADD
  },
  panelContent,
);
```

- [ ] **Step 3: Add `onStreamingStatusChange` to PanelChat Props interface**

In `PanelChat.tsx`, find the `Props` interface and add:

```typescript
interface Props {
  electron: any;
  sessionId: string | null;
  selectedSiteIds: string[];
  onSessionCreated: (id: string) => void;
  onSessionSaved: (session: ChatSession, messages: ChatMessage[]) => void;
  onStreamingStatusChange?: (status: string | null) => void;  // ADD
}
```

- [ ] **Step 4: Call `onStreamingStatusChange` at the right stream events**

In `onStreamEvent()` in `PanelChat.tsx`, update the three relevant branches:

```typescript
// In the tool_call_start branch — add after the setState:
} else if (event.type === 'tool_call_start') {
  this.setState((s) => { /* existing setState */ });
  this.props.onStreamingStatusChange?.(`Running ${toolDisplayName(event.name)}…`);  // ADD

// In the done branch — add after setState callback:
} else if (event.type === 'done') {
  this.setState(
    (s) => ({ /* existing */ }),
    () => {
      this.persistSession();
      this.props.onStreamingStatusChange?.(null);  // ADD
    },
  );

// In the error branch — add null call:
} else if (event.type === 'error') {
  this.setState({ /* existing */ });
  this.props.onStreamingStatusChange?.(null);  // ADD
```

Also call it in `componentWillUnmount` for cleanup:

```typescript
componentWillUnmount() {
  // existing cleanup...
  this.props.onStreamingStatusChange?.(null);  // ADD at end
}
```

- [ ] **Step 5: Build to check for TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/DockedPanel/DockedPanelContainer.tsx src/renderer/components/DockedPanel/PanelChat.tsx
git commit -m "feat(chat): thread streamingStatus from PanelChat to DockedPanel header"
```

---

### Task B2: Tool result expansion

**Files:**
- Modify: `src/renderer/components/DockedPanel/PanelChat.tsx`
- Test: `tests/unit/renderer/tool-result-expansion.test.ts`

**Interfaces:**
- Consumes: `renderMarkdown(content: string): string` — NOTE: this is defined in Task A2. If working before Task A is merged, stub it locally as `(s: string) => s` in tests only.
- Produces: `expandedTools: Set<string>` in PanelChat state; updated `UIMessage.toolCalls` to include `result?: string`

- [ ] **Step 1: Add `result` field to the tool call type and `expandedTools` to State**

In `PanelChat.tsx`, find where the inline tool call type is defined. Look for `{ id: string; name: string; args: string; status: ... }` and add `result`:

```typescript
// Find the toolCalls push in onStreamEvent and update the type used there.
// Also find the UIMessage interface (or inline type). Add result field:
// In the tool_call_result branch of onStreamEvent, capture the result:
} else if (event.type === 'tool_call_result') {
  this.setState((s) => ({
    messages: s.messages.map((m) => ({
      ...m,
      toolCalls: (m.toolCalls ?? []).map((tc) =>
        tc.id === event.id
          ? { ...tc, status: 'done' as const, result: event.result ?? '' }  // ADD result
          : tc,
      ),
    })),
  }));
```

Add `expandedTools` to the State interface:

```typescript
interface State {
  messages: UIMessage[];
  input: string;
  streaming: boolean;
  streamingId: string | null;
  providerId: string;
  model: string;
  activeSessionId: string | null;
  offline: boolean;
  actionCount: number;
  retentionDays: number | null;
  expandedTools: Set<string>;  // ADD
}
```

Initialize in constructor:

```typescript
// In constructor where state is initialized, add:
expandedTools: new Set<string>(),
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/renderer/tool-result-expansion.test.ts`:

```typescript
describe('tool result expansion state', () => {
  it('expandedTools starts empty', () => {
    const expanded = new Set<string>();
    expect(expanded.size).toBe(0);
  });

  it('toggling adds then removes a tool id', () => {
    let expanded = new Set<string>();
    const id = 'abc123';

    // Add
    expanded = new Set(expanded);
    expanded.add(id);
    expect(expanded.has(id)).toBe(true);

    // Remove
    expanded = new Set(expanded);
    expanded.delete(id);
    expect(expanded.has(id)).toBe(false);
  });

  it('result text is formatted as JSON when parseable object', () => {
    const raw = '{"count":3,"sites":["a","b","c"]}';
    let display: string;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        display = JSON.stringify(parsed, null, 2);
      } else {
        display = raw;
      }
    } catch {
      display = raw;
    }
    expect(display).toContain('"count": 3');
  });

  it('truncates long results at 2000 chars', () => {
    const long = 'x'.repeat(3000);
    const truncated = long.length > 2000 ? long.slice(0, 2000) + '…' : long;
    expect(truncated.length).toBe(2001); // 2000 + ellipsis
    expect(truncated.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it passes (logic tests, no component needed)**

```bash
npm test -- --testPathPattern=tool-result-expansion --no-coverage
```
Expected: PASS — 4 tests

- [ ] **Step 4: Update `renderMessage` to show done chips and expansion panel**

In `renderMessage` in `PanelChat.tsx`, update the `toolCards` block. Replace the existing filter/map:

```typescript
// BEFORE:
const toolCards = (msg.toolCalls ?? [])
  .filter((tc) => tc.status === 'running' || tc.status === 'awaiting_approval')
  .map((tc) => { /* existing */ });

// AFTER:
const { expandedTools } = this.state;

const toolCards = (msg.toolCalls ?? [])
  .filter((tc) => tc.status !== 'done' || tc.result !== undefined)  // show all non-hidden
  .map((tc) => {
    if (tc.status === 'running') {
      return React.createElement(
        'div',
        {
          key: tc.id,
          style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 0', color: '#868d98', fontSize: 12,
          },
        },
        React.createElement('span', { style: { color: '#5fd2e5', fontSize: 13 } }, '⚡'),
        React.createElement('span', null, tc.name),
        React.createElement('span', { style: { opacity: 0.5 } }, '…'),
      );
    }
    if (tc.status === 'awaiting_approval') {
      return React.createElement(ActionCard, {
        key: tc.id,
        title: toolDisplayName(tc.name),
        effect: toolEffect(tc.name),
        destructive: tc.name in TOOL_EFFECTS,
        onConfirm: () => {
          this.handleApprove(tc.id);
          try { track(this.props.electron.ipcRenderer, 'nexus_panel_action_confirmed', { destructive: false }); } catch (_) {}
          this.inputRef.current?.focus();
        },
        onCancel: () => { this.handleCancel(tc.id); this.inputRef.current?.focus(); },
      });
    }
    // status === 'done'
    if (tc.result === undefined) return null;
    const isExpanded = expandedTools.has(tc.id);
    const rawResult = tc.result ?? '';
    let displayResult: string;
    try {
      const parsed = JSON.parse(rawResult);
      displayResult = typeof parsed === 'object' && parsed !== null
        ? JSON.stringify(parsed, null, 2)
        : rawResult;
    } catch {
      displayResult = rawResult;
    }
    const truncated = displayResult.length > 2000
      ? displayResult.slice(0, 2000) + '…'
      : displayResult;

    return React.createElement(
      'div',
      { key: tc.id },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 0', color: '#868d98', fontSize: 12, cursor: 'pointer',
            userSelect: 'none' as const,
          },
          onClick: () => {
            this.setState((s) => {
              const next = new Set(s.expandedTools);
              next.has(tc.id) ? next.delete(tc.id) : next.add(tc.id);
              return { expandedTools: next };
            });
          },
        },
        React.createElement('span', { style: { color: '#22c55e', fontSize: 13 } }, '✓'),
        React.createElement('span', null, toolDisplayName(tc.name)),
        React.createElement(
          'span',
          { style: { fontSize: 10, opacity: 0.6, marginLeft: 2 } },
          isExpanded ? '▾' : '▸',
        ),
      ),
      isExpanded
        ? React.createElement(
            'div',
            {
              style: {
                marginTop: 4,
                marginBottom: 4,
                borderLeft: '2px solid #29b6cf',
                paddingLeft: 10,
                fontSize: 12,
                color: '#c9d1d9',
                maxHeight: 300,
                overflowY: 'auto' as const,
                background: '#1a1e24',
                borderRadius: '0 4px 4px 0',
              },
            },
            React.createElement('pre', {
              style: { margin: 0, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
            }, truncated),
          )
        : null,
    );
  })
  .filter(Boolean);
```

- [ ] **Step 5: Verify the `tool_call_result` event carries `result`**

Check `src/main/chat/ChatService.ts` — find where `tool_call_result` is emitted. Add `result` to the emit call if not present:

```typescript
// Find the emit call for tool_call_result — it looks like:
this.emit(sessionId, { type: 'tool_call_result', id: tc.id });
// Update to:
this.emit(sessionId, { type: 'tool_call_result', id: tc.id, result: result.text ?? '' });
```

- [ ] **Step 6: Build to check for TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/DockedPanel/PanelChat.tsx src/main/chat/ChatService.ts tests/unit/renderer/tool-result-expansion.test.ts
git commit -m "feat(chat): keep tool chips visible after execution with expandable result panel"
```

---

## Worktree C — `chat-context`

Create worktree: `git worktree add .worktrees/chat-context -b chat-context`

### Task C1: Wire ContextSelector into DockedPanelContainer

**Files:**
- Modify: `src/renderer/components/DockedPanel/DockedPanelContainer.tsx`
- Test: `tests/unit/renderer/docked-panel-container.test.ts` (extend existing)

**Interfaces:**
- Produces: `selectedSiteIds: string[]` state in `DockedPanelContainer`; `ContextSelector` rendered in panel body

- [ ] **Step 1: Add `selectedSiteIds` to ContainerState and initialize**

In `DockedPanelContainer.tsx`, find the `ContainerState` interface and add the field:

```typescript
interface ContainerState {
  open: boolean;
  size: 'docked' | 'full';
  activeSessionId: string | null;
  showSessions: boolean;
  sessionListVersion: number;
  selectedSiteIds: string[];  // ADD
}
```

In `readState()` — add `selectedSiteIds: []` to both return paths:

```typescript
return {
  open: false,
  size: parsed.size === 'full' ? 'full' : 'docked',
  activeSessionId: parsed.activeSessionId ?? null,
  showSessions: false,
  sessionListVersion: 0,
  selectedSiteIds: [],  // ADD
};
// fallback:
return { open: false, size: 'docked', activeSessionId: null, showSessions: false, sessionListVersion: 0, selectedSiteIds: [] };
```

- [ ] **Step 2: Render ContextSelector and pass selectedSiteIds to PanelChat**

In `DockedPanelContainer.render()`:

```typescript
// At the top of render(), destructure selectedSiteIds:
const { open, size, activeSessionId, showSessions, sessionListVersion, selectedSiteIds } = this.state;

// Replace the hardcoded selectedSiteIds: [] in the PanelChat createElement:
const panelContent = React.createElement(PanelChat, {
  electron: this.props.electron,
  sessionId: activeSessionId,
  selectedSiteIds,              // was []; now from state
  onSessionCreated: (id: string) => this.setState({ activeSessionId: id }),
  onSessionSaved: () => this.setState((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),
});

// Wrap panelContent with ContextSelector above it:
const panelBody = React.createElement(
  'div',
  { style: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' } },
  React.createElement(ContextSelector, {
    electron: this.props.electron,
    selectedSiteIds,
    onChange: (ids: string[]) => this.setState({ selectedSiteIds: ids }),
  }),
  panelContent,
);
```

Then pass `panelBody` instead of `panelContent` to the DockedPanel `children`:

```typescript
return React.createElement(
  DockedPanel,
  {
    open, size, onOpen: this.openPanel, onClose: this.closePanel,
    onSetSize: this.setSize, onNewChat: this.newChat,
    sessionsSidebar, showSessions,
    onToggleSessions: () => this.setState((s) => ({ showSessions: !s.showSessions })),
  },
  panelBody,  // was panelContent
);
```

- [ ] **Step 3: Check ContextSelector Props interface matches what we pass**

```bash
grep -n "interface.*Props\|electron\|selectedSiteIds\|onChange" src/renderer/components/DockedPanel/ContextSelector.tsx | head -15
```

Verify the component accepts `{ electron: any; selectedSiteIds: string[]; onChange: (ids: string[]) => void }`. If prop names differ, adjust accordingly.

- [ ] **Step 4: Build to check for TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/DockedPanel/DockedPanelContainer.tsx
git commit -m "feat(chat): wire ContextSelector — site-specific context now flows to ChatService"
```

---

### Task C2: Restore LLM history on session resume

**Files:**
- Modify: `src/main/chat/ChatService.ts`
- Test: `tests/unit/chat/chat-service-history.test.ts`

**Interfaces:**
- Consumes: `getSession(db, sessionId)` from `'../ipc/chat-sessions'` — returns `{ session: ChatSession; messages: ChatMessage[] } | null`
- Consumes: `this.services.graphService?.getDb()` — returns `Database.Database | null`
- Produces: resumed sessions have full message history fed to LLM

- [ ] **Step 1: Add import for `getSession` in ChatService.ts**

At the top of `src/main/chat/ChatService.ts`, add:

```typescript
import { getSession } from '../ipc/chat-sessions';
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/chat/chat-service-history.test.ts`:

```typescript
// Unit test for the history reconstruction logic in isolation
// (avoids the full ChatService constructor which needs many deps)

import type { ChatMessage } from '../../../src/common/types';

function reconstructHistory(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => !((m as any).streaming))
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => ({ role: m.role, content: m.content }));
}

describe('history reconstruction for LLM resume', () => {
  it('maps user and assistant messages to role+content pairs', () => {
    const messages: ChatMessage[] = [
      { id: '1', sessionId: 's', role: 'system', content: 'You are helpful.', timestamp: 1 },
      { id: '2', sessionId: 's', role: 'user', content: 'Hello', timestamp: 2 },
      { id: '3', sessionId: 's', role: 'assistant', content: 'Hi there!', timestamp: 3 },
    ];
    const history = reconstructHistory(messages);
    expect(history).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('filters out streaming messages', () => {
    const messages: ChatMessage[] = [
      { id: '1', sessionId: 's', role: 'user', content: 'Hello', timestamp: 1 },
      { id: '2', sessionId: 's', role: 'assistant', content: '', timestamp: 2, streaming: true } as any,
    ];
    const history = reconstructHistory(messages);
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('user');
  });

  it('returns empty array for no messages', () => {
    expect(reconstructHistory([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npm test -- --testPathPattern=chat-service-history --no-coverage
```
Expected: PASS — 3 tests

- [ ] **Step 4: Add history reload in `ChatService.sendMessage`**

In `src/main/chat/ChatService.ts`, find `sendMessage`. In the `if (!session)` block (around line 119), replace:

```typescript
// BEFORE:
if (!session) {
  session = {
    id: sessionId,
    messages: [],
    abortController: new AbortController(),
    pendingApprovals: new Map(),
  };
  const systemPrompt = await this.buildSystemPrompt(siteId);
  session.messages.push({ role: 'system', content: systemPrompt });
  this.sessions.set(sessionId, session);
}
```

```typescript
// AFTER:
if (!session) {
  const abortController = new AbortController();
  const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; toolName: string; args: Record<string, unknown> }>();

  // Attempt to restore persisted history so Claude remembers prior turns
  const db = this.services.graphService?.getDb();
  const persisted = db ? getSession(db, sessionId) : null;

  if (persisted && persisted.messages.length > 0) {
    // Reconstruct message array from persisted records
    const history = persisted.messages
      .filter((m: any) => !m.streaming)
      .filter((m: any) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map((m: any) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));

    session = { id: sessionId, messages: history, abortController, pendingApprovals };
  } else {
    // Fresh session — build system prompt
    const systemPrompt = await this.buildSystemPrompt(siteId);
    session = {
      id: sessionId,
      messages: [{ role: 'system', content: systemPrompt }],
      abortController,
      pendingApprovals,
    };
  }

  this.sessions.set(sessionId, session);
}
```

- [ ] **Step 5: Build to check for TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/chat/ChatService.ts tests/unit/chat/chat-service-history.test.ts
git commit -m "feat(chat): restore LLM message history on session resume after addon restart"
```

---

## Merge Order

Run these from the main repo root after all three worktrees are complete and green:

```bash
# 1. Merge markdown first
git checkout main
git merge chat-markdown --no-ff -m "feat(chat): markdown rendering via marked"

# 2. Rebase streaming onto updated main (which now has chat-markdown)
git checkout chat-streaming
git rebase main
git checkout main
git merge chat-streaming --no-ff -m "feat(chat): streaming header status + tool result expansion"

# 3. Merge context (independent, no conflicts expected)
git merge chat-context --no-ff -m "feat(chat): ContextSelector wiring + LLM history reload on resume"
```

---

## Full Test Run After Merge

```bash
npm test -- --no-coverage
```

Check that these test files all pass:
- `tests/unit/renderer/panel-chat-markdown.test.ts` (6 tests)
- `tests/unit/renderer/tool-result-expansion.test.ts` (4 tests)
- `tests/unit/chat/chat-service-history.test.ts` (3 tests)
- `tests/unit/renderer/docked-panel-container.test.ts` (existing tests still passing)
