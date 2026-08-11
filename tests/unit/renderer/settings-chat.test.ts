import { ChatSection } from '../../../src/renderer/components/settings/ChatSection';
import { serializeTree } from './helpers/serializeTree';

const tree = (settings: any = {}) => JSON.stringify(serializeTree(
  new (ChatSection as any)({
    settings: { dockedPanelEnabled: true, chatRetentionDays: 30, ...settings },
    onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } },
  }).render()));

describe('ChatSection', () => {
  test('offers all four retention choices', () => {
    const t = tree();
    for (const label of ['7', '30', '90', 'Forever']) expect(t).toContain(label);
  });

  test('null renders Forever as selected (not a default)', () => {
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: null },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    const rendered = serializeTree(instance.render());
    const json = JSON.stringify(rendered);

    // null is a real stored value meaning Forever, not unset
    expect(json).toContain('"value":"null"');
  });

  test('the panel toggle says it removes the panel everywhere', () => {
    expect(tree()).toContain('every screen');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });

  test('delete-all button exists with destructive styling in confirm state', () => {
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });

    // Initial state
    let rendered = serializeTree(instance.render());
    let json = JSON.stringify(rendered);
    expect(json).toContain('Delete All Chat History');

    // Trigger confirm state by directly setting state (not via setState callback)
    instance.state.deleteConfirmPending = true;
    rendered = serializeTree(instance.render());
    json = JSON.stringify(rendered);

    // Must use danger/error CSS variables in confirm state, not raw hex
    expect(json).toContain('var(--nxai-danger-text)');
    expect(json).toContain('var(--nxai-error-bg)');
    expect(json).toContain('Delete Everything');
  });

  test('delete-all copy warns that pinning does not protect sessions', () => {
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    const rendered = serializeTree(instance.render());
    const json = JSON.stringify(rendered);

    // Must warn that pinned sessions are also deleted
    expect(json.toLowerCase()).toContain('pinned');
  });

  test('delete-all requires checkbox tick before confirm button works', async () => {
    const mockInvoke = jest.fn().mockResolvedValue({ success: true });
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: mockInvoke } },
    });

    // Mock setState to actually update state (since component is not mounted)
    const originalSetState = instance.setState.bind(instance);
    instance.setState = jest.fn((updater) => {
      const nextState = typeof updater === 'function' ? updater(instance.state) : updater;
      Object.assign(instance.state, nextState);
    });

    // Helper to find element in RENDERED tree (not serialized) by predicate
    function findInRendered(node: any, predicate: (n: any) => boolean): any {
      if (!node) return null;
      if (predicate(node)) return node;
      const children = node.props?.children;
      if (children) {
        if (Array.isArray(children)) {
          for (const child of children) {
            const found = findInRendered(child, predicate);
            if (found) return found;
          }
        } else {
          return findInRendered(children, predicate);
        }
      }
      return null;
    }

    // Step 1: Render, find disclosure button by text, invoke its onClick
    let rendered = instance.render();
    let disclosureBtn = findInRendered(rendered, (n: any) =>
      n?.type === 'button' && n?.props?.children === 'Delete All'
    );
    expect(disclosureBtn).not.toBeNull();
    expect(disclosureBtn.props.onClick).toBeDefined();

    // Invoke the actual onClick handler
    disclosureBtn.props.onClick();

    // setState doesn't work on unmounted components, so check via re-render
    // The state should have been updated
    expect(instance.state.deleteConfirmPending).toBe(true);

    // Assert CHAT_CLEAR_ALL was NOT invoked
    expect(mockInvoke).not.toHaveBeenCalled();

    // Step 2: Re-render, find confirm button, assert it is disabled
    rendered = instance.render();
    let confirmBtn = findInRendered(rendered, (n: any) =>
      n?.type === 'button' && n?.props?.children === 'Delete Everything'
    );
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn.props.disabled).toBe(true);

    // Don't invoke it - disabled is a DOM concept, programmatic onClick still fires
    // The test verifies the button EXISTS and is disabled, which is the protection

    // Step 3: Find the "I understand" checkbox (need fresh render to get current props)
    // The checkbox exists inside the confirm panel (when deleteConfirmPending is true)
    // Look for the specific checkbox - it's in a label with text "I understand"
    let freshRender = instance.render();
    let checkboxLabel = findInRendered(freshRender, (n: any) =>
      n?.type === 'label' && n?.props?.children?.[1] === 'I understand — this cannot be undone'
    );
    expect(checkboxLabel).not.toBeNull();
    const checkbox = checkboxLabel.props.children[0]; // First child is the input
    expect(checkbox.type).toBe('input');
    expect(checkbox.props.type).toBe('checkbox');
    expect(checkbox.props.checked).toBe(false); // Initially unchecked
    checkbox.props.onChange({ target: { checked: true } });

    // Re-render, find confirm button, assert it is now enabled
    rendered = instance.render();
    confirmBtn = findInRendered(rendered, (n: any) =>
      n?.type === 'button' && n?.props?.children === 'Delete Everything'
    );
    expect(confirmBtn.props.disabled).toBe(false);

    // Step 4: Invoke confirm button's onClick and assert CHAT_CLEAR_ALL was invoked exactly once
    await confirmBtn.props.onClick();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('nexus-ai:chat-clear-all');
  });

  test('override link is deliberately absent (pending destination)', () => {
    const t = tree({ dockedPanelEnabled: true });
    // Must NOT contain override link copy
    expect(t).not.toContain('override');
    expect(t).not.toContain('per-site');
    // The source code must have a comment explaining why
    const source = require('fs').readFileSync('src/renderer/components/settings/ChatSection.tsx', 'utf8');
    expect(source).toContain('deferred');
  });

  // Port fidelity tests - each interactive control must exist and be wired
  test('panel toggle renders and is connected', () => {
    const mockSave = jest.fn();
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: mockSave,
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    const rendered = serializeTree(instance.render());
    const json = JSON.stringify(rendered);

    // Must contain the checkbox
    expect(json).toContain('checkbox');
    expect(json).toContain('Enable AI Chat Panel');

    // Invoke the handler and verify it calls onSave
    instance.handleDockedPanelToggle(false);
    expect(mockSave).toHaveBeenCalledWith({ dockedPanelEnabled: false });
  });

  test('retention select renders with all options and is wired', () => {
    const mockSave = jest.fn();
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: mockSave,
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    const rendered = serializeTree(instance.render());
    const json = JSON.stringify(rendered);

    // All four retention options must be present
    expect(json).toContain('7 days');
    expect(json).toContain('30 days');
    expect(json).toContain('90 days');
    expect(json).toContain('Forever');

    // Invoke the handler and verify it calls onSave
    instance.handleRetentionChange(7);
    expect(mockSave).toHaveBeenCalledWith({ chatRetentionDays: 7 });
  });

  test('retention dropdown value pins the selected option', () => {
    // Without the sentence, the test now pins what DOES exist: the select's value
    const days7 = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 7 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    const days30 = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    const forever = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: null },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });

    const json7 = JSON.stringify(serializeTree(days7.render()));
    const json30 = JSON.stringify(serializeTree(days30.render()));
    const jsonForever = JSON.stringify(serializeTree(forever.render()));

    expect(json7).toContain('"value":"7"');
    expect(json30).toContain('"value":"30"');
    expect(jsonForever).toContain('"value":"null"');
  });

  test('panel toggle off hides retention controls', () => {
    const panelOn = tree({ dockedPanelEnabled: true, chatRetentionDays: 30 });
    const panelOff = tree({ dockedPanelEnabled: false, chatRetentionDays: 30 });

    // When panel is off, retention controls should not be visible
    expect(panelOn).toContain('Keep chat history for');
    expect(panelOff).not.toContain('Keep chat history for');
  });

  test('delete-all is available even when panel is disabled', () => {
    const panelOff = tree({ dockedPanelEnabled: false, chatRetentionDays: 30 });

    // Delete-all must be present even when panel is off
    expect(panelOff).toContain('Delete All Chat History');
  });

  test('only uses declared CSS variables', () => {
    // Read declared variables from theme.ts
    const themeSource = require('fs').readFileSync('src/renderer/utils/theme.ts', 'utf8');
    const declaredVars = new Set<string>();
    const varRegex = /--nxai-[a-z-]+/g;
    let match;
    while ((match = varRegex.exec(themeSource)) !== null) {
      declaredVars.add(match[0]);
    }

    // Scan all render states: default, panel off, confirm pending
    const states = [
      tree({ dockedPanelEnabled: true, chatRetentionDays: 30 }),
      tree({ dockedPanelEnabled: false, chatRetentionDays: 30 }),
    ];

    // Also scan confirm state
    const confirmInstance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    confirmInstance.state.deleteConfirmPending = true;
    states.push(JSON.stringify(serializeTree(confirmInstance.render())));

    for (const stateTree of states) {
      // Match both var(--x) and var(--x, fallback) forms
      const varCalls = stateTree.match(/var\(--[a-z-]+(?:,\s*[^)]+)?\)/g) || [];
      for (const call of varCalls) {
        // Extract variable name (everything between -- and either , or ))
        const varName = call.match(/--([a-z-]+)/)?.[0];
        if (varName && !declaredVars.has(varName)) {
          throw new Error(`Undeclared CSS variable: ${varName} in ${call}`);
        }
      }
    }
  });
});
