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


/**
 * Find a header button by aria-label, walking the tree rather than indexing into it.
 * These tests used to reach the control cluster as `header.props.children[3]`, which
 * silently pointed at the wrong node the moment the segmented control was removed.
 */
function findByLabel(node: any, label: string): any {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.['aria-label'] === label) return node;
  const kids = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
  for (const k of kids) {
    const hit = findByLabel(k, label);
    if (hit) return hit;
  }
  return null;
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

    const expandBtn = findByLabel(tree, 'Expand to full screen') ?? findByLabel(tree, 'Wide view');
    expect(expandBtn).toBeTruthy();
    expandBtn.props.onClick();
    expect(onSetPanelState).toHaveBeenCalledWith('wide');
  });

  it('wide mode has sessions button', () => {
    const panel = makePanel({ panelState: 'wide' });
    const tree = panel.render();

    const sessionsBtn = findByLabel(tree, 'Sessions');
    expect(sessionsBtn).toBeTruthy();
    expect(sessionsBtn.type).toBe('button');
  });

  it('offers no tab control — Chat is the panel\'s only content', () => {
    const panel = makePanel({ activeTab: 'chat' });
    const tree = panel.render();

    // Insights was dropped, and a one-item segmented control is a control that cannot be
    // operated: it advertises a choice and then denies it. Pinning the absence, because
    // the natural "fix" when re-adding a second view is to restore the control silently.
    expect(findByLabel(tree, 'Chat')).toBeNull();
    expect(findByLabel(tree, 'Insights')).toBeNull();
  });
});
