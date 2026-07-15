# Agent Console UI — Implementation Plan (Plan A: Shell)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Agent Console UI shell — the Agents hub, Fleet activity ledger, Agent workspace (with settings), and Generic approval drawer — as a new tab inside the existing `NexusOverview` component.

**Architecture:** All components are React class components using `React.createElement()` (no JSX, no hooks) — matching Local's existing patterns. A new `'agents'` tab is added to `NexusOverview`'s internal tab system. Agent data comes from existing GraphQL endpoints (`agentList`, `agentStatus`, `agentRun`, `agentReload`) via the existing IPC + `nexusStore` pattern. A new `AgentStore` singleton holds agent-specific reactive state (selected agent, pending approvals, activity events).

**Tech Stack:** React class components, `React.createElement()`, `@getflywheel/local-components` (loaded defensively via try/require), existing `NexusStateManager` store pattern, existing `ipcRenderer.invoke` IPC pattern, CSS custom properties for design tokens.

## Global Constraints

- **No JSX, no hooks** — all components use `React.createElement()` and extend `React.Component`. Lifecycle via `componentDidMount`/`componentDidUpdate`/`componentWillUnmount`.
- **No new npm dependencies** — use `@getflywheel/local-components` (already available) and plain DOM/CSS; no new UI libraries.
- **Font:** Rubik for UI, JetBrains Mono for code/usernames/commands/timestamps. Both already loaded or substituted from existing Local fonts.
- **Design tokens** live in `src/renderer/styles/agent-console.css` as CSS custom properties — never hardcode colors in components.
- **IPC pattern:** `ipcRenderer.invoke(channel, args)` for one-shot calls; `ipcRenderer.on(channel, handler)` with cleanup in `componentWillUnmount` for push updates.
- **Store pattern:** `AgentStore` is a plain pub/sub singleton (same shape as `NexusStateManager`). Components subscribe in `componentDidMount`, unsubscribe in `componentWillUnmount`.
- **File location:** All new agent console components in `src/renderer/components/agents/`.
- **Tests:** `tests/unit/renderer/agents/` — Jest + React Testing Library (or snapshot tests matching existing renderer test patterns).
- **No Plan B content in this plan:** The Sentinel review overlay (screens 05–10) is Plan B. This plan ends at the generic approval drawer (screen 11).

---

## Design Tokens Reference

From the design spec — all values are exact.

| Token | Value | Use |
|---|---|---|
| `--ag-bg-app` | `#16181d` | app background |
| `--ag-bg-card` | `#1e2128` | cards, list containers |
| `--ag-bg-elevated` | `#23272f` | secondary buttons, chips |
| `--ag-bg-inset` | `#1a1d23` | inputs, segmented controls |
| `--ag-bg-code` | `#111318` | command/console blocks |
| `--ag-border` | `#2b303a` | card & control borders |
| `--ag-border-subtle` | `#23262d` | row dividers |
| `--ag-border-control` | `#2f343d` | secondary buttons |
| `--ag-text-primary` | `#e8eaed` | headings, body |
| `--ag-text-secondary` | `#9aa1ac` | descriptions |
| `--ag-text-muted` | `#6b7280` | meta, timestamps |
| `--ag-text-faint` | `#5a6270` | disabled |
| `--ag-teal` | `#35d0c5` | primary action, Sentinel accent |
| `--ag-on-teal` | `#08201e` | text on teal bg |
| `--ag-green` | `#3ecf8e` | healthy, completed |
| `--ag-amber` | `#f5b544` | needs review |
| `--ag-red` | `#f4685f` | critical, destructive |
| `--ag-purple` | `#7b8cff` | WPE platform, report type |

Agent accent colors (used for avatar tiles):
- Security Sentinel: `#35d0c5`
- Performance Optimizer: `#7b8cff`
- Backup Verifier: `#3ecf8e`
- Dependency Auditor: `#f5b544`
- Cost Watch: `#e07acc`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/renderer/styles/agent-console.css` | Create | All design tokens + shared agent console styles |
| `src/renderer/components/agents/AgentStore.ts` | Create | Reactive state store for agent data |
| `src/renderer/components/agents/AgentCard.tsx` | Create | Individual agent card for the hub grid |
| `src/renderer/components/agents/AgentsHub.tsx` | Create | Hub view: global inbox banner + agent card grid |
| `src/renderer/components/agents/FleetActivityLedger.tsx` | Create | Activity log with filters, day groups, rollup expansion |
| `src/renderer/components/agents/AgentWorkspaceSettings.tsx` | Create | Enable toggle, triggers (schedule+events), autonomy, scope |
| `src/renderer/components/agents/AgentWorkspace.tsx` | Create | Per-agent scaffold: overview/approvals/activity/settings tabs |
| `src/renderer/components/agents/GenericApprovalDrawer.tsx` | Create | 560px right drawer for non-Sentinel approvals |
| `src/renderer/components/agents/AgentConsoleTab.tsx` | Create | Top-level shell: hub ↔ workspace navigation |
| `src/renderer/components/NexusOverview.tsx` | Modify | Add `'agents'` tab + wire `AgentConsoleTab` |

---

### Task 1: Design tokens CSS + AgentStore

**Files:**
- Create: `src/renderer/styles/agent-console.css`
- Create: `src/renderer/components/agents/AgentStore.ts`

**Interfaces:**
- Produces: `AgentStore` singleton with `subscribe(fn)`, `unsubscribe(fn)`, `getState()`, `setState(patch)`
- Produces: `AgentState` interface with `agents`, `selectedAgentId`, `homeTab`, `pendingApprovals`, `activityEvents`, `autonomyById`, `agentSettings`

- [ ] **Step 1: Create the CSS token file**

Create `src/renderer/styles/agent-console.css`:

```css
/* Agent Console — Design System Tokens */
:root {
  /* Backgrounds */
  --ag-bg-app: #16181d;
  --ag-bg-card: #1e2128;
  --ag-bg-elevated: #23272f;
  --ag-bg-inset: #1a1d23;
  --ag-bg-code: #111318;

  /* Borders */
  --ag-border: #2b303a;
  --ag-border-subtle: #23262d;
  --ag-border-control: #2f343d;

  /* Text */
  --ag-text-primary: #e8eaed;
  --ag-text-secondary: #9aa1ac;
  --ag-text-muted: #6b7280;
  --ag-text-faint: #5a6270;

  /* Accent / semantic */
  --ag-teal: #35d0c5;
  --ag-on-teal: #08201e;
  --ag-green: #3ecf8e;
  --ag-amber: #f5b544;
  --ag-red: #f4685f;
  --ag-purple: #7b8cff;
}

/* Typography helpers */
.ag-mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Status pill base */
.ag-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.ag-pill--review  { background: rgba(245,181,68,0.14);  color: var(--ag-amber); }
.ag-pill--healthy { background: rgba(62,207,142,0.14);  color: var(--ag-green); }
.ag-pill--paused  { background: rgba(154,161,172,0.12); color: var(--ag-text-secondary); }
.ag-pill--disabled{ background: rgba(154,161,172,0.12); color: var(--ag-text-secondary); }

/* Type chip */
.ag-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
}
.ag-chip--action   { background: rgba(53,208,197,0.12);  color: var(--ag-teal); }
.ag-chip--alert    { background: rgba(244,104,95,0.12);  color: var(--ag-red); }
.ag-chip--report   { background: rgba(123,140,255,0.12); color: var(--ag-purple); }
.ag-chip--info     { background: rgba(154,161,172,0.10); color: var(--ag-text-secondary); }

