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
];

describe('panel chrome — characterization', () => {
  test.each(VARIANTS)('renders %s', (_name, props) => {
    expect(serializeTree(makePanel(props).render())).toMatchSnapshot();
  });
});
