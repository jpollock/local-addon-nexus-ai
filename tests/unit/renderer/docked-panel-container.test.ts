/**
 * @jest-environment jsdom
 */

// Minimal stub — real component is a class component
// We test state persistence logic separately via localStorage

describe('DockedPanelContainer localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.resetModules();
  });

  it('reads initial state from localStorage', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'full', activeSessionId: 'abc' }));
    // Import after setting localStorage so the constructor reads it
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    expect(inst.state.open).toBe(true);
    expect(inst.state.size).toBe('full');
    expect(inst.state.activeSessionId).toBe('abc');
  });

  it('defaults to closed docked with no session when localStorage is empty', () => {
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    expect(inst.state.open).toBe(false);
    expect(inst.state.size).toBe('docked');
    expect(inst.state.activeSessionId).toBeNull();
  });
});
