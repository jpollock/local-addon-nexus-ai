import { AgentWorkspace } from '../../../src/renderer/components/agents/AgentWorkspace';

/**
 * Wiring test: verifies AgentWorkspace actually passes siteScoped to both AgentRunModal and
 * AgentWorkspaceSettings. Without this, the unit tests on those components can all pass while
 * the feature silently fails in production because the prop is never wired.
 */
describe('AgentWorkspace — siteScoped prop wiring', () => {
  function makeWorkspace(siteScoped: boolean | undefined) {
    const instance: any = new AgentWorkspace({
      agentId: 'auth-probe',
      onBack: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn(() => Promise.resolve(null)) } },
      onReviewEvent: jest.fn(),
    });
    // Set up minimal required state
    instance.state = {
      ...instance.state,
      status: siteScoped === undefined ? null : { siteScoped },
      settings: { enabled: true },
      showRunModal: true, // To render AgentRunModal
      activeTab: 'settings', // To render AgentWorkspaceSettings
    };
    return instance;
  }

  function findChildProps(node: any, targetType: string): any | null {
    if (!node || typeof node !== 'object') return null;

    // Check if this node's type matches (by name or reference)
    if (node.type && (node.type.name === targetType || node.type === targetType)) {
      return node.props;
    }

    // Recursively check children
    const kids = node.props?.children;
    const arr = Array.isArray(kids) ? kids : kids ? [kids] : [];
    for (const child of arr) {
      const found = findChildProps(child, targetType);
      if (found) return found;
    }

    return null;
  }

  it('passes siteScoped: false to both AgentRunModal and AgentWorkspaceSettings when status declares it', () => {
    const instance = makeWorkspace(false);
    const rendered = instance.render();

    const modalProps = findChildProps(rendered, 'AgentRunModal');
    const settingsProps = findChildProps(rendered, 'AgentWorkspaceSettings');

    expect(modalProps).not.toBeNull();
    expect(modalProps.siteScoped).toBe(false);

    expect(settingsProps).not.toBeNull();
    expect(settingsProps.siteScoped).toBe(false);
  });

  it('passes siteScoped: true (default) to both components when status omits the field', () => {
    const instance = makeWorkspace(undefined);
    const rendered = instance.render();

    const modalProps = findChildProps(rendered, 'AgentRunModal');
    const settingsProps = findChildProps(rendered, 'AgentWorkspaceSettings');

    expect(modalProps).not.toBeNull();
    expect(modalProps.siteScoped).toBe(true);

    expect(settingsProps).not.toBeNull();
    expect(settingsProps.siteScoped).toBe(true);
  });

  it('passes siteScoped: true to both components when status explicitly declares it', () => {
    const instance = makeWorkspace(true);
    const rendered = instance.render();

    const modalProps = findChildProps(rendered, 'AgentRunModal');
    const settingsProps = findChildProps(rendered, 'AgentWorkspaceSettings');

    expect(modalProps).not.toBeNull();
    expect(modalProps.siteScoped).toBe(true);

    expect(settingsProps).not.toBeNull();
    expect(settingsProps.siteScoped).toBe(true);
  });
});
