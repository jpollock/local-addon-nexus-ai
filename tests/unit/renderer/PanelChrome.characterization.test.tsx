import * as React from 'react';
import { DockedPanel } from '../../../src/renderer/components/DockedPanel/DockedPanel';
import { serializeTree } from './helpers/serializeTree';

function makePanel(overrides: Record<string, any> = {}): any {
  return new (DockedPanel as any)({
    panelState: 'docked',
    activeTab: 'chat',
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onSetPanelState: jest.fn(),
    onSetActiveTab: jest.fn(),
    onNewChat: jest.fn(),
    onToggleSessions: jest.fn(),
    showSessions: false,
    streamingStatus: null,
    children: React.createElement('div', { 'data-test': 'chat-body' }, 'chat'),
    sessionsSidebar: null,
    ...overrides,
  });
}

const VARIANTS: Array<[string, Record<string, any>]> = [
  ['collapsed rail', { panelState: 'closed' }],
  ['docked', {}],
  ['full', { panelState: 'full' }],
  ['streaming', { streamingStatus: 'Thinking…' }],
  ['sessions open', { showSessions: true, sessionsSidebar: React.createElement('div', null, 'sessions') }],
  ['wide', { panelState: 'wide' }],
];

describe('panel chrome — characterization', () => {
  test.each(VARIANTS)('renders %s', (_name, props) => {
    expect(serializeTree(makePanel(props).render())).toMatchSnapshot();
  });
});

describe('panel chrome — control interactions', () => {
  it('docked expand goes to wide, not full', () => {
    const onSetPanelState = jest.fn();
    const panel = makePanel({ panelState: 'docked', onSetPanelState });
    const tree = panel.render();

    // Find the expand button in the control cluster
    // Header now has: [0] avatar, [1] title stack, [2] segmented control, [3] control cluster
    const header = tree.props.children[0];
    const controlCluster = header.props.children[3];
    const expandBtn = controlCluster.props.children.find((child: any) =>
      child?.props?.['aria-label'] === 'Expand to full screen' ||
      child?.props?.['aria-label'] === 'Wide view'
    );

    expect(expandBtn).toBeDefined();
    expandBtn.props.onClick();
    expect(onSetPanelState).toHaveBeenCalledWith('wide');
  });

  it('wide mode has sessions button', () => {
    const panel = makePanel({ panelState: 'wide' });
    const tree = panel.render();

    // Header now has: [0] avatar, [1] title stack, [2] segmented control, [3] control cluster
    const header = tree.props.children[0];
    const controlCluster = header.props.children[3];
    const sessionsBtn = controlCluster.props.children.find((child: any) =>
      child?.props?.['aria-label'] === 'Sessions'
    );

    expect(sessionsBtn).toBeDefined();
    expect(sessionsBtn.type).toBe('button');
  });

  it('segmented control switches tabs', () => {
    const onSetActiveTab = jest.fn();
    const panel = makePanel({ activeTab: 'chat', onSetActiveTab });
    const tree = panel.render();

    // Header: [0] avatar, [1] title stack, [2] segmented control, [3] control cluster
    const header = tree.props.children[0];
    const segmentedControl = header.props.children[2];
    const buttons = segmentedControl.props.children;

    // Chat leads — it is the default tab and the reason the panel gets opened.
    const chatBtn = buttons[0];
    expect(chatBtn.props['aria-label']).toBe('Chat');
    chatBtn.props.onClick();
    expect(onSetActiveTab).toHaveBeenCalledWith('chat');

    // Insights second.
    const insightsBtn = buttons[1];
    expect(insightsBtn.props['aria-label']).toBe('Insights');
    insightsBtn.props.onClick();
    expect(onSetActiveTab).toHaveBeenCalledWith('insights');

    // Each button dispatches its own tab — a map over PANEL_TABS makes a copy-paste
    // mistake here (both buttons sending the same key) easy and invisible.
    expect(onSetActiveTab.mock.calls).toEqual([['chat'], ['insights']]);
  });
});