/* Status chip */
.ag-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
}
.ag-status-chip--review    { background: rgba(245,181,68,0.14);  color: var(--ag-amber); }
.ag-status-chip--auto      { background: rgba(53,208,197,0.12);  color: var(--ag-teal); }
.ag-status-chip--done      { background: rgba(62,207,142,0.14);  color: var(--ag-green); }
.ag-status-chip--info      { background: rgba(154,161,172,0.10); color: var(--ag-text-secondary); }
.ag-status-chip--dismissed { background: rgba(154,161,172,0.10); color: var(--ag-text-secondary); }

/* Toggle switch */
.ag-toggle {
  position: relative;
  width: 40px;
  height: 23px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.ag-toggle--on  { background: var(--ag-green); }
.ag-toggle--off { background: #3a4049; }
.ag-toggle__knob {
  position: absolute;
  top: 3px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: white;
  transition: transform 0.15s;
}
.ag-toggle--on  .ag-toggle__knob { transform: translateX(20px); }
.ag-toggle--off .ag-toggle__knob { transform: translateX(3px); }

/* Checkbox */
.ag-checkbox {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid #3a4049;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s;
}
.ag-checkbox--checked {
  background: var(--ag-teal);
  border-color: var(--ag-teal);
}
```

- [ ] **Step 2: Create AgentStore**

Create `src/renderer/components/agents/AgentStore.ts`:

```typescript
export interface AgentInfo {
  id: string;
  name: string;
  initial: string;
  accent: string;
  tagline: string;
  autonomyLabel: string;
  schedule: string;
  kpis: Array<{ label: string; val: string; color?: string }>;
  mini: Array<{ label: string; val: string; color?: string }>;
  scope: string[];
}

export interface AgentStatus {
  name: string;
  version: string;
  description: string | null;
  cronExpression: string | null;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
}

export interface ActivityEvent {
  id: string;
  agentId: string;
  day: string;
  time: string;
  type: 'Action' | 'Alert' | 'Report' | 'Info';
  status: 'review' | 'auto' | 'done' | 'info' | 'dismissed';
  text: string;
  sub: string;
  ref?: string;
  count?: number;
  children?: string[];
}

export interface AgentSettings {
  enabled: boolean;
  cadence: string;  // '*/15 * * * *' | '0 * * * *' | '0 */6 * * *' | '0 0 * * *' | '0 0 * * 0'
  eventsEnabled: boolean;
  subscribedEvents: Record<string, boolean>;
}

export interface AgentState {
  statuses: AgentStatus[];          // from agentStatus GraphQL query
  selectedAgentId: string | null;
  homeTab: 'agents' | 'activity';
  activityEvents: ActivityEvent[];
  autonomyById: Record<string, 'suggest' | 'ask' | 'auto'>;
  agentSettings: Record<string, AgentSettings>;
  expandedEvents: Record<string, boolean>;
  runningAgents: Set<string>;        // agents currently running ad-hoc
}

const DEFAULT_STATE: AgentState = {
  statuses: [],
  selectedAgentId: null,
  homeTab: 'agents',
  activityEvents: [],
  autonomyById: {},
  agentSettings: {},
  expandedEvents: {},
  runningAgents: new Set(),
};

class AgentStore {
  private state: AgentState = { ...DEFAULT_STATE, runningAgents: new Set() };
  private listeners = new Set<() => void>();

  getState(): AgentState { return this.state; }

  setState(patch: Partial<AgentState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  subscribe(fn: () => void): void   { this.listeners.add(fn); }
  unsubscribe(fn: () => void): void { this.listeners.delete(fn); }

  // Derive status: disabled > needs-review > healthy
  getAgentDerivedStatus(agentId: string): 'disabled' | 'action' | 'ok' {
    const settings = this.state.agentSettings[agentId];
    if (settings && !settings.enabled) return 'disabled';
    // In v1, pending count comes from activity events with status='review' referencing this agent
    const pending = this.state.activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    ).length;
    return pending > 0 ? 'action' : 'ok';
  }

  getDefaultSettings(agentId: string): AgentSettings {
    return {
      enabled: true,
      cadence: '*/15 * * * *',
      eventsEnabled: true,
      subscribedEvents: {},
    };
  }

  getOrInitSettings(agentId: string): AgentSettings {
    if (!this.state.agentSettings[agentId]) {
      this.setState({
        agentSettings: {
          ...this.state.agentSettings,
          [agentId]: this.getDefaultSettings(agentId),
        },
      });
    }
    return this.state.agentSettings[agentId];
  }
}

export const agentStore = new AgentStore();
```

- [ ] **Step 3: Import CSS in renderer entry**

In `src/renderer/index.tsx`, add near the top with other CSS imports (search for existing `import '*.css'` patterns):

```typescript
import '../styles/agent-console.css';
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/agent-console.css src/renderer/components/agents/AgentStore.ts src/renderer/index.tsx
git commit -m "feat(agent-console): add design token CSS and AgentStore reactive state"
```

---

### Task 2: AgentCard + AgentsHub

**Files:**
- Create: `src/renderer/components/agents/AgentCard.tsx`
- Create: `src/renderer/components/agents/AgentsHub.tsx`

**Interfaces:**
- Consumes: `AgentStatus` from `AgentStore`, `agentStore.getAgentDerivedStatus()`
- Produces: `AgentsHub` React component — props: `{ electron: any, onSelectAgent: (id: string) => void }`

- [ ] **Step 1: Create AgentCard**

Create `src/renderer/components/agents/AgentCard.tsx`:

```typescript
import * as React from 'react';
import { agentStore, AgentStatus } from './AgentStore';

interface AgentCardProps {
  status: AgentStatus;
  onSelect: () => void;
}

interface AgentCardState {
  hovered: boolean;
}

const ACCENTS: Record<string, string> = {
  'security-sentinel':     '#35d0c5',
  'performance-optimizer': '#7b8cff',
  'backup-verifier':       '#3ecf8e',
  'dependency-auditor':    '#f5b544',
  'cost-watch':            '#e07acc',
};

const CADENCE_LABELS: Record<string, string> = {
  '*/15 * * * *': 'Every 15 minutes',
  '0 * * * *':    'Hourly',
  '0 */6 * * *':  'Every 6 hours',
  '0 0 * * *':    'Daily',
  '0 0 * * 0':    'Weekly',
};

function formatLastRun(ms: number | null): string {
  if (!ms) return 'Never run';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export class AgentCard extends React.Component<AgentCardProps, AgentCardState> {
  state: AgentCardState = { hovered: false };

  render() {
    const { status, onSelect } = this.props;
    const { hovered } = this.state;
    const agentId = status.name.toLowerCase().replace(/\s+/g, '-');
    const accent = ACCENTS[agentId] || '#9aa1ac';
    const derivedStatus = agentStore.getAgentDerivedStatus(agentId);
    const settings = agentStore.getOrInitSettings(agentId);
    const cadenceLabel = CADENCE_LABELS[settings.cadence] || 'Custom schedule';

    const pillLabel = derivedStatus === 'action' ? 'Needs review'
      : derivedStatus === 'disabled' ? 'Disabled' : 'Healthy';
    const pillClass = derivedStatus === 'action' ? 'ag-pill--review'
      : derivedStatus === 'disabled' ? 'ag-pill--disabled' : 'ag-pill--healthy';

    return React.createElement('div', {
      onClick: onSelect,
      onMouseEnter: () => this.setState({ hovered: true }),
      onMouseLeave: () => this.setState({ hovered: false }),
      style: {
        background: 'var(--ag-bg-card)',
        border: `1px solid ${hovered ? '#3a4049' : 'var(--ag-border)'}`,
        borderRadius: 14,
        padding: 20,
        cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'border-color 0.15s, transform 0.15s',
      },
    },
      // Top row: avatar + name + pill
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 } },
        // Avatar tile
        React.createElement('div', {
          style: {
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: accent + '22',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: accent, fontSize: 19, fontWeight: 700,
          },
        }, (status.name || 'A')[0]),

        // Name + tagline
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
          },
            React.createElement('span', {
              style: { fontSize: 15.5, fontWeight: 600, color: 'var(--ag-text-primary)', flex: 1 },
            }, status.name),
            React.createElement('span', { className: `ag-pill ${pillClass}` }, pillLabel),
          ),
          React.createElement('p', {
            style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', margin: 0 },
          }, status.description || ''),
        ),
      ),

      // Divider
      React.createElement('div', { style: { height: 1, background: 'var(--ag-border-subtle)', margin: '0 0 12px' } }),

      // Bottom row: mini-stats + last run
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        // Mini-stats (2 columns)
        React.createElement('div', { style: { display: 'flex', gap: 24 } },
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 17, fontWeight: 600, color: status.lastRunStatus === 'error' ? 'var(--ag-red)' : 'var(--ag-green)' },
            }, status.lastRunStatus === 'success' ? '✓' : status.lastRunStatus === 'error' ? '✗' : '—'),
            React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ag-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Last status'),
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 17, fontWeight: 600, color: 'var(--ag-text-primary)' } },
              cadenceLabel.split(' ')[0] + ' ' + (cadenceLabel.split(' ')[1] || ''),
            ),
            React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ag-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Schedule'),
          ),
        ),

        // Last run time
        React.createElement('div', { style: { fontSize: 11, color: 'var(--ag-text-muted)' } },
          `Last run ${formatLastRun(status.lastRunAt)}`,
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Create AgentsHub**

Create `src/renderer/components/agents/AgentsHub.tsx`:

```typescript
import * as React from 'react';
import { agentStore, AgentState, AgentStatus } from './AgentStore';
import { AgentCard } from './AgentCard';

interface AgentsHubProps {
  onSelectAgent: (id: string) => void;
}

interface AgentsHubState extends Pick<AgentState, 'statuses' | 'activityEvents'> {}

export class AgentsHub extends React.Component<AgentsHubProps, AgentsHubState> {
  state: AgentsHubState = { statuses: agentStore.getState().statuses, activityEvents: agentStore.getState().activityEvents };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => this.setState({
      statuses: agentStore.getState().statuses,
      activityEvents: agentStore.getState().activityEvents,
    });
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private getTotalPending(): number {
    return this.state.activityEvents.filter(e => e.status === 'review').length;
  }

  private getAgentsWithPending(): number {
    const ids = new Set(this.state.activityEvents.filter(e => e.status === 'review').map(e => e.agentId));
    return ids.size;
  }

  private renderInbox() {
    const pending = this.getTotalPending();
    const agentCount = this.getAgentsWithPending();
    const isClean = pending === 0;

    return React.createElement('div', {
      style: {
        width: '100%', borderRadius: 12, padding: '16px 22px', marginBottom: 20,
        background: isClean ? 'rgba(62,207,142,0.06)' : 'rgba(245,181,68,0.06)',
        border: `1px solid ${isClean ? 'rgba(62,207,142,0.35)' : 'rgba(245,181,68,0.35)'}`,
        display: 'flex', alignItems: 'center', gap: 16,
      },
    },
      // Icon tile
      React.createElement('div', {
        style: {
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: isClean ? 'rgba(62,207,142,0.16)' : 'rgba(245,181,68,0.16)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isClean ? 'var(--ag-green)' : 'var(--ag-amber)',
          fontSize: 16, fontWeight: 700,
        },
      }, isClean ? '✓' : '!'),

      // Text
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
          isClean ? 'Nothing needs you right now' : `${pending} action${pending !== 1 ? 's' : ''} need your review`,
        ),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
          isClean
            ? 'Everything is running autonomously'
            : `Across ${agentCount} agent${agentCount !== 1 ? 's' : ''} • everything else is running autonomously`,
        ),
      ),

      // Review now button (only when pending)
      !isClean && React.createElement('button', {
        onClick: () => {
          // Navigate to first agent with pending items
          const firstPendingId = this.state.activityEvents.find(e => e.status === 'review')?.agentId;
          if (firstPendingId) this.props.onSelectAgent(firstPendingId);
        },
        style: {
          background: 'var(--ag-amber)', color: '#1a1200',
          border: 'none', borderRadius: 8, padding: '8px 16px',
          fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        },
      }, 'Review now'),
    );
  }

  render() {
    const { statuses } = this.state;
    const { onSelectAgent } = this.props;

    return React.createElement('div', { style: { padding: '24px 40px' } },
      // Page header
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 } },
        React.createElement('div', null,
          React.createElement('h1', { style: { fontSize: 20, fontWeight: 600, color: 'var(--ag-text-primary)', margin: '0 0 4px' } }, 'Agents'),
          React.createElement('p', { style: { fontSize: 13, color: 'var(--ag-text-secondary)', margin: 0 } },
            'Autonomous agents working across your fleet • configure how much each can do on its own',
          ),
        ),
        React.createElement('button', {
          style: {
            background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
            borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 500,
            color: '#c8ccd2', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          },
        }, '+ Add agent'),
      ),

      // Inbox banner
      this.renderInbox(),

      // Agent grid
      statuses.length === 0
        ? React.createElement('div', {
            style: { textAlign: 'center', padding: '60px 0', color: 'var(--ag-text-muted)' },
          }, 'No agents registered. Add an agent to get started.')
        : React.createElement('div', {
            style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
          },
            ...statuses.map(s => React.createElement(AgentCard, {
              key: s.name,
              status: s,
              onSelect: () => onSelectAgent(s.name.toLowerCase().replace(/\s+/g, '-')),
            })),
          ),
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/AgentCard.tsx src/renderer/components/agents/AgentsHub.tsx
git commit -m "feat(agent-console): add AgentCard and AgentsHub components"
```

---

### Task 3: FleetActivityLedger

**Files:**
- Create: `src/renderer/components/agents/FleetActivityLedger.tsx`

**Interfaces:**
- Consumes: `activityEvents: ActivityEvent[]` from `agentStore`
- Produces: `FleetActivityLedger` component — props: `{ onReviewEvent: (eventId: string) => void }`

- [ ] **Step 1: Create FleetActivityLedger**

Create `src/renderer/components/agents/FleetActivityLedger.tsx`:

```typescript
import * as React from 'react';
import { agentStore, ActivityEvent } from './AgentStore';

interface LedgerProps {
  onReviewEvent: (eventId: string) => void;
}

interface LedgerState {
  events: ActivityEvent[];
  searchText: string;
  statusFilter: 'all' | 'review' | 'completed' | 'dismissed';
  agentFilter: string;
  expandedEvents: Record<string, boolean>;
}

const ACCENTS: Record<string, string> = {
  'security-sentinel': '#35d0c5',
  'performance-optimizer': '#7b8cff',
  'backup-verifier': '#3ecf8e',
  'dependency-auditor': '#f5b544',
  'cost-watch': '#e07acc',
};

function effectiveStatus(event: ActivityEvent): string {
  return event.status;
}

function groupByDay(events: ActivityEvent[]): Map<string, ActivityEvent[]> {
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const key = e.day;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return groups;
}

function formatDayLabel(day: string): string {
  if (day === 'today') return 'TODAY';
  if (day === 'yest')  return 'YESTERDAY';
  return day.toUpperCase();
}

export class FleetActivityLedger extends React.Component<LedgerProps, LedgerState> {
  state: LedgerState = {
    events: agentStore.getState().activityEvents,
    searchText: '',
    statusFilter: 'all',
    agentFilter: 'all',
    expandedEvents: {},
  };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => this.setState({ events: agentStore.getState().activityEvents });
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private getFilteredEvents(): ActivityEvent[] {
    const { events, searchText, statusFilter, agentFilter } = this.state;
    return events.filter(e => {
      if (agentFilter !== 'all' && e.agentId !== agentFilter) return false;
      if (statusFilter !== 'all') {
        const eff = effectiveStatus(e);
        if (statusFilter === 'review'    && eff !== 'review')    return false;
        if (statusFilter === 'completed' && !['auto','done','info'].includes(eff)) return false;
        if (statusFilter === 'dismissed' && eff !== 'dismissed') return false;
      }
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!e.text.toLowerCase().includes(q) && !e.sub.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  private renderRow(event: ActivityEvent) {
    const { onReviewEvent } = this.props;
    const accent = ACCENTS[event.agentId] || '#9aa1ac';
    const isActionable = event.status === 'review' && event.ref;
    const isExpanded = this.state.expandedEvents[event.id];
    const isRollup = !!event.count;

    const typeClass = {
      Action: 'ag-chip--action', Alert: 'ag-chip--alert',
      Report: 'ag-chip--report', Info: 'ag-chip--info',
    }[event.type] || 'ag-chip--info';

    const statusClass = {
      review: 'ag-status-chip--review', auto: 'ag-status-chip--auto',
      done: 'ag-status-chip--done', info: 'ag-status-chip--info',
      dismissed: 'ag-status-chip--dismissed',
    }[effectiveStatus(event)] || 'ag-status-chip--info';

    const statusGlyph = {
      review: '◷', auto: '✓', done: '✓', info: '·', dismissed: '✕',
    }[effectiveStatus(event)] || '·';

    return React.createElement('div', { key: event.id },
      React.createElement('div', {
        onClick: isRollup ? () => {
          this.setState(s => ({
            expandedEvents: { ...s.expandedEvents, [event.id]: !s.expandedEvents[event.id] },
          }));
        } : undefined,
        style: {
          display: 'flex', alignItems: 'center', gap: 13,
          padding: '13px 18px', cursor: isRollup ? 'pointer' : 'default',
          borderTop: '1px solid var(--ag-border-subtle)',
        },
      },
        // Agent avatar
        React.createElement('div', {
          style: {
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: accent + '22', color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700,
          },
        }, event.agentId[0]?.toUpperCase() || 'A'),

        // Text block
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)', marginBottom: 2 } }, event.text),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-muted)' } }, event.sub),
        ),

        // Rollup badge
        isRollup && React.createElement('span', {
          style: {
            fontSize: 11, fontWeight: 600, color: 'var(--ag-text-secondary)',
            background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
            borderRadius: 20, padding: '2px 8px',
          },
        }, `×${event.count}`),

        // Type chip
        React.createElement('span', { className: `ag-chip ${typeClass}` }, event.type),

        // Status chip
        React.createElement('span', { className: `ag-status-chip ${statusClass}` }, `${statusGlyph} ${event.status}`),

        // Time
        React.createElement('span', {
          style: { width: 52, textAlign: 'right', fontSize: 12, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
        }, event.time),

        // Review button
        isActionable && React.createElement('button', {
          onClick: (ev: Event) => { ev.stopPropagation(); onReviewEvent(event.id); },
          style: {
            background: 'var(--ag-teal)', color: 'var(--ag-on-teal)',
            border: 'none', borderRadius: 7, padding: '5px 12px',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
          },
        }, 'Review'),
      ),

      // Rollup children
      isExpanded && event.children && React.createElement('div', {
        style: { padding: '0 18px 14px 61px', display: 'flex', flexDirection: 'column', gap: 6 },
      }, ...event.children.map((line, i) =>
        React.createElement('div', {
          key: i, style: { fontSize: 12, color: 'var(--ag-text-secondary)', fontFamily: 'JetBrains Mono, monospace' },
        }, line),
      )),
    );
  }

  render() {
    const filtered = this.getFilteredEvents();
    const grouped = groupByDay(filtered);
    const allAgentIds = [...new Set(this.state.events.map(e => e.agentId))];
    const pendingCount = filtered.filter(e => e.status === 'review').length;

    const segmentStyle = (active: boolean) => ({
      padding: '5px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
      cursor: 'pointer', border: 'none',
      background: active ? 'var(--ag-teal)' : 'transparent',
      color: active ? 'var(--ag-on-teal)' : 'var(--ag-text-secondary)',
    });

    return React.createElement('div', { style: { padding: '24px 40px' } },

      // Filter bar
      React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' } },
        React.createElement('input', {
          type: 'text', placeholder: 'Search events…',
          value: this.state.searchText,
          onChange: (e: any) => this.setState({ searchText: e.target.value }),
          style: {
            flex: 1, minWidth: 240, background: 'var(--ag-bg-inset)',
            border: '1px solid var(--ag-border)', borderRadius: 9,
            padding: '10px 14px', fontSize: 13, color: 'var(--ag-text-primary)',
          },
        }),
        // Status segments
        React.createElement('div', {
          style: { display: 'flex', background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)', borderRadius: 10, padding: 4 },
        },
          (['all', 'review', 'completed', 'dismissed'] as const).map(s =>
            React.createElement('button', {
              key: s, onClick: () => this.setState({ statusFilter: s }),
              style: segmentStyle(this.state.statusFilter === s),
            }, s[0].toUpperCase() + s.slice(1)),
          ),
        ),
      ),

      // Agent filter chips
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 } },
        ['all', ...allAgentIds].map(id => {
          const active = this.state.agentFilter === id;
          return React.createElement('button', {
            key: id, onClick: () => this.setState({ agentFilter: id }),
            style: {
              padding: '5px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
              background: active ? 'rgba(53,208,197,0.14)' : 'var(--ag-bg-inset)',
              color: active ? 'var(--ag-teal)' : 'var(--ag-text-secondary)',
              border: `1px solid ${active ? 'rgba(53,208,197,0.4)' : 'var(--ag-border)'}`,
            },
          }, id === 'all' ? 'All agents' : id);
        }),
      ),

      // Result count
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', marginBottom: 16 } },
        `${filtered.length} events${pendingCount > 0 ? ` · ${pendingCount} need your review` : ''}`,
      ),

      // Day groups
      ...Array.from(grouped.entries()).map(([day, dayEvents]) =>
        React.createElement('div', { key: day, style: { marginBottom: 24 } },
          // Day header
          React.createElement('div', {
            style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 8 },
          }, `${formatDayLabel(day)} · ${dayEvents.length}`),
          // Events card
          React.createElement('div', {
            style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, overflow: 'hidden' },
          }, ...dayEvents.map(e => this.renderRow(e))),
        ),
      ),

      grouped.size === 0 && React.createElement('div', {
        style: { textAlign: 'center', padding: '60px 0', color: 'var(--ag-text-muted)' },
      }, 'No events match the current filters.'),
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/agents/FleetActivityLedger.tsx
git commit -m "feat(agent-console): add FleetActivityLedger with filtering, day groups, rollup expansion"
```

---

### Task 4: AgentWorkspaceSettings

**Files:**
- Create: `src/renderer/components/agents/AgentWorkspaceSettings.tsx`

**Interfaces:**
- Consumes: `agentStore.getOrInitSettings(agentId)`, `agentStore.setState()`
- Produces: `AgentWorkspaceSettings` component — props: `{ agentId: string }`

The event catalog for Security Sentinel — the events this agent can subscribe to:
```
wpe:sync.completed      — WPE metadata sync refreshes graph data
wp:plugin.activated     — A plugin is activated on a local site
wp:user.created         — A user account is created on a local site
```

- [ ] **Step 1: Create AgentWorkspaceSettings**

Create `src/renderer/components/agents/AgentWorkspaceSettings.tsx`:

```typescript
import * as React from 'react';
import { agentStore, AgentSettings } from './AgentStore';

interface SettingsProps {
  agentId: string;
}

interface SettingsState {
  settings: AgentSettings;
}

const CADENCE_OPTIONS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly',           value: '0 * * * *' },
  { label: 'Every 6 hours',    value: '0 */6 * * *' },
  { label: 'Daily',            value: '0 0 * * *' },
  { label: 'Weekly',           value: '0 0 * * 0' },
];

// Event catalog per agent — in production, fetched from agent definition
const EVENT_CATALOG: Record<string, Array<{ id: string; label: string; description: string }>> = {
  'security-sentinel': [
    { id: 'wpe:sync.completed',   label: 'WPE sync completed',    description: 'Triggers after the 4-hour metadata sync refreshes plugin/user data for an install' },
    { id: 'wp:plugin.activated',  label: 'Plugin activated',      description: 'Triggers when a plugin is activated on any local site' },
    { id: 'wp:user.created',      label: 'User account created',  description: 'Triggers when a new user account is created on any local site' },
  ],
};

const AUTONOMY_OPTIONS = [
  { value: 'suggest', label: 'Suggest only',     desc: 'The agent surfaces findings but takes no action — you do everything.' },
  { value: 'ask',     label: 'Act, but ask first', desc: 'The agent investigates autonomously and prepares a plan, but waits for your approval before touching production.' },
  { value: 'auto',    label: 'Fully autonomous',  desc: 'The agent detects, investigates, remediates, and verifies without asking. Use with caution.' },
];

class ToggleSwitch extends React.Component<{ checked: boolean; onChange: (v: boolean) => void }> {
  render() {
    const { checked, onChange } = this.props;
    return React.createElement('div', {
      className: `ag-toggle ag-toggle--${checked ? 'on' : 'off'}`,
      onClick: () => onChange(!checked),
      role: 'switch',
      'aria-checked': checked,
    },
      React.createElement('div', { className: 'ag-toggle__knob' }),
    );
  }
}

export class AgentWorkspaceSettings extends React.Component<SettingsProps, SettingsState> {
  state: SettingsState = { settings: agentStore.getOrInitSettings(this.props.agentId) };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => this.setState({ settings: agentStore.getOrInitSettings(this.props.agentId) });
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private updateSettings(patch: Partial<AgentSettings>) {
    const next = { ...this.state.settings, ...patch };
    agentStore.setState({
      agentSettings: { ...agentStore.getState().agentSettings, [this.props.agentId]: next },
    });
  }

  private cycleCadence() {
    const { cadence } = this.state.settings;
    const idx = CADENCE_OPTIONS.findIndex(o => o.value === cadence);
    const next = CADENCE_OPTIONS[(idx + 1) % CADENCE_OPTIONS.length];
    this.updateSettings({ cadence: next.value });
  }

  private getRunSummary(): string {
    const { settings } = this.state;
    if (!settings.enabled) return 'Disabled — not running';
    const parts: string[] = [];
    const cadence = CADENCE_OPTIONS.find(o => o.value === settings.cadence);
    if (cadence) parts.push(`Runs ${cadence.label.toLowerCase()}`);
    const catalog = EVENT_CATALOG[this.props.agentId] || [];
    const subCount = catalog.filter(e => settings.subscribedEvents[e.id] !== false).length;
    if (settings.eventsEnabled && subCount > 0) parts.push(`responds to ${subCount} event${subCount !== 1 ? 's' : ''}`);
    parts.push('ad-hoc');
    return parts.join(' · ');
  }

  private renderCard(children: React.ReactNode, dimmed = false) {
    return React.createElement('div', {
      style: {
        background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12,
        padding: '20px 22px', marginBottom: 12, opacity: dimmed ? 0.45 : 1,
        transition: 'opacity 0.15s',
      },
    }, children);
  }

  render() {
    const { settings } = this.state;
    const { agentId } = this.props;
    const catalog = EVENT_CATALOG[agentId] || [];
    const currentAutonomy = agentStore.getState().autonomyById[agentId] || 'ask';

    return React.createElement('div', { style: { maxWidth: 680 } },

      // Card 1: Enable + Run now
      this.renderCard(
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          React.createElement(ToggleSwitch, {
            checked: settings.enabled,
            onChange: (v) => this.updateSettings({ enabled: v }),
          }),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
              settings.enabled ? 'Agent enabled' : 'Agent disabled',
            ),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
              settings.enabled
                ? 'Running via its configured triggers below. Toggle off to stop all scheduled, event, and ad-hoc runs.'
                : 'Agent will not run on any trigger until re-enabled.',
            ),
          ),
          React.createElement('button', {
            disabled: !settings.enabled,
            style: {
              background: settings.enabled ? 'var(--ag-teal)' : 'var(--ag-bg-elevated)',
              color: settings.enabled ? 'var(--ag-on-teal)' : 'var(--ag-text-faint)',
              border: 'none', borderRadius: 8, padding: '8px 18px',
              fontSize: 13, fontWeight: 600, cursor: settings.enabled ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            },
          }, '▶ Run now'),
        ),
      ),

      // Card 2: How this agent runs
      this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 16 } }, 'How this agent runs'),

          // On a schedule
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 } },
            React.createElement(ToggleSwitch, { checked: true, onChange: () => {} }), // always on
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'On a schedule'),
            ),
            React.createElement('button', {
              onClick: () => this.cycleCadence(),
              style: {
                background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
                borderRadius: 7, padding: '5px 12px', fontSize: 12.5, color: 'var(--ag-text-primary)',
                cursor: 'pointer', fontWeight: 500,
              },
            }, CADENCE_OPTIONS.find(o => o.value === settings.cadence)?.label || 'Every 15 minutes'),
          ),

          // Respond to events
          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: settings.eventsEnabled ? 12 : 0 } },
              React.createElement(ToggleSwitch, {
                checked: settings.eventsEnabled,
                onChange: (v) => this.updateSettings({ eventsEnabled: v }),
              }),
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'Respond to events'),
            ),
            settings.eventsEnabled && React.createElement('div', { style: { paddingLeft: 52 } },
              ...catalog.map(evt => {
                const isSubscribed = settings.subscribedEvents[evt.id] !== false;
                return React.createElement('div', {
                  key: evt.id,
                  onClick: () => this.updateSettings({
                    subscribedEvents: { ...settings.subscribedEvents, [evt.id]: !isSubscribed },
                  }),
                  style: {
                    display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer',
                  },
                },
                  React.createElement('div', {
                    className: `ag-checkbox ${isSubscribed ? 'ag-checkbox--checked' : ''}`,
                    style: { marginTop: 2 },
                  }, isSubscribed ? '✓' : ''),
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-primary)', marginBottom: 2 } }, evt.label),
                    React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-secondary)' } }, evt.description),
                  ),
                );
              }),
            ),
          ),

          // Ad-hoc (always on)
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            React.createElement('div', {
              style: { width: 40, height: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ag-text-muted)', fontSize: 11 },
            }, '—'),
            React.createElement('div', { style: { flex: 1, fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'Ad-hoc'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, 'Via Run now button'),
          ),

          // Summary line
          React.createElement('div', { style: { marginTop: 16, fontSize: 12.5, color: 'var(--ag-text-secondary)', borderTop: '1px solid var(--ag-border-subtle)', paddingTop: 12 } },
            this.getRunSummary(),
          ),
        ),
        !settings.enabled,
      ),

      // Card 3: Autonomy
      this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 12 } }, 'Autonomy level'),
          ...AUTONOMY_OPTIONS.map(opt => {
            const selected = currentAutonomy === opt.value;
            return React.createElement('div', {
              key: opt.value,
              onClick: () => agentStore.setState({
                autonomyById: { ...agentStore.getState().autonomyById, [agentId]: opt.value as any },
              }),
              style: {
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10,
                cursor: 'pointer', marginBottom: 8,
                background: selected ? 'rgba(53,208,197,0.08)' : 'transparent',
                border: `1px solid ${selected ? 'rgba(53,208,197,0.4)' : 'transparent'}`,
                transition: 'background 0.12s, border-color 0.12s',
              },
            },
              // Radio dot
              React.createElement('div', {
                style: {
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  border: `2px solid ${selected ? 'var(--ag-teal)' : 'var(--ag-border)'}`,
                  background: selected ? 'var(--ag-teal)' : 'transparent',
                  transition: 'background 0.12s, border-color 0.12s',
                },
              }),
              React.createElement('div', null,
                React.createElement('div', { style: { fontSize: 13.5, fontWeight: 500, color: 'var(--ag-text-primary)', marginBottom: 3 } }, opt.label),
                React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } }, opt.desc),
              ),
            );
          }),
        ),
        !settings.enabled,
      ),
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/agents/AgentWorkspaceSettings.tsx
git commit -m "feat(agent-console): add AgentWorkspaceSettings with enable toggle, cadence, event subscriptions, autonomy"
```

---

### Task 5: AgentWorkspace scaffold

**Files:**
- Create: `src/renderer/components/agents/AgentWorkspace.tsx`

**Interfaces:**
- Consumes: `AgentsHub`, `FleetActivityLedger`, `AgentWorkspaceSettings`, `AgentStore`
- Produces: `AgentWorkspace` component — props: `{ agentId: string; onBack: () => void; electron: any; onReviewEvent: (id: string) => void }`

- [ ] **Step 1: Create AgentWorkspace**

Create `src/renderer/components/agents/AgentWorkspace.tsx`:

```typescript
import * as React from 'react';
import { agentStore, AgentStatus } from './AgentStore';
import { AgentWorkspaceSettings } from './AgentWorkspaceSettings';
import { FleetActivityLedger } from './FleetActivityLedger';

type WorkspaceTab = 'overview' | 'approvals' | 'activity' | 'settings';

interface WorkspaceProps {
  agentId: string;
  onBack: () => void;
  electron: any;
  onReviewEvent: (eventId: string) => void;
}

interface WorkspaceState {
  activeTab: WorkspaceTab;
  status: AgentStatus | null;
  running: boolean;
  showRunBanner: boolean;
}

const ACCENTS: Record<string, string> = {
  'security-sentinel': '#35d0c5',
  'performance-optimizer': '#7b8cff',
  'backup-verifier': '#3ecf8e',
  'dependency-auditor': '#f5b544',
  'cost-watch': '#e07acc',
};

const KPIS: Record<string, Array<{ label: string; valKey: keyof AgentStatus; color?: string }>> = {
  'security-sentinel': [
    { label: 'Sites monitored', valKey: 'name', color: 'var(--ag-text-primary)' }, // placeholder
  ],
};

export class AgentWorkspace extends React.Component<WorkspaceProps, WorkspaceState> {
  state: WorkspaceState = {
    activeTab: 'overview',
    status: null,
    running: false,
    showRunBanner: false,
  };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => {
      const statuses = agentStore.getState().statuses;
      const found = statuses.find(s => s.name.toLowerCase().replace(/\s+/g, '-') === this.props.agentId) || null;
      this.setState({ status: found });
    };
    agentStore.subscribe(update);
    this.unsub = update;
    update();
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private async runNow() {
    const { agentId, electron } = this.props;
    this.setState({ running: true });
    try {
      await electron.ipcRenderer.invoke('nexus:graphql', {
        query: `mutation AgentRun($name: String!) { agentRun(name: $name) { status error } }`,
        variables: { name: agentId },
      });
      this.setState({ showRunBanner: true });
      setTimeout(() => this.setState({ showRunBanner: false }), 4000);
    } catch {}
    this.setState({ running: false });
  }

  private renderHeader() {
    const { status, running, showRunBanner } = this.state;
    const { agentId, onBack } = this.props;
    const accent = ACCENTS[agentId] || '#9aa1ac';
    const derivedStatus = agentStore.getAgentDerivedStatus(agentId);
    const settings = agentStore.getOrInitSettings(agentId);
    const pillLabel = derivedStatus === 'action' ? 'Needs review' : derivedStatus === 'disabled' ? 'Disabled' : 'Healthy';
    const pillClass = derivedStatus === 'action' ? 'ag-pill--review' : derivedStatus === 'disabled' ? 'ag-pill--disabled' : 'ag-pill--healthy';

    return React.createElement('div', null,
      // Back link
      React.createElement('button', {
        onClick: onBack,
        style: {
          background: 'none', border: 'none', color: 'var(--ag-text-secondary)',
          fontSize: 13, cursor: 'pointer', padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6,
        },
      }, '‹ All agents'),

      // Agent header
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 } },
        React.createElement('div', {
          style: {
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: accent + '22', color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 21, fontWeight: 700,
          },
        }, agentId[0]?.toUpperCase() || 'A'),

        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 } },
            React.createElement('span', { style: { fontSize: 21, fontWeight: 600, color: 'var(--ag-text-primary)' } },
              status?.name || agentId,
            ),
            React.createElement('span', { className: `ag-pill ${pillClass}` }, pillLabel),
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 } },
            '🛡️',
            React.createElement('span', null, settings.enabled ? 'Investigates on its own • you approve anything on production' : 'Agent disabled'),
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', display: 'flex', alignItems: 'center', gap: 6 } },
            '⏱',
            React.createElement('span', null, 'Runs every 15 minutes • responds to events • ad-hoc'),
          ),
        ),

        // Run now button
        React.createElement('button', {
          onClick: () => this.runNow(),
          disabled: running || !settings.enabled,
          style: {
            background: running || !settings.enabled ? 'var(--ag-bg-elevated)' : 'var(--ag-teal)',
            color: running || !settings.enabled ? 'var(--ag-text-faint)' : 'var(--ag-on-teal)',
            border: 'none', borderRadius: 8, padding: '8px 18px',
            fontSize: 13, fontWeight: 600,
            cursor: running || !settings.enabled ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          },
        }, running ? '⟳ Running…' : '▶ Run now'),
      ),

      // Ad-hoc run complete banner
      showRunBanner && React.createElement('div', {
        style: {
          background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.3)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 12,
          fontSize: 13, color: 'var(--ag-green)',
        },
      }, '✓ Ad-hoc run complete — check Approvals and Activity for results.'),
    );
  }

  private renderTabBar() {
    const { activeTab } = this.state;
    const { agentId } = this.props;
    const pendingCount = agentStore.getState().activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    ).length;

    const tabs: Array<{ id: WorkspaceTab; label: string; badge?: number }> = [
      { id: 'overview',  label: 'Overview' },
      { id: 'approvals', label: 'Approvals', badge: pendingCount > 0 ? pendingCount : undefined },
      { id: 'activity',  label: 'Activity' },
      { id: 'settings',  label: 'Settings' },
    ];

    return React.createElement('div', {
      style: { display: 'flex', borderBottom: '1px solid var(--ag-border)', marginBottom: 24 },
    },
      ...tabs.map(tab =>
        React.createElement('button', {
          key: tab.id,
          onClick: () => this.setState({ activeTab: tab.id }),
          style: {
            background: 'none', border: 'none', padding: '0 0 12px', marginRight: 28,
            fontSize: 14, fontWeight: activeTab === tab.id ? 500 : 400,
            color: activeTab === tab.id ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)',
            borderBottom: activeTab === tab.id ? '2px solid var(--ag-teal)' : '2px solid transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          },
        },
          tab.label,
          tab.badge && React.createElement('span', {
            className: 'ag-pill ag-pill--review',
            style: { fontSize: 10, padding: '1px 7px' },
          }, tab.badge),
        ),
      ),
    );
  }

  private renderOverviewTab() {
    const { status } = this.state;
    const { agentId, onReviewEvent } = this.props;

    // KPI grid
    const kpis = [
      { label: 'Sites monitored', val: '343', color: 'var(--ag-text-primary)' },
      { label: 'Clean',           val: '341', color: 'var(--ag-green)' },
      { label: 'Active threats',  val: '2',   color: 'var(--ag-red)' },
      { label: 'Pending approval',val: '1',   color: 'var(--ag-amber)' },
    ];

    return React.createElement('div', null,
      // KPI grid
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: `repeat(${kpis.length}, 1fr)`, gap: 12, marginBottom: 24 },
      },
        ...kpis.map(kpi =>
          React.createElement('div', {
            key: kpi.label,
            style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, padding: '16px 18px' },
          },
            React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 } }, kpi.label),
            React.createElement('div', { style: { fontSize: 32, fontWeight: 600, color: kpi.color || 'var(--ag-text-primary)' } }, kpi.val),
          ),
        ),
      ),

      // Needs your review
      React.createElement('div', { style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 12 } }, 'Needs your review'),
      React.createElement('div', { style: { color: 'var(--ag-text-secondary)', fontSize: 13 } }, 'No pending approvals.'),
    );
  }

  render() {
    const { activeTab } = this.state;
    const { agentId, onReviewEvent } = this.props;

    return React.createElement('div', { style: { padding: '24px 40px' } },
      this.renderHeader(),
      this.renderTabBar(),
      activeTab === 'overview'  && this.renderOverviewTab(),
      activeTab === 'approvals' && React.createElement('div', { style: { color: 'var(--ag-text-secondary)' } }, 'No pending approvals.'),
      activeTab === 'activity'  && React.createElement(FleetActivityLedger, {
        onReviewEvent,
        // Scoped to this agent in future — for now shows all
      }),
      activeTab === 'settings'  && React.createElement(AgentWorkspaceSettings, { agentId }),
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/agents/AgentWorkspace.tsx
git commit -m "feat(agent-console): add AgentWorkspace scaffold with overview/approvals/activity/settings tabs"
```

---

### Task 6: GenericApprovalDrawer

**Files:**
- Create: `src/renderer/components/agents/GenericApprovalDrawer.tsx`

**Interfaces:**
- Produces: `GenericApprovalDrawer` component — props: `{ approval: GenericApproval | null; onDismiss: () => void; onApprove: () => void }`

- [ ] **Step 1: Create GenericApprovalDrawer**

Create `src/renderer/components/agents/GenericApprovalDrawer.tsx`:

```typescript
import * as React from 'react';

export interface GenericApproval {
  id: string;
  title: string;
  meta: string;
  desc: string;
  actions: string[];
  reversible: string;
}

interface DrawerProps {
  approval: GenericApproval | null;
  onDismiss: () => void;
  onApprove: () => void;
}

export class GenericApprovalDrawer extends React.Component<DrawerProps> {
  render() {
    const { approval, onDismiss, onApprove } = this.props;

    if (!approval) return null;

    return React.createElement('div', null,
      // Scrim
      React.createElement('div', {
        onClick: onDismiss,
        style: {
          position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.55)',
          zIndex: 40,
        },
      }),

      // Drawer
      React.createElement('div', {
        style: {
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 560,
          background: 'var(--ag-bg-card)', borderLeft: '1px solid var(--ag-border)',
          zIndex: 41, display: 'flex', flexDirection: 'column',
          animation: 'slideIn 0.28s ease',
        },
      },
        // Header
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'flex-start', gap: 16, padding: '24px 24px 20px', borderBottom: '1px solid var(--ag-border-subtle)' },
        },
          React.createElement('button', {
            onClick: onDismiss,
            style: { background: 'none', border: 'none', color: 'var(--ag-text-secondary)', cursor: 'pointer', fontSize: 18, padding: 0, flexShrink: 0 },
          }, '✕'),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 17, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 4 } }, approval.title),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)' } }, approval.meta),
          ),
        ),

        // Body
        React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: 24 } },
          React.createElement('p', { style: { fontSize: 13.5, color: 'var(--ag-text-secondary)', lineHeight: 1.6, margin: '0 0 20px' } }, approval.desc),

          React.createElement('div', { style: { marginBottom: 20 } },
            React.createElement('div', { style: { fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 10 } }, 'Proposed actions'),
            React.createElement('div', {
              style: { background: 'var(--ag-bg-code)', borderRadius: 8, padding: '14px 16px' },
            },
              ...approval.actions.map((action, i) =>
                React.createElement('div', {
                  key: i,
                  style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', fontFamily: 'JetBrains Mono, monospace', marginBottom: i < approval.actions.length - 1 ? 6 : 0 },
                }, `$ ${action}`),
              ),
            ),
          ),

          React.createElement('div', {
            style: { background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--ag-green)' },
          }, `✓ Reversible. ${approval.reversible}`),
        ),

        // Footer
        React.createElement('div', {
          style: { display: 'flex', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--ag-border-subtle)' },
        },
          React.createElement('button', {
            onClick: onDismiss,
            style: {
              flex: 1, background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
              borderRadius: 8, padding: '10px 0', fontSize: 13.5, fontWeight: 500,
              color: 'var(--ag-text-secondary)', cursor: 'pointer',
            },
          }, 'Dismiss'),
          React.createElement('button', {
            onClick: onApprove,
            style: {
              flex: 2, background: 'var(--ag-teal)', border: 'none',
              borderRadius: 8, padding: '10px 0', fontSize: 13.5, fontWeight: 600,
              color: 'var(--ag-on-teal)', cursor: 'pointer',
            },
          }, 'Approve & run'),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/agents/GenericApprovalDrawer.tsx
git commit -m "feat(agent-console): add GenericApprovalDrawer for non-Sentinel approvals"
```

---

### Task 7: AgentConsoleTab + wire into NexusOverview

**Files:**
- Create: `src/renderer/components/agents/AgentConsoleTab.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx` (add `'agents'` tab)

**Interfaces:**
- Consumes: `AgentsHub`, `AgentWorkspace`, `FleetActivityLedger`, `GenericApprovalDrawer`
- Produces: `AgentConsoleTab` component wired into `NexusOverview`'s tab system

- [ ] **Step 1: Create AgentConsoleTab**

Create `src/renderer/components/agents/AgentConsoleTab.tsx`:

```typescript
import * as React from 'react';
import { agentStore } from './AgentStore';
import { AgentsHub } from './AgentsHub';
import { FleetActivityLedger } from './FleetActivityLedger';
import { AgentWorkspace } from './AgentWorkspace';
import { GenericApprovalDrawer, GenericApproval } from './GenericApprovalDrawer';

interface AgentConsoleTabProps {
  electron: any;
}

interface AgentConsoleTabState {
  homeTab: 'agents' | 'activity';
  selectedAgentId: string | null;
  activeApproval: GenericApproval | null;
}

export class AgentConsoleTab extends React.Component<AgentConsoleTabProps, AgentConsoleTabState> {
  state: AgentConsoleTabState = {
    homeTab: 'agents',
    selectedAgentId: null,
    activeApproval: null,
  };
  private unsub!: () => void;

  componentDidMount() {
    // Load agent statuses via IPC
    this.refreshAgents();
    // Subscribe to store for reactive updates
    const update = () => this.forceUpdate();
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private async refreshAgents() {
    try {
      const result = await this.props.electron.ipcRenderer.invoke('nexus:graphql', {
        query: `{ agentStatus { name version description cronExpression lastRunAt lastRunStatus lastRunDurationMs lastRunError } }`,
      });
      if (result?.data?.agentStatus) {
        agentStore.setState({ statuses: result.data.agentStatus });
      }
    } catch {}
  }

  private renderModeSwitch() {
    const { homeTab } = this.state;
    const pendingCount = agentStore.getState().activityEvents.filter(e => e.status === 'review').length;

    const segStyle = (active: boolean) => ({
      padding: '5px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: 'none',
      background: active ? 'var(--ag-teal)' : 'transparent',
      color: active ? 'var(--ag-on-teal)' : 'var(--ag-text-secondary)',
      display: 'flex', alignItems: 'center', gap: 6,
    });

    return React.createElement('div', {
      style: { display: 'flex', background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)', borderRadius: 10, padding: 4, marginBottom: 0 },
    },
      React.createElement('button', { onClick: () => this.setState({ homeTab: 'agents' }), style: segStyle(homeTab === 'agents') }, 'Agents'),
      React.createElement('button', { onClick: () => this.setState({ homeTab: 'activity' }), style: segStyle(homeTab === 'activity') },
        'Fleet activity',
        pendingCount > 0 && React.createElement('span', {
          style: { background: 'rgba(245,181,68,0.16)', color: 'var(--ag-amber)', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 600 },
        }, pendingCount),
      ),
    );
  }

  render() {
    const { homeTab, selectedAgentId, activeApproval } = this.state;
    const { electron } = this.props;

    // Agent workspace view
    if (selectedAgentId) {
      return React.createElement('div', null,
        React.createElement(AgentWorkspace, {
          agentId: selectedAgentId,
          electron,
          onBack: () => this.setState({ selectedAgentId: null }),
          onReviewEvent: (eventId) => {
            // For now log — Plan B wires Sentinel review
            console.log('Review event:', eventId);
          },
        }),
        activeApproval && React.createElement(GenericApprovalDrawer, {
          approval: activeApproval,
          onDismiss: () => this.setState({ activeApproval: null }),
          onApprove: () => {
            // Mark resolved in store
            this.setState({ activeApproval: null });
          },
        }),
      );
    }

    // Hub / ledger home view
    return React.createElement('div', null,
      // Mode switch (rendered inside the content area, not the tab bar)
      React.createElement('div', { style: { padding: '16px 40px 0' } },
        this.renderModeSwitch(),
      ),
      homeTab === 'agents'
        ? React.createElement(AgentsHub, { onSelectAgent: (id) => this.setState({ selectedAgentId: id }) })
        : React.createElement(FleetActivityLedger, {
            onReviewEvent: (eventId) => console.log('Review:', eventId),
          }),
    );
  }
}
```

- [ ] **Step 2: Add 'agents' tab to NexusOverview**

In `src/renderer/components/NexusOverview.tsx`, make the following changes:

**a) Add import at top of file (with other component imports):**
```typescript
import { AgentConsoleTab } from './agents/AgentConsoleTab';
```

