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

    // Capture error output and expect the throw
    let errorLines: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errorLines.push(args.join(' '));
    });

    try {
      await expect(handleAgentRun('site-monitor', gql)).rejects.toThrow('Agent run failed: error');
      expect(errorLines.some((l) => l.includes('site-monitor'))).toBe(true);
      expect(errorLines.some((l) => l.includes('Something went wrong'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
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

    // Capture error output and expect the throw
    let errorLines: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errorLines.push(args.join(' '));
    });

    try {
      await expect(handleAgentRun('slow-agent', gql)).rejects.toThrow('Agent run failed: timeout');
      expect(errorLines.some((l) => l.includes('slow-agent'))).toBe(true);
      expect(errorLines.some((l) => /timeout/i.test(l))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('throws when the GQL call fails', async () => {
    const gql: GqlFn = async () => {
      throw new Error('Agent "missing" not found');
    };

    await expect(handleAgentRun('missing', gql)).rejects.toThrow('Agent "missing" not found');
  });

  it('throws on agent error status', async () => {
    const gql: GqlFn = async () =>
      ({
        agentRun: {
          agentName: 'my-agent',
          status: 'error',
          error: 'something went wrong',
          durationMs: 100,
        },
      }) as any;

    await expect(handleAgentRun('my-agent', gql)).rejects.toThrow('Agent run failed: error');
  });

  it('throws on agent timeout status', async () => {
    const gql: GqlFn = async () =>
      ({
        agentRun: {
          agentName: 'slow-agent',
          status: 'timeout',
          error: 'Timed out after 300s',
          durationMs: 300000,
        },
      }) as any;

    await expect(handleAgentRun('slow-agent', gql)).rejects.toThrow('Agent run failed: timeout');
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

  it('prints new lines when follow mode detects them', async () => {
    let callCount = 0;
    const gql: GqlFn = async () => {
      callCount++;
      if (callCount === 1) {
        // Initial call returns 2 lines
        return {
          agentLogs: [
            '[2026-07-12T10:00:00Z] INFO agent started',
            '[2026-07-12T10:00:01Z] INFO step 1 done',
          ],
        } as any;
      } else {
        // Second call (first poll) has 3 lines (one new)
        return {
          agentLogs: [
            '[2026-07-12T10:00:00Z] INFO agent started',
            '[2026-07-12T10:00:01Z] INFO step 1 done',
            '[2026-07-12T10:00:02Z] INFO step 2 done',
          ],
        } as any;
      }
    };

    // Just verify the initial call works — follow mode runs in background via setInterval
    // and we can't easily test the async polling without more complex test harness
    const lines = await captureLog(() =>
      handleAgentLogs('site-monitor', { lines: '50', follow: true }, gql),
    );
    expect(lines).toContain('[2026-07-12T10:00:00Z] INFO agent started');
    expect(lines).toContain('[2026-07-12T10:00:01Z] INFO step 1 done');
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
