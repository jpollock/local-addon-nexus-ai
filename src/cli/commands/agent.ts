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
// Handler types
// ---------------------------------------------------------------------------

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
 * Show agent log output.
 *
 * @throws if the GQL call fails
 */
export async function handleAgentLogs(
  name: string,
  opts: LogsOptions,
  gql: GqlFn = defaultGql,
): Promise<void> {
  const lines = parseInt(opts.lines, 10);
  const data = await gql<{ agentLogs: string[] }>(
    `
    query AgentLogs($name: String!, $lines: Int) {
      agentLogs(name: $name, lines: $lines)
    }
  `,
    { name, lines },
  );

  if (data.agentLogs.length === 0) {
    console.log(`No logs available for agent "${name}".`);
    return;
  }

  for (const line of data.agentLogs) {
    console.log(line);
  }
}

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
  .option('--follow', 'Stream log output (polls every 2s)', false)
  .action(async (name: string, opts: LogsOptions) => {
    try {
      await handleAgentLogs(name, opts);

      if (opts.follow) {
        // Follow mode: track position by count, request all logs each poll
        let lastSeenCount = 0;
        // Get initial count from the logs we just printed
        const initialData = await defaultGql<{ agentLogs: string[] }>(
          `query AgentLogs($name: String!, $lines: Int) {
            agentLogs(name: $name, lines: $lines)
          }`,
          { name, lines: 10000 },
        );
        lastSeenCount = initialData.agentLogs.length;

        setInterval(async () => {
          try {
            // Always request all logs (no limit) to get complete history
            const fresh = await defaultGql<{ agentLogs: string[] }>(
              `query AgentLogs($name: String!, $lines: Int) {
                agentLogs(name: $name, lines: $lines)
              }`,
              { name, lines: 10000 }, // Request a large window to catch all logs
            );
            // Slice from the last position we saw to get only new lines
            const newLines = fresh.agentLogs.slice(lastSeenCount);
            for (const line of newLines) {
              console.log(line);
            }
            // Update position for next poll
            lastSeenCount = fresh.agentLogs.length;
          } catch {
            // Silently ignore poll errors — Local may have restarted
          }
        }, 2000);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
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
