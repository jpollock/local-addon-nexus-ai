/**
 * The Connected Accounts card × multiple Google accounts (2026-08-26).
 *
 * The card's `.find(...)` and connect-button-hidden-when-connected were the
 * single-account assumptions; the store was always plural. Pins: one row per
 * connection, per-row disconnect targets ITS OWN id, and the connect flow
 * stays reachable with accounts already connected ("Connect another").
 */
import React from 'react';
import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';

function walk(node: any, out: any[] = []): any[] {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  out.push(node);
  const kids = node?.props?.children;
  if (kids) walk(Array.isArray(kids) ? kids : [kids], out);
  return out;
}
const texts = (tree: any): string =>
  walk(tree).flatMap((n) => {
    const kids = n?.props?.children;
    return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => typeof k === 'string');
  }).join(' | ');

function card(connections: Array<{ id: string; provider: string; accountLabel: string; status: string }>) {
  const invoke = jest.fn(async () => ({}));
  const c = new AgentWorkspaceSettings({
    agentId: 'web-analytics',
    electron: { ipcRenderer: { invoke, on: jest.fn(), removeListener: jest.fn() } },
    cronExpression: '0 8 * * 1',
    credentials: [{ provider: 'google', scopes: ['https://www.googleapis.com/auth/analytics.readonly'], reason: 'r' }],
  } as any);
  c.setState = (partial: any) => { c.state = { ...c.state, ...(typeof partial === 'function' ? partial(c.state) : partial) }; };
  (c.state as any).googleConnections = connections;
  return { tree: (c as any).renderGoogleCard ? (c as any).renderGoogleCard() : (c as any).renderConnectedAccounts?.() ?? (c as any).render(), invoke, c };
}

const TWO = [
  { id: 'c1', provider: 'google', accountLabel: 'alpha@example.com', status: 'active' },
  { id: 'c2', provider: 'google', accountLabel: 'beta@example.com', status: 'active' },
];

describe('multiple Google accounts on the card', () => {
  it('renders one row per connection, each naming its account', () => {
    const { tree } = card(TWO);
    const t = texts(tree);
    expect(t).toContain('alpha@example.com');
    expect(t).toContain('beta@example.com');
    const rows = walk(tree).filter((n) => n?.props?.['data-google-connection']);
    expect(rows.map((r) => r.props['data-google-connection'])).toEqual(['c1', 'c2']);
  });

  it('the connect flow stays reachable with accounts connected — "Connect another"', () => {
    const { tree } = card(TWO);
    const btn = walk(tree).find((n) => n?.props?.['data-google-connect']);
    expect(btn).toBeTruthy();
    expect(texts(tree)).toContain('Connect another Google account');
  });

  it('disconnect targets its OWN connection id', async () => {
    const { tree, invoke } = card(TWO);
    const row = walk(tree).find((n) => n?.props?.['data-google-connection'] === 'c2');
    const btn = walk(row).find((n) => n?.type === 'button');
    await btn.props.onClick();
    expect(invoke).toHaveBeenCalledWith('nexus-ai:credential:disconnect', { connectionId: 'c2' });
  });

  it('empty state keeps the original single-row invitation', () => {
    const { tree } = card([]);
    const t = texts(tree);
    expect(t).toContain('Not connected');
    expect(t).toContain('Connect Google account');
    expect(t).not.toContain('Connect another');
  });
});
