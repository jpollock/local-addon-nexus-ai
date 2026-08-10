import * as React from 'react';
import { PanelInsights } from '../../../src/renderer/components/DockedPanel/PanelInsights';

// Serialize React element tree to string for inspection
function serializeTree(node: any): any {
  if (node == null) return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(serializeTree);
  if (typeof node !== 'object') return String(node);
  if (!node.type) return node;

  const { type, props } = node;
  const { children, ...restProps } = props || {};
  const serialized: any = { type: typeof type === 'string' ? type : type.name || 'Component', props: restProps };
  if (children != null) {
    serialized.children = serializeTree(children);
  }
  return serialized;
}

// Find element by data-test attribute
function findByTestId(node: any, id: string): any {
  if (!node || typeof node !== 'object') return null;
  if (node.props && node.props['data-test'] === id) return node;
  const kids = node.props ? node.props.children : undefined;
  const arr = Array.isArray(kids) ? kids : [kids];
  for (const k of arr) {
    const hit = findByTestId(k, id);
    if (hit) return hit;
  }
  return null;
}

describe('PanelInsights', () => {
  let mockElectron: any;

  beforeEach(() => {
    mockElectron = {
      ipcRenderer: {
        invoke: jest.fn(),
      },
    };
  });

  it('renders each fleet figure with its scope label, never bare', () => {
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents: jest.fn() });
    inst.state.counts = {
      installs: { count: 370, scope: 'installs on this Mac, WP Engine and other hosts' },
      local: { count: 37, scope: 'sites on this Mac' },
      wpe: { count: 330, scope: 'WP Engine installs' },
      external: { count: 3, scope: 'sites on other hosts' },
    };
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('installs on this Mac, WP Engine and other hosts');
    expect(tree).toContain('sites on this Mac');
    expect(tree).toContain('WP Engine installs');
    expect(tree).toContain('sites on other hosts');
  });

  it('invokes onOpenAgents when the waiting-items card is activated', () => {
    const onOpenAgents = jest.fn();
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents });
    inst.state.pendingCount = 4;

    const card = findByTestId(inst.render(), 'waiting-items');
    expect(card).not.toBeNull();
    card.props.onClick();
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });

  it('renders loading state when data is not yet fetched', () => {
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents: jest.fn() });
    inst.state.counts = null;
    inst.state.intervals = null;

    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('Loading...');
  });

  it('renders error state when fetch fails', () => {
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents: jest.fn() });
    inst.state.error = 'Network error';
    inst.state.counts = null;

    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('Failed to load: Network error');
  });

  it('renders background job intervals correctly', () => {
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents: jest.fn() });
    inst.state.intervals = {
      halted: 24,
      wpe: 12,
      external: 0,
      externalContentIndex: 48,
    };

    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('1 day'); // halted: 24
    expect(tree).toContain('12 hours'); // wpe: 12
    expect(tree).toContain('manual'); // external: 0
    expect(tree).toContain('2 days'); // externalContentIndex: 48
  });

  it('does not make waiting-items card clickable when pendingCount is 0', () => {
    const onOpenAgents = jest.fn();
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents });
    inst.state.pendingCount = 0;

    const card = findByTestId(inst.render(), 'waiting-items');
    expect(card).not.toBeNull();
    expect(card.props.onClick).toBeUndefined();
  });

  it('formats single hour interval correctly', () => {
    const inst: any = new (PanelInsights as any)({ electron: mockElectron, onOpenAgents: jest.fn() });
    inst.state.intervals = {
      halted: 1,
      wpe: 24,
      external: 24,
      externalContentIndex: 24,
    };

    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('1 hour');
  });
});
