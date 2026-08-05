// tests/unit/renderer/agent-settings-hydration.test.ts
//
// The renderer was the only writer of agent settings and had no reader. Its localStorage copy
// was treated as truth and pushed over agent-settings.json whenever the agents tab mounted, so
// when the two disagreed the guess won — and the guess was permissive.
//
// Observed twice on a real machine: security-sentinel, switched off by the user, came back with
// scheduleEnabled:true and a 15-minute cron and swept hundreds of sites unattended.
//
// Three permissive defaults conspired: getDefaultSettings, the inline default in
// buildSyncPayload, and `?? true` in the main-process handler. All three are now safe, and the
// renderer hydrates from disk before it is allowed to echo anything back.

import { agentStore } from '../../../src/renderer/components/agents/AgentStore';

describe('Defaults for a never-configured agent do not start it', () => {
  it('leaves both automatic triggers off', () => {
    const d = agentStore.getDefaultSettings('brand-new-agent');
    expect(d.scheduleEnabled).toBe(false);
    expect(d.eventsEnabled).toBe(false);
  });

  it('still leaves the agent usable from chat and Run Now', () => {
    // enabled:true is deliberate — the agent should be available, just not self-starting.
    expect(agentStore.getDefaultSettings('brand-new-agent').enabled).toBe(true);
  });

  it('agrees with seedAgentDefaultsIfMissing in the main process', () => {
    // Two implementations of the same policy; drift means the UI and the scheduler disagree.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/main/ipc-handlers.ts'), 'utf8');
    expect(src).toMatch(/DEFAULTS = \{[^}]*scheduleEnabled:\s*false[^}]*\}/);
    expect(src).toMatch(/DEFAULTS = \{[^}]*eventsEnabled:\s*false[^}]*\}/);
  });
});

describe('hydrateFromMain adopts what is actually persisted', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom may be absent */ }
    (agentStore as any).state.agentSettings = {};
    (agentStore as any).state.autonomyById = {};
    (agentStore as any).hydrated = false;
    (agentStore as any).ipcSyncer = null;
  });

  it('disk wins over a stale renderer value — the actual incident', () => {
    // Renderer believes the schedule is on; disk says the user turned it off.
    (agentStore as any).state.agentSettings = {
      'security-sentinel': { enabled: false, scheduleEnabled: true, eventsEnabled: true,
                             cadence: '*/15 * * * *', subscribedEvents: {} },
    };
    agentStore.hydrateFromMain({
      'security-sentinel': { enabled: false, scheduleEnabled: false, eventsEnabled: false },
    });

    const s = agentStore.getState().agentSettings['security-sentinel'];
    expect(s.scheduleEnabled).toBe(false);
    expect(s.eventsEnabled).toBe(false);
  });

  it('keeps renderer-only agents the main process has never heard of', () => {
    (agentStore as any).state.agentSettings = {
      'local-draft': { enabled: true, scheduleEnabled: true, eventsEnabled: false,
                       cadence: '0 * * * *', subscribedEvents: {} },
    };
    agentStore.hydrateFromMain({ 'other-agent': { enabled: true, scheduleEnabled: false } });

    expect(agentStore.getState().agentSettings['local-draft'].scheduleEnabled).toBe(true);
    expect(agentStore.getState().agentSettings['other-agent']).toBeDefined();
  });

  it('fills gaps in a partial persisted record from the SAFE defaults', () => {
    // A record written by an older schema may lack scheduleEnabled entirely. It must not
    // become true on the way in.
    agentStore.hydrateFromMain({ 'legacy-agent': { enabled: false } as any });
    const s = agentStore.getState().agentSettings['legacy-agent'];
    expect(s.scheduleEnabled).toBe(false);
    expect(s.eventsEnabled).toBe(false);
  });

  it('carries autonomy across', () => {
    agentStore.hydrateFromMain({ a: { enabled: true, autonomy: 'suggest' } as any });
    expect(agentStore.getState().autonomyById['a']).toBe('suggest');
  });

  it('does not push back at main while hydrating', () => {
    // hydrateFromMain assigns state directly rather than via setState, because setState would
    // echo straight back to the process that just told us.
    const pushes: any[] = [];
    (agentStore as any).hydrated = true;
    agentStore.setIpcSyncer((s) => pushes.push(s));
    pushes.length = 0;
    agentStore.hydrateFromMain({ a: { enabled: true, scheduleEnabled: false } });
    expect(pushes).toHaveLength(0);
  });
});

describe('The syncer stays silent until hydration has happened', () => {
  beforeEach(() => {
    (agentStore as any).hydrated = false;
    (agentStore as any).ipcSyncer = null;
  });

  it('registering before hydration pushes nothing', () => {
    // This immediate push is what overwrote the disk file on mount.
    const pushes: any[] = [];
    agentStore.setIpcSyncer((s) => pushes.push(s));
    expect(pushes).toHaveLength(0);
  });

  it('registering after hydration pushes the hydrated truth', () => {
    agentStore.hydrateFromMain({ a: { enabled: true, scheduleEnabled: false } });
    const pushes: any[] = [];
    agentStore.setIpcSyncer((s) => pushes.push(s));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]['a'].scheduleEnabled).toBe(false);
  });

  it('hydrating with nothing still unblocks the syncer', () => {
    // An older main process without the GET channel must not leave the UI unable to sync.
    agentStore.hydrateFromMain(null);
    const pushes: any[] = [];
    agentStore.setIpcSyncer((s) => pushes.push(s));
    expect(pushes).toHaveLength(1);
  });
});

describe('Main-process handlers no longer default the trigger flags on', () => {
  const fs = require('fs');
  const path = require('path');
  const src = () => fs.readFileSync(
    path.join(__dirname, '../../../src/main/ipc-handlers.ts'), 'utf8');

  it('no scheduleEnabled or eventsEnabled falls back to true', () => {
    expect(src()).not.toMatch(/scheduleEnabled:\s*s\.scheduleEnabled\s*\?\?\s*true/);
    expect(src()).not.toMatch(/eventsEnabled:\s*s\.eventsEnabled\s*\?\?\s*true/);
  });

  it('a GET channel exists so the renderer can read what is persisted', () => {
    expect(src()).toContain('IPC_CHANNELS.AGENT_SETTINGS_GET');
    const constants = fs.readFileSync(
      path.join(__dirname, '../../../src/common/constants.ts'), 'utf8');
    expect(constants).toContain('AGENT_SETTINGS_GET');
  });

  it('the console tab reads before it registers the writer', () => {
    const tab = fs.readFileSync(
      path.join(__dirname, '../../../src/renderer/components/agents/AgentConsoleTab.tsx'), 'utf8');
    const getIdx  = tab.indexOf('AGENT_SETTINGS_GET');
    const syncIdx = tab.indexOf('setIpcSyncer');
    expect(getIdx).toBeGreaterThan(-1);
    expect(getIdx).toBeLessThan(syncIdx);
  });
});
