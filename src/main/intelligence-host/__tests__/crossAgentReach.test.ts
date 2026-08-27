/**
 * §D.7 · the dispatch seam names its caller (owner ruling 2026-08-26, C).
 * Spec: docs/planning/2026-08-26-cross-agent-reach.md
 *
 * `agentGranteeGate.test.ts` pins the RULE (every party must hold the same
 * capability). This file pins the SEAM: that the dispatcher is TOLD who is
 * calling, and that all four production entry points tell it. Before this
 * packet `AgentDispatcher.dispatch` had no caller parameter at all, so the gate
 * consulted the CONTRIBUTOR's grants — the §D.7 escape, shipped by accident
 * with actor-scoping.
 */
import * as fs from 'fs';
import * as path from 'path';

const checkSpy = jest.fn(() => null);
jest.mock('../sequenceGuard', () => ({
  ...jest.requireActual('../sequenceGuard'),
  checkCheckpointSequence: (...args: unknown[]) => checkSpy(...(args as [])),
}));

import { AgentDispatcher } from '../../agent-runtime/AgentDispatcher';

const REPO = path.join(__dirname, '..', '..', '..', '..');

function dispatcherFor(agentName: string, toolName: string) {
  const registered = {
    agentName, toolName, permissionTier: 2, executionMode: 'function' as const,
    handler: async () => ({ content: [{ type: 'text' as const, text: 'ran' }] }),
  };
  const contributedRegistry = {
    get: (a: string, t: string) => (a === agentName && t === toolName ? registered : undefined),
  };
  return new AgentDispatcher(
    contributedRegistry as never,
    { call: async () => ({ content: [] }) } as never,
    { operationAuditLog: { log: () => {} } } as never,
    undefined as never, undefined as never, undefined as never,
  );
}

beforeEach(() => checkSpy.mockClear());

describe('the dispatcher is told who is calling', () => {
  it('forwards BOTH parties — the caller first, then the contributor whose code runs', async () => {
    const d = dispatcherFor('log-processor', 'get_log_aggregates');
    await d.dispatch('log-processor', 'get_log_aggregates', {}, undefined, 'seo-insights');

    expect(checkSpy).toHaveBeenCalledTimes(1);
    const [tool, , parties] = checkSpy.mock.calls[0] as unknown as [string, unknown, unknown];
    expect(tool).toBe('log-processor/get_log_aggregates');
    expect(parties).toEqual(['seo-insights', 'log-processor']);
  });

  it('a caller-less dispatch is UNATTRIBUTED, not credited to the contributor — fail closed', async () => {
    // The pre-packet shape passed the contributor as the grantee, which is the
    // escape itself. Absence must read as "could not be attributed", which
    // holds nothing, so a future entry point that forgets is refused loudly
    // rather than served quietly.
    const d = dispatcherFor('log-processor', 'get_log_aggregates');
    await d.dispatch('log-processor', 'get_log_aggregates', {});

    const parties = (checkSpy.mock.calls[0] as unknown as [string, unknown, unknown])[2];
    expect(parties).toEqual([undefined, 'log-processor']);
  });

  it('an agent calling its OWN tool is one party, not a doubled one', async () => {
    const d = dispatcherFor('log-processor', 'get_log_aggregates');
    await d.dispatch('log-processor', 'get_log_aggregates', {}, undefined, 'log-processor');

    const parties = (checkSpy.mock.calls[0] as unknown as [string, unknown, unknown])[2];
    expect(parties).toEqual(['log-processor']);
  });
});

describe('every production dispatch site names a caller', () => {
  /** The four entry points measured 2026-08-26; a fifth must not arrive silently. */
  const SITES = [
    'src/main/agent-runtime/NexusToolProvider.ts',
    'src/main/mcp/McpServer.ts',
    'src/main/chat/ChatService.ts',
    'src/main/ipc-handlers.ts',
  ];

  /**
   * Top-level argument count of the call starting at `from` (an open paren).
   * Counts NON-EMPTY segments: a trailing comma before `)` is house style here
   * and counting it as an argument made ChatService's four-argument call read
   * as five — a guard that passed against the very gap it exists to catch.
   */
  function argCount(src: string, from: number): number {
    let depth = 0;
    const segments: string[] = [];
    let current = '';
    for (let i = from; i < src.length; i++) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1) continue; }
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth === 0) { segments.push(current); break; }
      } else if (c === ',' && depth === 1) { segments.push(current); current = ''; continue; }
      current += c;
    }
    return segments.filter((seg) => seg.trim().length > 0).length;
  }

  it.each(SITES)('%s passes a caller to dispatch()', (rel) => {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    // Anchored on the dispatcher IDENTIFIER, not on `.dispatch(`: the bare
    // form also matches McpServer's own private JSON-RPC `dispatch(request)`
    // and — measured here — a PROSE mention of `AgentDispatcher.dispatch()`
    // in a comment, whose empty argument list failed the guard for no reason.
    const calls = [...src.matchAll(/dispatcher\??\.dispatch\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) {
      expect(argCount(src, m.index! + m[0].length - 1)).toBeGreaterThanOrEqual(5);
    }
  });

  it('finds no dispatch site outside the four — a new one must be ruled, not inherited', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out); }
        else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
      }
      return out;
    };
    const found = walk(path.join(REPO, 'src'))
      .filter((f) => !f.endsWith('AgentDispatcher.ts'))
      .filter((f) => /dispatcher\??\.dispatch\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO, f));
    expect(found.sort()).toEqual([...SITES].sort());
  });
});
