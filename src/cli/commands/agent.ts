/**
 * nexus agent — Agent Platform CLI commands
 *
 * Provides:
 *   nexus agent list                — list registered agents
 *   nexus agent run <name>          — manually trigger an agent
 *   nexus agent logs <name>         — show agent log output
 *   nexus agent emit <event>        — publish a synthetic event to the event bus
 *
 * All four commands communicate with the running Local addon via GraphQL,
 * following the same pattern as every other CLI command in this codebase.
 *
 * The core handler logic is exported as plain functions that accept an injected
 * `gqlFn` parameter so unit tests can call them without spawning a CLI process.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// GraphQL transport (same pattern as wpe.ts)
// ---------------------------------------------------------------------------

/** Injected GQL function type — injectable for testing. */
export type GqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

function getLocalConnectionInfo(): { url: string; authToken: string } | null {
  const dataDir =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || os.homedir(), 'Local')
      : path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const infoFile = path.join(dataDir, 'graphql-connection-info.json');
  try {
    return JSON.parse(fs.readFileSync(infoFile, 'utf-8'));
  } catch {
    return null;
  }
}

async function defaultGql<T>(
  query: string,
  variables?: Record<string, unknown>,
  timeout = 30_000,
): Promise<T> {
  const info = getLocalConnectionInfo();
  if (!info) throw new Error('Could not connect to Local. Is Local running?');
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(info.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${info.authToken}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// GraphQL query constants
// ---------------------------------------------------------------------------

const AGENT_STATUS_QUERY = /* GraphQL */ `
  query {
    agentStatus {
      name
      version
      description
      cronExpression
      lastRunAt
      lastRunStatus
      lastRunDurationMs
      lastRunError
    }
  }
`;

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

interface AgentStatusGql {
  name: string;
  version: string;
  description: string | null;
  cronExpression: string | null;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
}

interface AgentInfo {
  name: string;
  version: string;
  description?: string;
  triggerTypes: string[];
  status: string;
}

interface AgentRunResult {
  agentName: string;
  status: string;
  error: string | null;
  durationMs: number;
}

interface LogsOptions {
  lines: string;
  follow: boolean;
}

interface EmitOptions {
  site?: string;
  payload: string;
}

// ---------------------------------------------------------------------------
// Exported handler functions (testable without Commander)
// ---------------------------------------------------------------------------

/**
 * List all registered agents.
 *
 * @throws if the GQL call fails
 */
export async function handleAgentList(gql: GqlFn = defaultGql): Promise<void> {
  const data = await gql<{ agentList: AgentInfo[] }>(`
    query {
      agentList { name version description triggerTypes status }
    }
  `);

  if (data.agentList.length === 0) {
    console.log(
      'No agents registered. Add an agent directory to:',
      path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents'),
    );
    return;
  }

  for (const agent of data.agentList) {
    const triggers = agent.triggerTypes.join(', ') || '(no triggers)';
    console.log(`  ${agent.name} v${agent.version} [${triggers}] — ${agent.status}`);
    if (agent.description) {
      console.log(`    ${agent.description}`);
    }
  }
}

/**
 * Show all agents with last-run status in a table.
 *
 * @throws if the GQL call fails
 */
export async function handleAgentStatus(
  opts: { json?: boolean },
  gql: GqlFn = defaultGql,
): Promise<void> {
  const result = await gql<{ agentStatus: AgentStatusGql[] }>(AGENT_STATUS_QUERY);
  const agents = result.agentStatus;

  if (opts.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  if (agents.length === 0) {
    console.log('No agents registered. Create one with: nexus agent create <name>');
    return;
  }

  const NAME_W = 24;
  const TRIG_W = 20;
  const TIME_W = 22;
  const STAT_W = 10;
  const DUR_W = 10;

  const pad = (s: string, w: number) => s.slice(0, w).padEnd(w);

  console.log(
    pad('NAME', NAME_W) +
      pad('TRIGGER', TRIG_W) +
      pad('LAST RUN', TIME_W) +
      pad('STATUS', STAT_W) +
      pad('DURATION', DUR_W),
  );
  console.log('─'.repeat(NAME_W + TRIG_W + TIME_W + STAT_W + DUR_W));

  for (const a of agents) {
    const trigger = a.cronExpression ? `cron(${a.cronExpression})` : '—';
    const lastRun = a.lastRunAt
      ? new Date(a.lastRunAt).toISOString().replace('T', ' ').slice(0, 19)
      : 'never';
    const status = a.lastRunStatus ?? '—';
    const dur = a.lastRunDurationMs != null ? `${(a.lastRunDurationMs / 1000).toFixed(1)}s` : '—';
    console.log(
      pad(a.name, NAME_W) +
        pad(trigger, TRIG_W) +
        pad(lastRun, TIME_W) +
        pad(status, STAT_W) +
        pad(dur, DUR_W),
    );
  }
}

/**
 * Manually trigger an agent by name.
 *
 * @throws if the GQL call fails, the agent is not found, or the agent run fails
 */
export async function handleAgentRun(name: string, gql: GqlFn = defaultGql): Promise<void> {
  const data = await gql<{ agentRun: AgentRunResult }>(
    `
    mutation AgentRun($name: String!) {
      agentRun(name: $name) { agentName status error durationMs }
    }
  `,
    { name },
  );

  const r = data.agentRun;
  if (r.status === 'success') {
    console.log(`✓ ${r.agentName} completed in ${r.durationMs}ms`);
  } else {
    console.error(`✗ ${r.agentName} ${r.status}: ${r.error}`);
    throw new Error(`Agent run failed: ${r.status}`);
  }
}

/**
 * Show agent log output, optionally following new entries with fs.watch.
 *
 * @param _logDir - Optional override for the agent-logs directory (used in tests only).
 */
export async function handleAgentLogs(
  name: string,
  opts: LogsOptions,
  _logDir?: string,
): Promise<void> {
  const logDir =
    _logDir ??
    path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agent-logs');
  const logFile = path.join(logDir, `${name}.log`);

  if (!fs.existsSync(logFile)) {
    console.log(`No log file for agent "${name}". Run the agent first: nexus agent run ${name}`);
    return;
  }

  const linesWanted = parseInt(opts.lines, 10);
  const content = fs.readFileSync(logFile, 'utf-8');
  const allLines = content.split('\n').filter(Boolean);
  const tail = allLines.slice(-linesWanted);
  console.log(tail.join('\n'));

  if (!opts.follow) return;

  let offset = fs.statSync(logFile).size;
  const watcher = fs.watch(logFile, { persistent: false }, () => {
    try {
      const stat = fs.statSync(logFile);
      if (stat.size <= offset) {
        offset = stat.size;
        return;
      }
      const fd = fs.openSync(logFile, 'r');
      const buf = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = stat.size;
      const newLines = buf.toString('utf-8').split('\n').filter(Boolean);
      for (const line of newLines) console.log(line);
    } catch {
      /* log file may briefly disappear on rotation */
    }
  });

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      watcher.close();
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// nexus agent create — scaffold a new agent
// ---------------------------------------------------------------------------

const AGENT_TEMPLATE = (name: string) => `import { defineAgent, cron } from '@nexus-ai/agent-sdk';

export default defineAgent({
  name: '${name}',
  version: '1.0.0',
  description: 'Describe what this agent does',
  triggers: [cron('0 2 * * *')],   // daily at 2am — or change to your schedule
  tools: ['nexus_list_sites'],

  async run({ tools, state, ai, log }) {
    log.info('${name}: starting');

    const sites = await tools.invoke('nexus_list_sites', {});
    log.info(\`Found \${Array.isArray(sites) ? sites.length : 0} site(s)\`);

    // Uncomment to use AI:
    // const summary = await ai.run('Summarize: ' + JSON.stringify(sites));

    state.set('lastRunAt', Date.now());
    log.info('${name}: done');
  },
});
`;

/**
 * Scaffold a new TypeScript agent directory under `<agentsDir>/<name>/`.
 *
 * @param name      - Agent slug (lowercase letters, numbers, hyphens only)
 * @param _agentsDir - Optional override for the agents root directory (used in tests only)
 */
export async function handleAgentCreate(name: string, _agentsDir?: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(
      `Error: agent name must be lowercase letters, numbers, and hyphens (got: "${name}")`,
    );
    process.exit(1);
  }

  const agentsRoot =
    _agentsDir ??
    path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents');

  const agentDir = path.join(agentsRoot, name);

  if (fs.existsSync(agentDir)) {
    console.error(`Error: agent "${name}" already exists at ${agentDir}`);
    process.exit(1);
  }

  fs.mkdirSync(agentDir, { recursive: true });
  const agentFile = path.join(agentDir, 'agent.ts');
  fs.writeFileSync(agentFile, AGENT_TEMPLATE(name), 'utf-8');

  console.log(`Created: ${agentFile}`);
  console.log(`Run it:  nexus agent run ${name}`);
  console.log(`Watch it reload automatically when you save the file.`);
}

// ---------------------------------------------------------------------------
// nexus agent emit
// ---------------------------------------------------------------------------

/**
 * Publish a synthetic event to the agent event bus.
 *
 * @param event - Event key in `namespace:type` format (e.g. `wp:post.published`)
 * @throws if payload is invalid JSON, event format is wrong, or GQL call fails
 */
export async function handleAgentEmit(
  event: string,
  opts: EmitOptions,
  gql: GqlFn = defaultGql,
): Promise<void> {
  // Validate JSON payload before sending
  try {
    JSON.parse(opts.payload);
  } catch {
    throw new Error('--payload must be valid JSON');
  }

  // Validate event format: must contain at least one ':' separator
  const colonIdx = event.indexOf(':');
  if (colonIdx <= 0 || colonIdx === event.length - 1) {
    throw new Error(
      `Invalid event format "${event}" — expected "namespace:type" (e.g. wp:post.published)`,
    );
  }

  await gql(
    `
    mutation AgentEmit($event: String!, $siteId: String, $payload: String) {
      agentEmit(event: $event, siteId: $siteId, payload: $payload)
    }
  `,
    { event, siteId: opts.site, payload: opts.payload },
  );

  console.log(`✓ Event "${event}" published to the agent event bus`);
}

// ---------------------------------------------------------------------------
// Commander command definition
// ---------------------------------------------------------------------------

const agentCommand = new Command('agent').description('Manage Nexus AI agents');

agentCommand
  .command('list')
  .description('List all registered agents')
  .action(async () => {
    try {
      await handleAgentList();
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agentCommand
  .command('run <name>')
  .description('Manually trigger an agent by name')
  .action(async (name: string) => {
    try {
      await handleAgentRun(name);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agentCommand
  .command('logs <name>')
  .description('Show agent log output')
  .option('--lines <n>', 'Number of log lines to show', '50')
  .option('--follow', 'Stream new log lines as they are written (uses fs.watch)', false)
  .action(async (name: string, opts: LogsOptions) => {
    try {
      await handleAgentLogs(name, opts);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agentCommand
  .command('status')
  .description('Show all agents with last-run status')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      await handleAgentStatus(opts);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agentCommand
  .command('create <name>')
  .description('Scaffold a new TypeScript agent')
  .action(async (name: string) => {
    await handleAgentCreate(name);
  });

agentCommand
  .command('emit <event>')
  .description('Publish a synthetic event to the agent event bus')
  .option('--site <siteId>', 'Site ID to scope the event')
  .option('--payload <json>', 'JSON payload for the event', '{}')
  .action(async (event: string, opts: EmitOptions) => {
    try {
      await handleAgentEmit(event, opts);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

export { agentCommand };
export default agentCommand;
