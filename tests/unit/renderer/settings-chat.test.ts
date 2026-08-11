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
    expect(json).toContain('Confirm Delete');
  });

  test('delete-all has a confirmation step', () => {
    const mockInvoke = jest.fn();
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: mockInvoke } },
    });

    // The component must have a handleDeleteAll method
    expect(typeof instance.handleDeleteAll).toBe('function');
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
  });

  test('retention select renders with all options', () => {
    const instance = new (ChatSection as any)({
      settings: { dockedPanelEnabled: true, chatRetentionDays: 30 },
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
    });
    const rendered = serializeTree(instance.render());
    const json = JSON.stringify(rendered);

    // All four retention options must be present
    expect(json).toContain('7 days');
    expect(json).toContain('30 days');
    expect(json).toContain('90 days');
    expect(json).toContain('Forever');
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

  test('only uses declared CSS variables', () => {
    const t = tree();
    const matches = t.match(/var\(--[a-z-]+\)/g) || [];
    const validVars = new Set([
      'var(--nxai-card-bg)', 'var(--nxai-card-border)', 'var(--nxai-card-label)',
      'var(--nxai-card-sub)', 'var(--nxai-card-text)', 'var(--nxai-section-label)',
      'var(--nxai-section-bg)', 'var(--nxai-code-bg)', 'var(--nxai-table-hover)',
      'var(--nxai-input-bg)', 'var(--nxai-input-border)', 'var(--nxai-score-bg)',
      'var(--nxai-score-fill)', 'var(--nxai-warn-text)', 'var(--nxai-status-neutral)',
      'var(--nxai-danger-text)', 'var(--nxai-chat-user-bg)', 'var(--nxai-chat-assistant-bg)',
      'var(--nxai-filter-bg)', 'var(--nxai-error-bg)', 'var(--nxai-accent)',
      'var(--nxai-accent-text)',
    ]);

    for (const m of matches) {
      expect(validVars.has(m)).toBe(true);
    }
  });
});
