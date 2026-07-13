/**
 * Unit tests for `nexus agent` CLI command handlers.
 *
 * Tests are isolated — no real CLI process is spawned and no Local instance is
 * required. The exported handler functions accept an injected `gqlFn` so tests
 * can supply a mock without touching the network.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// os is used for os.tmpdir() in test setup
import {
  handleAgentList,
  handleAgentRun,
  handleAgentLogs,
  handleAgentEmit,
  handleAgentStatus,
  handleAgentCreate,
  handleAgentValidate,
  handleAgentInstall,
  type GqlFn,
  type ExecSyncFn,
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
// nexus agent logs (filesystem-based since --follow was replaced with fs.watch)
// ---------------------------------------------------------------------------

describe('handleAgentLogs', () => {
  let logDir: string;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-logs-test-'));
  });

  afterEach(() => {
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('prints each log line read from the log file', async () => {
    fs.writeFileSync(
      path.join(logDir, 'site-monitor.log'),
      '[2026-07-12T10:00:00Z] INFO agent started\n[2026-07-12T10:00:01Z] INFO agent finished\n',
    );

    const lines = await captureLog(() =>
      handleAgentLogs('site-monitor', { lines: '50', follow: false }, logDir),
    );
    const joined = lines.join('\n');
    expect(joined).toContain('[2026-07-12T10:00:00Z] INFO agent started');
    expect(joined).toContain('[2026-07-12T10:00:01Z] INFO agent finished');
  });

  it('prints a "no log file" message when the file does not exist', async () => {
    const lines = await captureLog(() =>
      handleAgentLogs('missing-agent', { lines: '50', follow: false }, logDir),
    );
    expect(lines.some((l) => /no log file/i.test(l))).toBe(true);
  });

  it('respects the --lines option (tail behavior)', async () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    fs.writeFileSync(path.join(logDir, 'site-monitor.log'), content);

    const lines = await captureLog(() =>
      handleAgentLogs('site-monitor', { lines: '3', follow: false }, logDir),
    );
    const joined = lines.join('\n');
    expect(joined).toContain('line 8');
    expect(joined).toContain('line 9');
    expect(joined).toContain('line 10');
    // 'line 1' is a substring of 'line 10', so check for 'line 1\n' specifically
    expect(joined).not.toMatch(/^line 1$/m);
    expect(joined).not.toMatch(/^line 2$/m);
  });

  it('reads the correct log file for the given agent name', async () => {
    fs.writeFileSync(path.join(logDir, 'my-agent.log'), 'hello from my-agent\n');

    const lines = await captureLog(() =>
      handleAgentLogs('my-agent', { lines: '50', follow: false }, logDir),
    );
    expect(lines.join('\n')).toContain('hello from my-agent');
  });
});

// ---------------------------------------------------------------------------
// nexus agent status
// ---------------------------------------------------------------------------

describe('handleAgentStatus', () => {
  it('prints a table with agent name, trigger, and last-run info', async () => {
    const gql: GqlFn = async () =>
      ({
        agentStatus: [
          {
            name: 'hello-nexus',
            version: '1.0.0',
            description: 'Demo agent',
            cronExpression: '*/5 * * * *',
            lastRunAt: new Date('2026-07-12T10:00:00Z').getTime(),
            lastRunStatus: 'success',
            lastRunDurationMs: 1234,
            lastRunError: null,
          },
        ],
      }) as any;

    const lines = await captureLog(() => handleAgentStatus({}, gql));
    const joined = lines.join('\n');
    expect(joined).toContain('hello-nexus');
    expect(joined).toContain('cron(');
    expect(joined).toContain('success');
    expect(joined).toContain('1.2s');
  });

  it('prints "never" and "—" for agents that have not run', async () => {
    const gql: GqlFn = async () =>
      ({
        agentStatus: [
          {
            name: 'hello-nexus',
            version: '1.0.0',
            description: null,
            cronExpression: null,
            lastRunAt: null,
            lastRunStatus: null,
            lastRunDurationMs: null,
            lastRunError: null,
          },
        ],
      }) as any;

    const lines = await captureLog(() => handleAgentStatus({}, gql));
    const joined = lines.join('\n');
    expect(joined).toContain('never');
    expect(joined).toContain('—');
  });

  it('outputs JSON when --json is passed', async () => {
    const gql: GqlFn = async () =>
      ({
        agentStatus: [
          {
            name: 'hello-nexus',
            version: '1.0.0',
            description: null,
            cronExpression: null,
            lastRunAt: null,
            lastRunStatus: null,
            lastRunDurationMs: null,
            lastRunError: null,
          },
        ],
      }) as any;

    const lines = await captureLog(() => handleAgentStatus({ json: true }, gql));
    const parsed = JSON.parse(lines.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe('hello-nexus');
  });

  it('prints "no agents registered" when list is empty', async () => {
    const gql: GqlFn = async () => ({ agentStatus: [] }) as any;

    const lines = await captureLog(() => handleAgentStatus({}, gql));
    expect(lines.some((l) => /no agents/i.test(l))).toBe(true);
  });

  it('throws when the GQL call fails', async () => {
    const gql: GqlFn = async () => {
      throw new Error('Could not connect to Local');
    };

    await expect(handleAgentStatus({}, gql)).rejects.toThrow('Could not connect to Local');
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

// ---------------------------------------------------------------------------
// nexus agent create (filesystem-based scaffolding)
// ---------------------------------------------------------------------------

describe('handleAgentCreate', () => {
  let agentsDir: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let logLines: string[];
  let errLines: string[];
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-create-test-'));

    // Make process.exit throw so we can assert on it in tests
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });

    logLines = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logLines.push(args.join(' '));
    });

    errLines = [];
    errSpy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    fs.rmSync(agentsDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('creates the agent directory and agent.ts file on success', async () => {
    await handleAgentCreate('my-agent', agentsDir);

    const agentDir = path.join(agentsDir, 'my-agent');
    const agentFile = path.join(agentDir, 'agent.ts');
    expect(fs.existsSync(agentDir)).toBe(true);
    expect(fs.existsSync(agentFile)).toBe(true);
  });

  it('writes the agent name into the template', async () => {
    await handleAgentCreate('hello-world', agentsDir);

    const agentFile = path.join(agentsDir, 'hello-world', 'agent.ts');
    const content = fs.readFileSync(agentFile, 'utf-8');
    expect(content).toContain("name: 'hello-world'");
    expect(content).toContain("'hello-world: starting'");
    expect(content).toContain("'hello-world: done'");
  });

  it('template contains defineAgent and cron imports', async () => {
    await handleAgentCreate('my-agent', agentsDir);

    const content = fs.readFileSync(path.join(agentsDir, 'my-agent', 'agent.ts'), 'utf-8');
    expect(content).toContain("from '@nexus-ai/agent-sdk'");
    expect(content).toContain('defineAgent');
    expect(content).toContain('cron(');
  });

  it('prints the created file path and run hint', async () => {
    await handleAgentCreate('my-agent', agentsDir);

    expect(logLines.some((l) => l.includes('agent.ts'))).toBe(true);
    expect(logLines.some((l) => l.includes('nexus agent run my-agent'))).toBe(true);
  });

  it('exits with error when name contains uppercase letters', async () => {
    await expect(handleAgentCreate('MyAgent', agentsDir)).rejects.toThrow('process.exit(1)');
    expect(errLines.some((l) => /lowercase/i.test(l))).toBe(true);
  });

  it('exits with error when name contains spaces', async () => {
    await expect(handleAgentCreate('my agent', agentsDir)).rejects.toThrow('process.exit(1)');
    expect(errLines.some((l) => /lowercase/i.test(l))).toBe(true);
  });

  it('exits with error when name starts with a hyphen', async () => {
    await expect(handleAgentCreate('-bad', agentsDir)).rejects.toThrow('process.exit(1)');
    expect(errLines.some((l) => /lowercase/i.test(l))).toBe(true);
  });

  it('exits with error when agent already exists', async () => {
    // Create the directory first so it "already exists"
    fs.mkdirSync(path.join(agentsDir, 'existing-agent'), { recursive: true });

    await expect(handleAgentCreate('existing-agent', agentsDir)).rejects.toThrow('process.exit(1)');
    expect(errLines.some((l) => /already exists/i.test(l))).toBe(true);
  });

  it('does not overwrite an existing agent directory', async () => {
    const agentDir = path.join(agentsDir, 'existing-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    const sentinel = path.join(agentDir, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'do-not-delete');

    try {
      await handleAgentCreate('existing-agent', agentsDir);
    } catch {
      // expected process.exit(1) throw
    }

    // Sentinel file must still exist — we didn't wipe the dir
    expect(fs.existsSync(sentinel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nexus agent validate
// ---------------------------------------------------------------------------

describe('handleAgentValidate', () => {
  let agentsDir: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let logLines: string[];
  let errLines: string[];
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;

  /** A mock execSync that succeeds (no throw) */
  const execSyncOk: ExecSyncFn = (_cmd, _opts) => Buffer.from('');

  /** A mock execSync that fails with TS errors */
  const execSyncFail: ExecSyncFn = (_cmd, _opts) => {
    const err: any = new Error('tsc failed');
    err.stdout = Buffer.from('agent.ts(1,5): error TS2322: Type mismatch');
    err.stderr = Buffer.from('');
    throw err;
  };

  beforeEach(() => {
    agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-validate-test-'));

    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });

    logLines = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logLines.push(args.join(' '));
    });

    errLines = [];
    errSpy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    fs.rmSync(agentsDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('prints "No agents directory found." when agents dir does not exist', async () => {
    const nonexistent = path.join(os.tmpdir(), `nexus-no-such-dir-${Date.now()}`);
    await handleAgentValidate(undefined, nonexistent, execSyncOk);
    expect(logLines.some((l) => /no agents directory/i.test(l))).toBe(true);
  });

  it('exits with error when named agent directory does not exist', async () => {
    await expect(handleAgentValidate('missing-agent', agentsDir, execSyncOk)).rejects.toThrow(
      'process.exit(1)',
    );
    expect(errLines.some((l) => l.includes('missing-agent'))).toBe(true);
  });

  it('prints "No agents found to validate." when agents dir is empty', async () => {
    await handleAgentValidate(undefined, agentsDir, execSyncOk);
    expect(logLines.some((l) => /no agents found/i.test(l))).toBe(true);
  });

  it('prints "(no TypeScript validation)" for agents with agent.js (no .ts file)', async () => {
    const agentSubdir = path.join(agentsDir, 'js-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });
    fs.writeFileSync(path.join(agentSubdir, 'agent.js'), 'module.exports = {};');

    await handleAgentValidate(undefined, agentsDir, execSyncOk);

    expect(logLines.some((l) => l.includes('js-agent') && /no TypeScript/i.test(l))).toBe(true);
  });

  it('prints "✓ TypeScript OK" when execSync succeeds', async () => {
    const agentSubdir = path.join(agentsDir, 'good-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });
    fs.writeFileSync(path.join(agentSubdir, 'agent.ts'), '// valid ts');

    await handleAgentValidate(undefined, agentsDir, execSyncOk);

    expect(logLines.some((l) => l.includes('good-agent') && l.includes('TypeScript OK'))).toBe(true);
  });

  it('prints "✗ TypeScript errors:" and exits with code 1 when execSync throws', async () => {
    const agentSubdir = path.join(agentsDir, 'bad-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });
    fs.writeFileSync(path.join(agentSubdir, 'agent.ts'), 'const x: number = "not a number";');

    await expect(handleAgentValidate(undefined, agentsDir, execSyncFail)).rejects.toThrow(
      'process.exit(1)',
    );

    expect(errLines.some((l) => l.includes('bad-agent') && /TypeScript errors/i.test(l))).toBe(true);
  });

  it('includes the tsc error output in the error lines', async () => {
    const agentSubdir = path.join(agentsDir, 'bad-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });
    fs.writeFileSync(path.join(agentSubdir, 'agent.ts'), 'const x: number = "nope";');

    try {
      await handleAgentValidate(undefined, agentsDir, execSyncFail);
    } catch {
      // process.exit(1) throw
    }

    const allErr = errLines.join('\n');
    expect(allErr).toContain('TS2322');
  });

  it('validates a named agent by name when found', async () => {
    const agentSubdir = path.join(agentsDir, 'named-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });
    fs.writeFileSync(path.join(agentSubdir, 'agent.ts'), '// valid');

    await handleAgentValidate('named-agent', agentsDir, execSyncOk);

    expect(logLines.some((l) => l.includes('named-agent') && l.includes('TypeScript OK'))).toBe(true);
  });

  it('skips node_modules directories when validating all agents', async () => {
    // Create a node_modules dir (should be skipped) and a real agent dir
    const nodeModulesDir = path.join(agentsDir, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(path.join(nodeModulesDir, 'agent.ts'), '// should not be validated');

    const realAgentDir = path.join(agentsDir, 'real-agent');
    fs.mkdirSync(realAgentDir, { recursive: true });
    fs.writeFileSync(path.join(realAgentDir, 'agent.ts'), '// valid');

    await handleAgentValidate(undefined, agentsDir, execSyncOk);

    // node_modules should not appear in log
    expect(logLines.some((l) => l.includes('node_modules'))).toBe(false);
    // real-agent should appear
    expect(logLines.some((l) => l.includes('real-agent'))).toBe(true);
  });

  it('exits with code 1 when at least one of multiple agents fails TS check', async () => {
    const goodDir = path.join(agentsDir, 'good-agent');
    fs.mkdirSync(goodDir, { recursive: true });
    fs.writeFileSync(path.join(goodDir, 'agent.ts'), '// ok');

    const badDir = path.join(agentsDir, 'bad-agent');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'agent.ts'), '// broken');

    // execSync fails for bad-agent, succeeds for good-agent based on filename
    const selectiveExecSync: ExecSyncFn = (cmd, opts) => {
      if (cmd.includes('bad-agent')) return execSyncFail(cmd, opts);
      return execSyncOk(cmd, opts);
    };

    await expect(handleAgentValidate(undefined, agentsDir, selectiveExecSync)).rejects.toThrow(
      'process.exit(1)',
    );

    // good-agent should still show OK
    expect(logLines.some((l) => l.includes('good-agent') && l.includes('TypeScript OK'))).toBe(true);
    // bad-agent should show error
    expect(errLines.some((l) => l.includes('bad-agent') && /TypeScript errors/i.test(l))).toBe(true);
  });

  it('does not exit with an error when all agents pass TS check', async () => {
    const agentADir = path.join(agentsDir, 'agent-a');
    fs.mkdirSync(agentADir, { recursive: true });
    fs.writeFileSync(path.join(agentADir, 'agent.ts'), '// ok');

    const agentBDir = path.join(agentsDir, 'agent-b');
    fs.mkdirSync(agentBDir, { recursive: true });
    fs.writeFileSync(path.join(agentBDir, 'agent.ts'), '// ok');

    // Should not throw
    await expect(handleAgentValidate(undefined, agentsDir, execSyncOk)).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('Phase 2 tools OK — all declared tools exist in runtime', async () => {
    const agentSubdir = path.join(agentsDir, 'tools-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });

    // Write a minimal valid TS agent with tools declared
    const agentContent = `
export default {
  name: 'tools-agent',
  version: '1.0.0',
  tools: ['list_sites', 'nexus_list_sites']
};
`;
    fs.writeFileSync(path.join(agentSubdir, 'agent.ts'), agentContent);

    // Mock gql to return matching tools
    const mockGql: GqlFn = async () =>
      ({
        mcpTools: [{ name: 'list_sites' }, { name: 'nexus_list_sites' }],
      }) as any;

    await handleAgentValidate('tools-agent', agentsDir, execSyncOk, mockGql);

    expect(logLines.some((l) => l.includes('tools-agent') && l.includes('Tools OK'))).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('Phase 2 tools error — declared tool not in runtime', async () => {
    const agentSubdir = path.join(agentsDir, 'bad-tools-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });

    // Agent declares a nonexistent tool
    const agentContent = `
export default {
  name: 'bad-tools-agent',
  version: '1.0.0',
  tools: ['nonexistent_tool', 'list_sites']
};
`;
    fs.writeFileSync(path.join(agentSubdir, 'agent.ts'), agentContent);

    // Mock gql to return only one tool (missing 'nonexistent_tool')
    const mockGql: GqlFn = async () =>
      ({
        mcpTools: [{ name: 'list_sites' }],
      }) as any;

    await expect(handleAgentValidate('bad-tools-agent', agentsDir, execSyncOk, mockGql)).rejects.toThrow(
      'process.exit(1)',
    );

    expect(errLines.some((l) => l.includes('bad-tools-agent') && l.includes('Unknown tools'))).toBe(true);
    expect(errLines.some((l) => l.includes('nonexistent_tool'))).toBe(true);
  });

  it('Phase 2 skipped — Local not running (gql rejects)', async () => {
    const agentSubdir = path.join(agentsDir, 'skip-agent');
    fs.mkdirSync(agentSubdir, { recursive: true });

    // Agent declares tools
    const agentContent = `
export default {
  name: 'skip-agent',
  version: '1.0.0',
  tools: ['list_sites']
};
`;
    fs.writeFileSync(path.join(agentSubdir, 'agent.ts'), agentContent);

    // Mock gql to reject (Local not running)
    const mockGql: GqlFn = async () => {
      throw new Error('Could not connect to Local');
    };

    await handleAgentValidate('skip-agent', agentsDir, execSyncOk, mockGql);

    expect(logLines.some((l) => l.includes('skip-agent') && /skipped/i.test(l))).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// nexus agent install
// ---------------------------------------------------------------------------

describe('handleAgentInstall', () => {
  let agentsDir: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let logLines: string[];
  let errLines: string[];
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;

  /** A mock execSync that succeeds (no throw) */
  const execSyncOk: ExecSyncFn = (_cmd, _opts) => Buffer.from('');

  /** A mock execSync that fails (simulates npm 404) */
  const execSyncFail: ExecSyncFn = (_cmd, _opts) => {
    throw new Error('npm ERR! 404 Not Found');
  };

  beforeEach(() => {
    agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-install-test-'));

    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });

    logLines = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logLines.push(args.join(' '));
    });

    errLines = [];
    errSpy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errLines.push(args.join(' '));
    });
  });

  afterEach(() => {
    fs.rmSync(agentsDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('creates the agents directory if it does not exist', async () => {
    const newDir = path.join(agentsDir, 'subdir-that-does-not-exist');
    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await handleAgentInstall('my-pkg', newDir, execSyncOk, gql);

    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('prints "Installing <pkg>..." before running npm install', async () => {
    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await handleAgentInstall('my-pkg', agentsDir, execSyncOk, gql);

    expect(logLines.some((l) => l.includes('Installing my-pkg'))).toBe(true);
  });

  it('prints installed name and version from package.json on success', async () => {
    // Simulate npm install by pre-creating the package.json
    const pkgDir = path.join(agentsDir, 'node_modules', 'my-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'my-pkg', version: '1.2.3' }),
    );

    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await handleAgentInstall('my-pkg', agentsDir, execSyncOk, gql);

    const joined = logLines.join('\n');
    expect(joined).toContain('my-pkg');
    expect(joined).toContain('1.2.3');
  });

  it('prints "v?" when package.json is not present after install', async () => {
    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await handleAgentInstall('no-manifest-pkg', agentsDir, execSyncOk, gql);

    expect(logLines.some((l) => l.includes('no-manifest-pkg') && l.includes('v?'))).toBe(true);
  });

  it('prints registry-reloaded message when agentReload mutation succeeds', async () => {
    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await handleAgentInstall('my-pkg', agentsDir, execSyncOk, gql);

    expect(logLines.some((l) => /reloaded/i.test(l))).toBe(true);
  });

  it('prints fallback message and does not throw when agentReload mutation fails', async () => {
    const gql: GqlFn = async () => {
      throw new Error('Local not running');
    };

    // Should resolve without throwing
    await expect(handleAgentInstall('my-pkg', agentsDir, execSyncOk, gql)).resolves.toBeUndefined();
    expect(logLines.some((l) => /restart local/i.test(l))).toBe(true);
  });

  it('exits with code 1 and prints error message when npm install fails', async () => {
    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await expect(
      handleAgentInstall('nonexistent-pkg-xyz-404', agentsDir, execSyncFail, gql),
    ).rejects.toThrow('process.exit(1)');

    expect(errLines.some((l) => /install failed/i.test(l))).toBe(true);
  });

  it('calls the agentReload mutation after successful install', async () => {
    let mutationCalled = false;
    const gql: GqlFn = async (query) => {
      if (query.includes('agentReload')) mutationCalled = true;
      return { agentReload: true } as any;
    };

    await handleAgentInstall('my-pkg', agentsDir, execSyncOk, gql);

    expect(mutationCalled).toBe(true);
  });

  it('exits with code 1 when package name contains shell-special characters', async () => {
    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await expect(
      handleAgentInstall('evil; rm -rf /', agentsDir, execSyncOk, gql),
    ).rejects.toThrow('process.exit(1)');

    expect(errLines.some((l) => /invalid package name/i.test(l))).toBe(true);
  });

  it('exits with code 1 when package name contains backtick injection', async () => {
    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await expect(
      handleAgentInstall('evil`whoami`', agentsDir, execSyncOk, gql),
    ).rejects.toThrow('process.exit(1)');

    expect(errLines.some((l) => /invalid package name/i.test(l))).toBe(true);
  });

  it('does not call agentReload when npm install fails', async () => {
    let mutationCalled = false;
    const gql: GqlFn = async (query) => {
      if (query.includes('agentReload')) mutationCalled = true;
      return { agentReload: true } as any;
    };

    try {
      await handleAgentInstall('bad-pkg', agentsDir, execSyncFail, gql);
    } catch {
      // expected process.exit(1)
    }

    expect(mutationCalled).toBe(false);
  });

  it('handles scoped packages (@scope/name) — reads correct package.json path', async () => {
    // Scoped packages live at node_modules/@scope/name/package.json
    const pkgDir = path.join(agentsDir, 'node_modules', '@myorg', 'my-agent');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@myorg/my-agent', version: '2.0.0' }),
    );

    const gql: GqlFn = async () => ({ agentReload: true }) as any;

    await handleAgentInstall('@myorg/my-agent', agentsDir, execSyncOk, gql);

    const joined = logLines.join('\n');
    expect(joined).toContain('@myorg/my-agent');
    expect(joined).toContain('2.0.0');
  });
});
