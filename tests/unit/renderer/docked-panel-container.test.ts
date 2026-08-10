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

  it('reads size and activeSessionId from localStorage but always starts closed', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'full', activeSessionId: 'abc' }));
    // Import after setting localStorage so the constructor reads it
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    expect(inst.state.open).toBe(false); // always collapsed on load — prevents blocking Local
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

  it('round-trips the wide size through localStorage', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'wide', activeSessionId: null }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    expect(new DockedPanelContainer({}).state.size).toBe('wide');
  });

  it('still coerces an unrecognised size to docked', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'enormous', activeSessionId: null }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    expect(new DockedPanelContainer({}).state.size).toBe('docked');
  });
});
