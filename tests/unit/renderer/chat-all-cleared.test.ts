/**
 * CHAT_ALL_CLEARED invalidation tests
 *
 * Verifies that when chat history is deleted via Settings → Delete All,
 * the renderer invalidates in-memory state so the next persist does not
 * resurrect a deleted session.
 */
import { IPC_CHANNELS } from '../../../src/common/constants';

describe('CHAT_ALL_CLEARED event invalidation', () => {
  beforeEach(() => {
    // Mock window for PanelChat tests
    (global as any).window = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
  });

  afterEach(() => {
    delete (global as any).window;
  });

  test('PanelChat subscribes to CHAT_ALL_CLEARED on mount', () => {
    const mockOn = jest.fn();
    const mockElectron = { ipcRenderer: { on: mockOn, removeListener: jest.fn(), invoke: jest.fn() } };

    // Import and instantiate — assumes PanelChat is a default export or named export
    const { PanelChat } = require('../../../src/renderer/components/DockedPanel/PanelChat');
    const instance = new PanelChat({
      electron: mockElectron,
      sessionId: null,
      selectedSiteIds: [],
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
    });

    instance.componentDidMount();

    // Must subscribe to CHAT_ALL_CLEARED alongside CHAT_STREAM and CHAT_SESSION_ACTION_RECORDED
    const calls = mockOn.mock.calls.map(([channel]) => channel);
    expect(calls).toContain(IPC_CHANNELS.CHAT_ALL_CLEARED);
  });

  test('PanelChat clears activeSessionId and messages on CHAT_ALL_CLEARED', () => {
    let clearListener: any = null;
    const mockOn = jest.fn((channel, handler) => {
      if (channel === IPC_CHANNELS.CHAT_ALL_CLEARED) clearListener = handler;
    });
    const mockElectron = { ipcRenderer: { on: mockOn, removeListener: jest.fn(), invoke: jest.fn() } };

    const { PanelChat } = require('../../../src/renderer/components/DockedPanel/PanelChat');
    const instance = new PanelChat({
      electron: mockElectron,
      sessionId: 'session-123',
      selectedSiteIds: ['site-1'],
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
    });

    // Simulate having an active session
    instance.state.activeSessionId = 'session-123';
    instance.state.messages = [
      { id: 'msg-1', role: 'user', content: 'Hello' },
      { id: 'msg-2', role: 'assistant', content: 'Hi there' },
    ];

    instance.componentDidMount();
    expect(clearListener).not.toBeNull();

    // Spy on setState
    const setStateSpy = jest.spyOn(instance, 'setState');

    // Fire the event
    clearListener();

    // setState must be called with clearing args
    expect(setStateSpy).toHaveBeenCalledWith({ activeSessionId: null, messages: [], actionCount: 0 });
  });

  test('SessionsSidebar subscribes to CHAT_ALL_CLEARED and refreshes sessions list', () => {
    const mockOn = jest.fn();
    const mockInvoke = jest.fn().mockResolvedValue([]);
    const mockElectron = { ipcRenderer: { on: mockOn, removeListener: jest.fn(), invoke: mockInvoke } };

    const { SessionsSidebar } = require('../../../src/renderer/components/DockedPanel/SessionsSidebar');
    const instance = new SessionsSidebar({
      electron: mockElectron,
      activeSessionId: null,
      onSelectSession: jest.fn(),
      onNewSession: jest.fn(),
    });

    instance.componentDidMount();

    // Must subscribe to CHAT_ALL_CLEARED
    const calls = mockOn.mock.calls.map(([channel]) => channel);
    expect(calls).toContain(IPC_CHANNELS.CHAT_ALL_CLEARED);
  });

  test('SessionsSidebar clears sessions list on CHAT_ALL_CLEARED', () => {
    let clearListener: any = null;
    const mockOn = jest.fn((channel, handler) => {
      if (channel === IPC_CHANNELS.CHAT_ALL_CLEARED) clearListener = handler;
    });
    const mockInvoke = jest.fn().mockResolvedValue([
      { id: 'session-1', title: 'Test', scopeLabel: '1 site', scopeSiteIds: [], createdAt: 0, updatedAt: 0, pinned: false, actionCount: 0, expiresAt: null },
    ]);
    const mockElectron = { ipcRenderer: { on: mockOn, removeListener: jest.fn(), invoke: mockInvoke } };

    const { SessionsSidebar } = require('../../../src/renderer/components/DockedPanel/SessionsSidebar');
    const instance = new SessionsSidebar({
      electron: mockElectron,
      activeSessionId: null,
      onSelectSession: jest.fn(),
      onNewSession: jest.fn(),
    });

    instance.componentDidMount();
    expect(clearListener).not.toBeNull();

    // Simulate sessions being loaded
    instance.state.sessions = [
      { id: 'session-1', title: 'Old', scopeLabel: '1 site', scopeSiteIds: [], createdAt: 0, updatedAt: 0, pinned: false, actionCount: 0, expiresAt: null },
    ];

    // Spy on setState
    const setStateSpy = jest.spyOn(instance, 'setState');

    // Fire the event
    clearListener();

    // setState must be called with empty sessions
    expect(setStateSpy).toHaveBeenCalledWith({ sessions: [] });
  });
});
