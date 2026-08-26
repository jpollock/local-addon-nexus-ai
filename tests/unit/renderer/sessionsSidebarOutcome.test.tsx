/**
 * fixes-082526 · board D — the sessions list renders the outcome line.
 *
 * The mono meta line is the row's second line ("rb.bulk-plugin-update · 2 of
 * 2 verified" · when); a session without one renders NOTHING there — a blank
 * is "not derived", which is a different fact from "no run", and the deriver
 * writes 'no run armed' for that case explicitly.
 */
import React from 'react';
import { SessionsSidebar } from '../../../src/renderer/components/DockedPanel/SessionsSidebar';
import type { ChatSession } from '../../../src/common/types';

const electron = { ipcRenderer: { on: jest.fn(), invoke: jest.fn(async () => []), send: jest.fn(), removeListener: jest.fn() } };

function walk(node: any, out: any[] = []): any[] {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  out.push(node);
  const kids = node?.props?.children;
  if (kids) walk(Array.isArray(kids) ? kids : [kids], out);
  return out;
}

function renderWith(sessions: ChatSession[]): any {
  const c = new SessionsSidebar({
    electron,
    activeSessionId: null,
    onSelectSession: () => {},
    onNewSession: () => {},
  } as any);
  c.state = { ...c.state, sessions };
  return c.render();
}

const session = (id: string, over: Partial<ChatSession> = {}): ChatSession => ({
  id, title: `Session ${id}`, scopeLabel: '', scopeSiteIds: [],
  createdAt: 1, updatedAt: 1, pinned: false, actionCount: 0, expiresAt: null,
  ...over,
});

describe('sessions list × outcome meta', () => {
  it('renders the meta line, in mono, when the record carries one', () => {
    const tree = renderWith([session('a', { outcomeMeta: 'rb.bulk-plugin-update · 2 of 2 verified' })]);
    const meta = walk(tree).find((n) => {
      const kids = n?.props?.children;
      return (Array.isArray(kids) ? kids : [kids]).includes('rb.bulk-plugin-update · 2 of 2 verified');
    });
    expect(meta).toBeTruthy();
    expect(String(meta.props.style.fontFamily)).toMatch(/mono/i);
  });

  it('a session without one renders no meta row at all', () => {
    const nodes = walk(renderWith([session('a')]));
    expect(nodes.some((n) => String(n?.props?.style?.fontFamily ?? '').match(/mono/i) &&
      n?.props?.style?.fontSize === 10.5)).toBe(false);
  });
});
