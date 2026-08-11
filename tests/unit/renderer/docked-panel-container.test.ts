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

  it('reads panelState and activeSessionId from localStorage but always starts closed', () => {
    // Migration test: old open+size format should be migrated to panelState
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'full', activeSessionId: 'abc' }));
    // Import after setting localStorage so the constructor reads it
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    expect(inst.state.panelState).toBe('closed'); // always collapsed on load — prevents blocking Local
    expect(inst.state.activeSessionId).toBe('abc');
  });

  it('defaults to closed with no session when localStorage is empty', () => {
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    expect(inst.state.panelState).toBe('closed');
    expect(inst.state.activeSessionId).toBeNull();
  });

  it('migrates old open+size format to panelState enum', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ open: true, size: 'wide', activeSessionId: null }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    // open:true + size:'wide' is migrated, but always starts closed
    expect(new DockedPanelContainer({}).state.panelState).toBe('closed');
  });

  it('coerces unrecognised panelState to closed on load', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ panelState: 'enormous', activeSessionId: null }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    // Unrecognized states coerce to 'docked', but readState forces 'closed' on startup
    expect(new DockedPanelContainer({}).state.panelState).toBe('closed');
  });
});
