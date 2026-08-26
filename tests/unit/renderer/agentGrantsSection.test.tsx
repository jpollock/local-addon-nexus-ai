/**
 * fixes-082526 · agent-addressed grants, phase 3 — the AgentWorkspace grants
 * section.
 *
 * The pane ruling's door target: "the decision can actually be changed inside
 * that agent." An agent holds only what a human granted it (phase 1), the
 * gate refuses it by name otherwise (phase 2) — this is where the human
 * grants it. One row per capability the registry serves; the switch is THIS
 * agent's own grant; a held row cites the agent's OWN act, never another
 * holder's.
 */
import React from 'react';
import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';

const MATRIX = {
  preamble: '',
  rows: [
    {
      capability: 'cap.bulk_plugin_update',
      label: 'Update plugins across sites',
      id: 'cap.bulk_plugin_update',
      state: 'materialized', chip: 'Granted', stateLine: '', consent: true, inForce: true,
      holders: ['chat', 'mcp-client', 'security-sentinel'],
      acts: {
        chat: { eventId: 'evt_CHAT', issuedAt: '2026-08-26T10:00:00.000Z' },
        'security-sentinel': { eventId: 'evt_AGENT', issuedAt: '2026-08-26T11:00:00.000Z' },
      },
      issuance: { eventId: 'evt_CHAT', issuedAt: '2026-08-26T10:00:00.000Z' },
      document: { runbookId: 'rb.bulk-plugin-update', version: '1.2.0', hashShort: '0646cfe11c', mismatch: false },
      documentLine: 'rb.bulk-plugin-update · 1.2.0 · 0646cfe11c',
      gates: { kind: 'strict', attestable: 4, total: 8 }, gatesLines: [], disarm: null,
      door: { surface: 'settings', section: 'capabilities', capability: 'cap.bulk_plugin_update', runbookId: 'rb.bulk-plugin-update' },
      ceremony: 'strict',
    },
    {
      capability: 'cap.promote_environment',
      label: 'Promote one environment to another',
      id: 'cap.promote_environment',
      state: 'never-by-default', chip: 'Never by default', stateLine: '', consent: false, inForce: false,
      holders: [], acts: {},
      issuance: null,
      document: { runbookId: 'rb.promotion-execute', version: '1.0.0', hashShort: 'f6da723999', mismatch: false },
      documentLine: 'rb.promotion-execute · 1.0.0 · f6da723999',
      gates: { kind: 'strict', attestable: 3, total: 6 }, gatesLines: [], disarm: null,
      door: { surface: 'settings', section: 'capabilities', capability: 'cap.promote_environment', runbookId: 'rb.promotion-execute' },
      ceremony: 'strict',
    },
  ],
};

function walk(node: any, out: any[] = []): any[] {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  out.push(node);
  const kids = node?.props?.children;
  if (kids) walk(Array.isArray(kids) ? kids : [kids], out);
  return out;
}

function makeComponent(invoke = jest.fn(async () => MATRIX)) {
  const c = new AgentWorkspaceSettings({
    agentId: 'security-sentinel',
    electron: { ipcRenderer: { invoke, on: jest.fn(), removeListener: jest.fn(), send: jest.fn() } },
    cronExpression: '0 3 * * *',
  } as any);
  c.setState = (partial: any) => { c.state = { ...c.state, ...(typeof partial === 'function' ? partial(c.state) : partial) }; };
  return { c, invoke };
}

describe('the grants section', () => {
  it('renders one row per served capability with THIS agent\'s own switch state', () => {
    const { c } = makeComponent();
    (c.state as any).governRows = MATRIX.rows;
    const tree = (c as any).renderGrantsSection();
    const nodes = walk(tree);
    const held = nodes.find((n) => n?.props?.['data-agent-grant-row'] === 'cap.bulk_plugin_update');
    const unheld = nodes.find((n) => n?.props?.['data-agent-grant-row'] === 'cap.promote_environment');
    expect(held).toBeTruthy();
    expect(unheld).toBeTruthy();
    expect(held.props['data-held']).toBe(true);   // security-sentinel is a holder
    expect(unheld.props['data-held']).toBe(false);
  });

  it('a held row cites the AGENT\'S OWN act — never another holder\'s', () => {
    const { c } = makeComponent();
    (c.state as any).governRows = MATRIX.rows;
    const texts = walk((c as any).renderGrantsSection())
      .flatMap((n) => {
        const kids = n?.props?.children;
        return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => typeof k === 'string');
      });
    expect(texts.join(' ')).toContain('evt_AGENT');
    expect(texts.join(' ')).not.toContain('evt_CHAT');
  });

  it('toggling asks GOVERN_SET_GRANT for THIS grantee', async () => {
    const { c, invoke } = makeComponent();
    (c.state as any).governRows = MATRIX.rows;
    await (c as any).handleGrantToggle('cap.promote_environment', true);
    expect(invoke).toHaveBeenCalledWith(
      expect.stringContaining('govern:set-grant'),
      expect.objectContaining({ capability: 'cap.promote_environment', grant: true, grantee: 'security-sentinel' }),
    );
  });

  it('with no matrix (core down) the section states the absence, never an empty granted-nothing list', () => {
    const { c } = makeComponent();
    (c.state as any).governRows = null;
    const texts = walk((c as any).renderGrantsSection())
      .flatMap((n) => {
        const kids = n?.props?.children;
        return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => typeof k === 'string');
      });
    expect(texts.join(' ')).toMatch(/unavailable|not running/i);
  });
});
