/**
 * fixes-082526 · phase 5 — the pane's render pins, from the sheet's own
 * "absent on purpose" list.
 */
import * as React from 'react';
import { PermissionsPaneSection } from '../../../src/renderer/components/settings/PermissionsPaneSection';

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

function pane(matrixRows: unknown, settings: Record<string, unknown> = {}) {
  const c = new PermissionsPaneSection({
    settings: { wpeWriteExcludedAccounts: ['acct-x'], ...settings } as never,
    wpeAccounts: [{ id: 'acct-a', name: 'btwpe' }, { id: 'acct-x', name: 'dbrains' }],
    electron: { ipcRenderer: { invoke: jest.fn(async () => ({ rows: matrixRows })) } },
    onOpenBoundEditor: jest.fn(),
    onOpenGovern: jest.fn(),
  } as never);
  (c.state as any) = { matrixRows, loaded: true };
  return c.render();
}

const ROW = {
  capability: 'cap.bulk_plugin_update', label: 'Update plugins across sites',
  ceremony: 'strict', state: 'materialized', chip: 'Granted', inForce: true,
  holders: ['chat', 'mcp-client'], acts: {},
  documentLine: 'rb.bulk-plugin-update · 1.2.0 · 0646cfe11c',
  gatesLines: ['4 of 8 checkpoints the platform can verify.'], disarm: null,
};

describe('the merged pane', () => {
  it('renders BOTH layers — bound above, grants below', () => {
    const nodes = walk(pane([ROW]));
    const layers = nodes.filter((n) => n?.props?.['data-pane-layer']).map((n) => n.props['data-pane-layer']);
    expect(layers).toEqual(['bound', 'grants']);
  });

  it('NO editable control of any kind — no switch, no toggle, only the two doors', () => {
    const nodes = walk(pane([ROW]));
    const buttons = nodes.filter((n) => n?.type === 'button');
    expect(buttons.map((b) => b.props['data-pane-door']).sort()).toEqual(['bound-editor', 'govern']);
    expect(nodes.some((n) => n?.type === 'input')).toBe(false);
    expect(nodes.some((n) => String(n?.type?.name ?? '').match(/switch|toggle/i))).toBe(false);
  });

  it('one vocabulary per layer: allowed/blocked in the bound, granted/held in the grants', () => {
    const t = texts(pane([ROW]));
    expect(t).toContain('allowed');
    expect(t).toContain('blocked');
    expect(t).toContain('granted to 2 grantees');
  });

  it('the account scope is on the bound, whole-exclusion stated', () => {
    const t = texts(pane([ROW]));
    expect(t).toContain('Excluded, whole: dbrains');
    expect(t).toContain('Covered: btwpe');
  });

  it('the clipped line renders — derived, from the same card that granted', () => {
    expect(texts(pane([ROW]))).toMatch(/Blocked on production by the write bound/);
  });

  it('a down core states the absence, never an all-denied fabrication', () => {
    expect(texts(pane(null))).toMatch(/unavailable|not running/i);
  });
});
