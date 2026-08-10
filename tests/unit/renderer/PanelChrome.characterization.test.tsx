import * as React from 'react';
import { DockedPanel } from '../../../src/renderer/components/DockedPanel/DockedPanel';
import { serializeTree } from './helpers/serializeTree';

function makePanel(overrides: Record<string, any> = {}): any {
  return new (DockedPanel as any)({
    open: true,
    size: 'docked',
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onSetSize: jest.fn(),
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
  ['collapsed bubble', { open: false }],
  ['docked', {}],
  ['full', { size: 'full' }],
  ['streaming', { streamingStatus: 'Thinking…' }],
  ['sessions open', { showSessions: true, sessionsSidebar: React.createElement('div', null, 'sessions') }],
  ['wide', { size: 'wide' }],
];

describe('panel chrome — characterization', () => {
  test.each(VARIANTS)('renders %s', (_name, props) => {
    expect(serializeTree(makePanel(props).render())).toMatchSnapshot();
  });
});

describe('panel chrome — control interactions', () => {
  it('docked expand goes to wide, not full', () => {
    const onSetSize = jest.fn();
    const panel = makePanel({ size: 'docked', onSetSize });
    const tree = panel.render();

    // Find the expand button in the control cluster
    const header = tree.props.children[0];
    const controlCluster = header.props.children[2];
    const expandBtn = controlCluster.props.children.find((child: any) =>
      child?.props?.['aria-label'] === 'Expand to full screen' ||
      child?.props?.['aria-label'] === 'Wide view'
    );

    expect(expandBtn).toBeDefined();
    expandBtn.props.onClick();
    expect(onSetSize).toHaveBeenCalledWith('wide');
  });

  it('wide mode has sessions button', () => {
    const panel = makePanel({ size: 'wide' });
    const tree = panel.render();

    const header = tree.props.children[0];
    const controlCluster = header.props.children[2];
    const sessionsBtn = controlCluster.props.children.find((child: any) =>
      child?.props?.['aria-label'] === 'Sessions'
    );

    expect(sessionsBtn).toBeDefined();
    expect(sessionsBtn.type).toBe('button');
  });
});
