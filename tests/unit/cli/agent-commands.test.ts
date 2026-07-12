/**
 * Unit tests for `nexus agent` CLI command handlers.
 *
 * Tests are isolated — no real CLI process is spawned and no Local instance is
 * required. The exported handler functions accept an injected `gqlFn` so tests
 * can supply a mock without touching the network.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  handleAgentList,
  handleAgentRun,
  handleAgentLogs,
  handleAgentEmit,
  type GqlFn,
} from '../../../src/cli/commands/agent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture console.log lines during a handler call */
async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    lines.push(args.join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

/** Capture console.error lines during a handler call */
async function captureErr(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    lines.push(args.join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

// ---------------------------------------------------------------------------
// nexus agent list
// ---------------------------------------------------------------------------

describe('handleAgentList', () => {
  it('prints one line per agent with name, version, triggers, and status', async () => {
    const gql: GqlFn = async () =>
      ({
        agentList: [
          {
            name: 'site-monitor',
            version: '1.0.0',
            description: 'Monitors WordPress sites',
            triggerTypes: ['cron', 'event'],
            status: 'registered',
          },
        ],
      }) as any;

    const lines = await captureLog(() => handleAgentList(gql));

    expect(lines.some((l) => l.includes('site-monitor'))).toBe(true);
    expect(lines.some((l) => l.includes('1.0.0'))).toBe(true);
    expect(lines.some((l) => l.includes('registered'))).toBe(true);
    expect(lines.some((l) => l.includes('cron'))).toBe(true);
  });

  it('prints description when present', async () => {
    const gql: GqlFn = async () =>
      ({
        agentList: [
          {
            name: 'site-monitor',
            version: '1.0.0',
            description: 'Monitors WordPress sites',
            triggerTypes: [],
            status: 'registered',
          },
        ],
      }) as any;

    const lines = await captureLog(() => handleAgentList(gql));
    expect(lines.some((l) => l.includes('Monitors WordPress sites'))).toBe(true);
  });

  it('prints a "no agents" message when the list is empty', async () => {
    const gql: GqlFn = async () => ({ agentList: [] }) as any;

    const lines = await captureLog(() => handleAgentList(gql));
    expect(lines.some((l) => /no agents/i.test(l))).toBe(true);
  });

  it('handles multiple agents', async () => {
    const gql: GqlFn = async () =>
      ({
        agentList: [
          { name: 'agent-a', version: '1.0.0', description: '', triggerTypes: ['cron'], status: 'registered' },
          { name: 'agent-b', version: '2.1.0', description: '', triggerTypes: ['event'], status: 'registered' },
        ],
      }) as any;

    const lines = await captureLog(() => handleAgentList(gql));
    expect(lines.some((l) => l.includes('agent-a'))).toBe(true);
    expect(lines.some((l) => l.includes('agent-b'))).toBe(true);
  });

  it('throws when the GQL call fails', async () => {
    const gql: GqlFn = async () => {
      throw new Error('Could not connect to Local');
    };

    await expect(handleAgentList(gql)).rejects.toThrow('Could not connect to Local');
  });
});

// ---------------------------------------------------------------------------
// nexus agent run
// ---------------------------------------------------------------------------

describe('handleAgentRun', () => {
  it('prints success message with agent name and duration on success', async () => {
    const gql: GqlFn = async () =>
      ({
        agentRun: {
          agentName: 'site-monitor',
          status: 'success',
          error: null,
          durationMs: 450,
        },
      }) as any;

    const lines = await captureLog(() => handleAgentRun('site-monitor', gql));
    expect(lines.some((l) => l.includes('site-monitor'))).toBe(true);
    expect(lines.some((l) => l.includes('450'))).toBe(true);
  });

  it('prints error message with agent name and error on failure', async () => {
    const gql: GqlFn = async () =>
      ({
        agentRun: {
          agentName: 'site-monitor',
          status: 'error',
          error: 'Something went wrong',
          durationMs: 10,
        },
      }) as any;

    const lines = await captureErr(() => handleAgentRun('site-monitor', gql));
    expect(lines.some((l) => l.includes('site-monitor'))).toBe(true);
    expect(lines.some((l) => l.includes('Something went wrong'))).toBe(true);
  });

  it('prints timeout message when status is timeout', async () => {
    const gql: GqlFn = async () =>
      ({
        agentRun: {
          agentName: 'slow-agent',
          status: 'timeout',
          error: 'Agent timed out after 300000ms',
          durationMs: 300000,
        },
      }) as any;

    const lines = await captureErr(() => handleAgentRun('slow-agent', gql));
    expect(lines.some((l) => l.includes('slow-agent'))).toBe(true);
    expect(lines.some((l) => /timeout/i.test(l))).toBe(true);
  });

  it('throws when the GQL call fails', async () => {
    const gql: GqlFn = async () => {
      throw new Error('Agent "missing" not found');
    };

    await expect(handleAgentRun('missing', gql)).rejects.toThrow('Agent "missing" not found');
  });
});

// ---------------------------------------------------------------------------
// nexus agent logs
// ---------------------------------------------------------------------------

describe('handleAgentLogs', () => {
  it('prints each log line returned from the server', async () => {
    const gql: GqlFn = async () =>
      ({
        agentLogs: [
          '[2026-07-12T10:00:00Z] INFO agent started',
          '[2026-07-12T10:00:01Z] INFO agent finished',
        ],
      }) as any;

    const lines = await captureLog(() =>
      handleAgentLogs('site-monitor', { lines: '50', follow: false }, gql),
    );
    expect(lines).toContain('[2026-07-12T10:00:00Z] INFO agent started');
    expect(lines).toContain('[2026-07-12T10:00:01Z] INFO agent finished');
  });

  it('prints "no logs available" when server returns empty array', async () => {
    const gql: GqlFn = async () => ({ agentLogs: [] }) as any;

    const lines = await captureLog(() =>
      handleAgentLogs('site-monitor', { lines: '50', follow: false }, gql),
    );
    expect(lines.some((l) => /no logs/i.test(l))).toBe(true);
  });

  it('passes the lines option to the GQL query', async () => {
    let capturedVars: Record<string, unknown> | undefined;
    const gql: GqlFn = async (_query: string, vars?: Record<string, unknown>) => {
      capturedVars = vars;
      return { agentLogs: [] } as any;
    };

    await captureLog(() =>
      handleAgentLogs('site-monitor', { lines: '20', follow: false }, gql),
    );
    expect(capturedVars?.lines).toBe(20);
  });

  it('passes the agent name to the GQL query', async () => {
    let capturedVars: Record<string, unknown> | undefined;
    const gql: GqlFn = async (_query: string, vars?: Record<string, unknown>) => {
      capturedVars = vars;
      return { agentLogs: [] } as any;
    };

    await captureLog(() =>
      handleAgentLogs('my-agent', { lines: '50', follow: false }, gql),
    );
    expect(capturedVars?.name).toBe('my-agent');
  });

  it('throws when the GQL call fails', async () => {
    const gql: GqlFn = async () => {
      throw new Error('Could not connect to Local');
    };

    await expect(
      handleAgentLogs('site-monitor', { lines: '50', follow: false }, gql),
    ).rejects.toThrow('Could not connect to Local');
  });
});

// ---------------------------------------------------------------------------
// nexus agent emit
// ---------------------------------------------------------------------------

describe('handleAgentEmit', () => {
  it('sends the parsed event to the bus and prints confirmation', async () => {
    let capturedVars: Record<string, unknown> | undefined;
    const gql: GqlFn = async (_query: string, vars?: Record<string, unknown>) => {
      capturedVars = vars;
      return { agentEmit: true } as any;
    };

    const lines = await captureLog(() =>
      handleAgentEmit('wp:post.published', { payload: '{}' }, gql),
    );

    expect(capturedVars?.event).toBe('wp:post.published');
    expect(lines.some((l) => l.includes('wp:post.published'))).toBe(true);
  });

  it('passes siteId when --site option is provided', async () => {
    let capturedVars: Record<string, unknown> | undefined;
    const gql: GqlFn = async (_query: string, vars?: Record<string, unknown>) => {
      capturedVars = vars;
      return { agentEmit: true } as any;
    };

    await captureLog(() =>
      handleAgentEmit(
        'local:site.started',
        { site: 'my-site-id', payload: '{}' },
        gql,
      ),
    );

    expect(capturedVars?.siteId).toBe('my-site-id');
  });

  it('passes JSON payload to the server', async () => {
    let capturedVars: Record<string, unknown> | undefined;
    const gql: GqlFn = async (_query: string, vars?: Record<string, unknown>) => {
      capturedVars = vars;
      return { agentEmit: true } as any;
    };

    await captureLog(() =>
      handleAgentEmit(
        'wp:post.published',
        { payload: '{"postId":42}' },
        gql,
      ),
    );

    expect(capturedVars?.payload).toBe('{"postId":42}');
  });

  it('throws when payload is not valid JSON', async () => {
    const gql: GqlFn = async () => ({ agentEmit: true }) as any;

    await expect(
      handleAgentEmit('wp:post.published', { payload: 'not-json' }, gql),
    ).rejects.toThrow(/valid JSON/i);
  });

  it('throws when event format is missing the colon separator', async () => {
    const gql: GqlFn = async () => ({ agentEmit: true }) as any;

    await expect(
      handleAgentEmit('badformat', { payload: '{}' }, gql),
    ).rejects.toThrow(/namespace:type/i);
  });

  it('throws when the GQL call fails', async () => {
    const gql: GqlFn = async () => {
      throw new Error('Bus unavailable');
    };

    await expect(
      handleAgentEmit('wp:post.published', { payload: '{}' }, gql),
    ).rejects.toThrow('Bus unavailable');
  });
});