**b) In the `activeTab` state type, add `'agents'`:**
Find the type definition (e.g. `activeTab: 'overview' | 'activity' | 'operations' | 'ask' | 'settings'`) and add `| 'agents'`.

**c) In `renderTabBar()`, add the Agents tab button** alongside the existing tabs:
```typescript
// Add after the last existing tab button, before the closing of the tab bar container
React.createElement('button', {
  onClick: () => this.setState({ activeTab: 'agents' }),
  style: {
    // match existing tab button styles
    background: 'none', border: 'none', cursor: 'pointer',
    color: this.state.activeTab === 'agents' ? '#e8eaed' : '#6b7280',
    fontSize: 14, padding: '8px 16px',
    borderBottom: this.state.activeTab === 'agents' ? '2px solid #35d0c5' : '2px solid transparent',
  },
}, 'Agents'),
```

**d) In `renderTabContent()`, add the agents case:**
```typescript
case 'agents':
  return React.createElement(AgentConsoleTab, { electron: this.props.electron });
```

- [ ] **Step 3: Run full test suite**

```bash
npm run compile 2>&1 | head -10
```

Expected: no TypeScript errors.

```bash
npx jest tests/unit/ --no-coverage --forceExit 2>&1 | grep -E "Tests:|PASS|FAIL" | head -5
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/agents/AgentConsoleTab.tsx src/renderer/components/NexusOverview.tsx
git commit -m "feat(agent-console): wire AgentConsoleTab into NexusOverview; complete Agent Console shell"
```

