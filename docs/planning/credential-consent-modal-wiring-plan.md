# CredentialConsentModal Wiring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the orphaned `CredentialConsentModal` into the renderer so agents calling `ctx.credentials.requestConnection('google')` surface a proper consent UI. Currently the main process emits `credentialConnectRequest` via `NEXUS_STATE_UPDATE` but the renderer's `NexusState` type doesn't include that field — it's silently dropped.

**Architecture:** Three file changes, no new components. Enrich the emitted payload with scopes/agentName/reason from the agent's credential declarations; type the `NexusState` field; mount the existing modal in `NexusOverview` with a state subscription.

**Tech Stack:** TypeScript, React (class component — NexusOverview uses React.Component), Electron IPC

## Global Constraints

- `CredentialConsentModal` already handles the Connect IPC call — do NOT change its internals
- NexusOverview is a class component — use `setState` and subscribe in `componentDidMount`/`componentWillUnmount`
- The `electron` prop is already available in `NexusOverview` — pass it through to the modal
- On dismiss: clear `credentialConnectRequest` from nexusStore (set to null)
- Tests: `npm run build 2>&1 | grep "error TS" | head -5` — clean build is the verification

---

## File Map

| File | What changes |
|------|-------------|
| `src/main/credentials/AgentCredentialsContext.ts` | Enrich `requestConnection()` payload with scopes, agentName, reason, scopeLabels |
| `src/renderer/store/NexusStateManager.ts` | Add `credentialConnectRequest` field to `NexusState` type |
| `src/renderer/components/NexusOverview.tsx` | Subscribe to `credentialConnectRequest`, render `CredentialConsentModal` |

---

## Task 1: Enrich payload + type NexusState + mount modal

All three changes in one task — they're interdependent and small.

**Files:**
- Modify: `src/main/credentials/AgentCredentialsContext.ts`
- Modify: `src/renderer/store/NexusStateManager.ts`
- Modify: `src/renderer/components/NexusOverview.tsx`

- [ ] **Step 1: Read the three files**

Before writing anything, read:
1. `src/main/credentials/AgentCredentialsContext.ts` — find `requestConnection()` method
2. `src/renderer/store/NexusStateManager.ts` — find `NexusState` type definition
3. `src/renderer/components/NexusOverview.tsx` — find `componentDidMount`, `componentWillUnmount`, `render()`, and the Props interface (confirm `electron` is available)

- [ ] **Step 2: Enrich `requestConnection()` in `AgentCredentialsContext.ts`**

Find the `requestConnection(provider: string)` method. It currently calls:
```typescript
await this.manager.requestConnectionForAgent(this.agentId, this.siteId, provider);
```
(or similar — check the exact call order from reading the file)

Replace with a version that looks up the matching declaration and passes scopes + metadata:

```typescript
async requestConnection(provider: string): Promise<void> {
  // Find the matching declaration so the UI can show scopes and reason
  const decl = this.declarations.find(d => d.provider === provider);
  await this.manager.requestConnectionForAgent(
    provider,
    this.agentId,
    this.siteId,
    {
      scopes: decl?.scopes ?? [],
      agentName: this.agentId,      // renderer may override with display name
      reason: decl?.reason,
      scopeLabels: decl?.scopeLabels,
    },
  );
}
```

Also update `CredentialManager.requestConnectionForAgent()` signature to accept the metadata object. Find the method in `src/main/credentials/CredentialManager.ts` and add an optional 4th parameter:

```typescript
async requestConnectionForAgent(
  provider: string,
  agentId: string,
  siteId: string,
  meta?: {
    scopes?: string[];
    agentName?: string;
    reason?: string;
    scopeLabels?: Record<string, string>;
  },
): Promise<void> {
  this.emitNexusState({
    credentialConnectRequest: { provider, agentId, siteId, ...meta },
  });
}
```

- [ ] **Step 3: Add `credentialConnectRequest` to `NexusState`**

In `src/renderer/store/NexusStateManager.ts`, find the `NexusState` type/interface and add:

```typescript
credentialConnectRequest?: {
  provider: string;
  agentId: string;
  siteId: string;
  scopes?: string[];
  agentName?: string;
  reason?: string;
  scopeLabels?: Record<string, string>;
} | null;
```

- [ ] **Step 4: Mount `CredentialConsentModal` in `NexusOverview`**

In `src/renderer/components/NexusOverview.tsx`:

**a) Add import at the top:**
```typescript
import { CredentialConsentModal } from './credentials/CredentialConsentModal';
```
(adjust path if the actual import path differs — read the file to confirm)

**b) Add to component state:**
```typescript
interface State {
  // ... existing state fields ...
  credentialRequest: NexusState['credentialConnectRequest'];
}
```

Initialize in constructor: `credentialRequest: null`

**c) Add store subscription in `componentDidMount`** (alongside the existing `AGENT_RUN_STARTED` listener):

```typescript
this.credentialRequestUnsub = nexusStore.subscribe(() => {
  const req = nexusStore.getState().credentialConnectRequest;
  this.setState({ credentialRequest: req ?? null });
});
```

Declare `private credentialRequestUnsub?: () => void;` as an instance field.

**d) Unsubscribe in `componentWillUnmount`:**
```typescript
this.credentialRequestUnsub?.();
```

**e) Render the modal at the end of `render()`, before the closing `</div>`:**
```typescript
<CredentialConsentModal
  electron={this.props.electron}
  request={this.state.credentialRequest ?? null}
  onDismiss={() => {
    nexusStore.update({ credentialConnectRequest: null });
    this.setState({ credentialRequest: null });
  }}
/>
```

- [ ] **Step 5: Build check**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Expected: clean. Fix any TypeScript errors before committing.

- [ ] **Step 6: Commit**

```bash
git add \
  src/main/credentials/AgentCredentialsContext.ts \
  src/main/credentials/CredentialManager.ts \
  src/renderer/store/NexusStateManager.ts \
  src/renderer/components/NexusOverview.tsx
git commit -m "feat(credentials): wire CredentialConsentModal — agents can now prompt Google OAuth via ctx.credentials.requestConnection()"
```
