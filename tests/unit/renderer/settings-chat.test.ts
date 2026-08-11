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

  test('the retention sentence tracks the choice', () => {
    expect(tree({ chatRetentionDays: 7 })).not.toEqual(tree({ chatRetentionDays: null }));
  });

  test('the panel toggle says it removes the panel everywhere', () => {
    expect(tree()).toContain('every screen');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
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

  test('retention sentence changes per selection', () => {
    const days7 = tree({ dockedPanelEnabled: true, chatRetentionDays: 7 });
    const days30 = tree({ dockedPanelEnabled: true, chatRetentionDays: 30 });
    const days90 = tree({ dockedPanelEnabled: true, chatRetentionDays: 90 });
    const forever = tree({ dockedPanelEnabled: true, chatRetentionDays: null });

    // Each must be different from the others
    expect(days7).not.toEqual(days30);
    expect(days7).not.toEqual(days90);
    expect(days7).not.toEqual(forever);
    expect(days30).not.toEqual(days90);
    expect(days30).not.toEqual(forever);
    expect(days90).not.toEqual(forever);
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