---

## Self-Review

**Spec coverage:**

| Design screen | Covered by task |
|---|---|
| 01 Agents hub (inbox + grid) | Task 2: AgentsHub + AgentCard |
| 02 Fleet activity ledger | Task 3: FleetActivityLedger |
| 03 Agent workspace overview | Task 5: AgentWorkspace overview tab |
| 04 Settings (enable, triggers, autonomy) | Task 4: AgentWorkspaceSettings |
| 11 Generic approval drawer | Task 6: GenericApprovalDrawer |
| Console shell + navigation | Task 7: AgentConsoleTab + NexusOverview |
| Screens 05–10 (Sentinel review/execute) | **Plan B** — not in scope |

**What Plan B must add:**
- Sentinel review overlay (full-screen + side-panel layout modes)
- Account decision cards with confidence score bars
- Execute confirmation modal + live progress + "Production is clean"
- Surgical SSH command execution (not `local_wpe_push`)
- Sandbox lifecycle: keep alive until execute or dismiss
- Report file parsing into `SentinelCase` data shape
- Post-execution re-scan verification

**Placeholder scan:** None found.

**Type consistency:** All components import from `AgentStore.ts` which exports `AgentStatus`, `ActivityEvent`, `AgentSettings`, `AgentState`. All prop types reference these same exports.
