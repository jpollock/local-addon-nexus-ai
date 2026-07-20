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

/** Injected execSync function type — injectable for testing. */
export type ExecSyncFn = (command: string, options?: { stdio?: string; cwd?: string }) => Buffer | string;

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

const AGENT_RELOAD_MUTATION = /* GraphQL */ `
  mutation {
    agentReload
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
export async function handleAgentRun(
  name: string,
  opts: { install?: string } = {},
  gql: GqlFn = defaultGql,
): Promise<void> {
  if (opts.install) {
    // Scope the run to a specific WPE install by emitting wpe:sync.completed.
    // Pass installName — the agent resolves the siteId via its own fleet_sql call.
    const payload = JSON.stringify({ installName: opts.install });
    await handleAgentEmit('wpe:sync.completed', { payload }, gql);
    console.log(`✓ Triggered ${name} scoped to install "${opts.install}"`);
    console.log(`  Follow logs: nexus agent logs ${name} --follow`);
    return;
  }

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
    path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', name, 'logs');
  const logFile = path.join(logDir, 'agent.log');

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

  // Format a raw log line: strip [LEVEL] ISO-TIMESTAMP prefix, colorize by level
  const RESET = '\x1b[0m', DIM = '\x1b[2m', YELLOW = '\x1b[33m', RED = '\x1b[31m', CYAN = '\x1b[36m';
  const formatLine = (raw: string): string => {
    const m = raw.match(/^\[(\w+)\]\s+[\d\-T:.Z]+\s+(.+)$/);
    if (!m) return raw;
    const [, level, msg] = m;
    const now = new Date();
    const ts = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
    const color = level === 'WARN' ? YELLOW : level === 'ERROR' ? RED : level === 'DEBUG' ? DIM : RESET;
    return `${DIM}${ts}${RESET}  ${color}${msg}${RESET}`;
  };

  // Poll every 250ms — more reliable than fs.watch on macOS kqueue for fast-written files
  let offset = fs.statSync(logFile).size;
  const poll = () => {
    try {
      const stat = fs.statSync(logFile);
      if (stat.size < offset) offset = 0; // log rotated
      if (stat.size <= offset) return;
      const fd = fs.openSync(logFile, 'r');
      const buf = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = stat.size;
      buf.toString('utf-8').split('\n').filter(Boolean).forEach(line => console.log(formatLine(line)));
    } catch { /* log file may briefly disappear on rotation */ }
  };

  console.log(`${CYAN}Following ${logFile} — Ctrl+C to stop${RESET}\n`);
  const interval = setInterval(poll, 250);

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      clearInterval(interval);
      console.log('\n');
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// nexus agent install — install an npm agent package
// ---------------------------------------------------------------------------

/**
 * Install a published agent package from npm into the agents directory,
 * then trigger a hot reload of the agent registry via the agentReload mutation.
 *
 * @param pkg         - npm package name (e.g. `my-agent` or `@scope/my-agent`)
 * @param _agentsDir  - Optional override for the agents root directory (used in tests only)
 * @param execSyncFn  - Optional override for child_process.execSync (used in tests only)
 * @param gql         - Optional override for the GQL transport (used in tests only)
 */
export async function handleAgentInstall(
  pkg: string,
  _agentsDir?: string,
  execSyncFn?: ExecSyncFn,
  gql: GqlFn = defaultGql,
): Promise<void> {
  const agentsDir =
    _agentsDir ??
    path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents');

  fs.mkdirSync(agentsDir, { recursive: true });

  // Validate the package name before shell interpolation to prevent injection attacks.
  // Accepts: plain names (e.g. "my-agent"), scoped names ("@scope/my-agent"),
  // and optionally a version specifier ("my-agent@1.0.0", "@scope/pkg@^2").
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^\s'"`;|&<>]+)?$/.test(pkg)) {
    console.error(`Invalid package name: ${pkg}`);
    process.exit(1);
    return;
  }

  console.log(`Installing ${pkg}...`);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const execSync = execSyncFn ?? (require('child_process') as typeof import('child_process')).execSync;
  try {
    execSync(`npm install ${pkg} --prefix "${agentsDir}" --no-fund --no-audit`, {
      stdio: 'inherit',
      cwd: agentsDir,
    });
  } catch {
    console.error(`\nInstall failed. Make sure the package name is correct.`);
    process.exit(1);
  }

  // Read the installed package's metadata
  const pkgName = pkg.startsWith('@') ? pkg : pkg.split('@')[0];
  const pkgJsonPath = path.join(agentsDir, 'node_modules', pkgName, 'package.json');
  let installedVersion = '?';
  let installedName = pkgName;
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
        name?: string;
        version?: string;
      };
      installedName = pkgJson.name ?? pkgName;
      installedVersion = pkgJson.version ?? '?';
    } catch {
      /* ignore malformed package.json */
    }
  }

  // Trigger registry reload via GraphQL mutation
  try {
    await gql(AGENT_RELOAD_MUTATION);
    console.log(`Installed: ${installedName} v${installedVersion}`);
    console.log('Agent registry reloaded. Run: nexus agent list');
  } catch {
    console.log(`Installed: ${installedName} v${installedVersion}`);
    console.log('Reload failed — restart Local to activate the agent.');
  }
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
// nexus agent validate
// ---------------------------------------------------------------------------

const AGENT_TOOL_NAMES_QUERY = /* GraphQL */ `
  query {
    mcpTools {
      name
    }
  }
`;

/**
 * Validate one or all agent definitions:
 *   Phase 1 — TypeScript check via tsc --noEmit (requires agent.ts)
 *   Phase 2 — Tool name check against the MCP registry (requires Local running)
 *
 * @param name        - Optional agent slug to validate. Validates all agents when omitted.
 * @param _agentsDir  - Optional override for the agents root directory (used in tests only).
 * @param execSyncFn  - Optional override for child_process.execSync (used in tests only).
 * @param gql         - Optional override for the GQL transport (used in tests only).
 */
export async function handleAgentValidate(
  name?: string,
  _agentsDir?: string,
  execSyncFn?: ExecSyncFn,
  gql: GqlFn = defaultGql,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const execSync = execSyncFn ?? (require('child_process') as typeof import('child_process')).execSync;

  const agentsBaseDir =
    _agentsDir ??
    path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents');

  // Collect target agent directories
  const targets: string[] = [];
  if (name) {
    const agentDir = path.join(agentsBaseDir, name);
    if (!fs.existsSync(agentDir)) {
      console.error(`Error: agent "${name}" not found at ${agentDir}`);
      process.exit(1);
    }
    targets.push(agentDir);
  } else {
    if (!fs.existsSync(agentsBaseDir)) {
      console.log('No agents directory found.');
      return;
    }
    const entries = fs.readdirSync(agentsBaseDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules') {
        targets.push(path.join(agentsBaseDir, e.name));
      }
    }
  }

  if (targets.length === 0) {
    console.log('No agents found to validate.');
    return;
  }

  let hasErrors = false;

  for (const agentDir of targets) {
    const agentName = path.basename(agentDir);
    const tsFile = path.join(agentDir, 'agent.ts');

    if (!fs.existsSync(tsFile)) {
      // JS agents skip TS validation
      console.log(`${agentName}: agent.js (no TypeScript validation)`);
      continue;
    }

    // Phase 1: TypeScript check via tsc --noEmit
    // Write a temp tsconfig so @nexus-ai/agent-sdk path alias resolves to the
    // compiled lib/main/agent-sdk (which ships .d.ts declarations).
    const sdkDir = path.resolve(__dirname, '..', '..', 'main', 'agent-sdk');
    const relSdkPath = path.relative(agentDir, sdkDir);
    const tmpTsConfig = {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'CommonJS',
        esModuleInterop: true,
        skipLibCheck: true,
        baseUrl: '.',
        paths: { '@nexus-ai/agent-sdk': [relSdkPath] },
      },
      files: ['agent.ts'],
    };
    const tmpConfigPath = path.join(agentDir, '.nexus-tsconfig.json');
    fs.writeFileSync(tmpConfigPath, JSON.stringify(tmpTsConfig, null, 2));
    try {
      execSync(`npx tsc --project "${tmpConfigPath}"`, { stdio: 'pipe' });
      console.log(`${agentName}: ✓ TypeScript OK`);
    } catch (err: any) {
      const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
      console.error(`${agentName}: ✗ TypeScript errors:`);
      console.error(
        output
          .trim()
          .split('\n')
          .map((l: string) => `  ${l}`)
          .join('\n'),
      );
      hasErrors = true;
    } finally {
      try { fs.unlinkSync(tmpConfigPath); } catch { /* ignore */ }
      if (hasErrors) continue;
    }

    // Phase 2: tool name check (requires Local running)
    try {
      // Load the agent definition via require (ts-node must be registered in runtime)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      let def = require(tsFile);
      if (def?.default) def = def.default;
      const declaredTools: string[] = def?.tools ?? [];

      if (declaredTools.length > 0) {
        const result = await gql<{ mcpTools: { name: string }[] }>(AGENT_TOOL_NAMES_QUERY).catch(
          () => null,
        );
        if (result) {
          const knownTools = new Set(result.mcpTools.map((t) => t.name));
          const unknown = declaredTools.filter((t) => !knownTools.has(t));
          if (unknown.length > 0) {
            console.error(`${agentName}: ✗ Unknown tools: ${unknown.join(', ')}`);
            hasErrors = true;
          } else {
            console.log(`${agentName}: ✓ Tools OK (${declaredTools.length} declared)`);
          }
        } else {
          console.log(`${agentName}: ⚠ Tool check skipped (Local not running)`);
        }
      }
    } catch {
      // Phase 2 failure is non-fatal — TS was fine
    }
  }

  if (hasErrors) process.exit(1);
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
// Helper functions for nexus agent push
// ---------------------------------------------------------------------------

/**
 * Find the latest sentinel report for a given install name.
 * Reports are stored in ~/Library/Application Support/Local/nexus-ai/agents/security-sentinel/reports/<installName>/
 * Filenames are ISO timestamps (YYYY-MM-DDTHH-MM-SS.md) and sort lexicographically in date order.
 *
 * @param siteName - The WPE install name (e.g. "theawfulpmtest")
 * @returns Path to the latest report, or null if none found
 */
function findLatestSentinelReport(siteName: string): string | null {
  const dir = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Local',
    'nexus-ai',
    'agents',
    'security-sentinel',
    'reports',
    siteName,
  );
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().reverse();
    return files.length > 0 ? path.join(dir, files[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Parse the verdict from a sentinel report file.
 * Looks for "READY TO PUSH" or "NOT SAFE TO PUSH" markers in the ## Verdict section.
 *
 * @param reportPath - Path to the report markdown file
 * @returns 'ready' if the report contains "READY TO PUSH", 'blocked' if "NOT SAFE TO PUSH", null if neither found
 */
function parseReportVerdict(reportPath: string): 'ready' | 'blocked' | null {
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    if (content.includes('READY TO PUSH')) return 'ready';
    if (content.includes('NOT SAFE TO PUSH')) return 'blocked';
    return null;
  } catch {
    return null;
  }
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
  .option('--install <name>', 'Scope run to a specific WPE install (emits wpe:sync.completed)')
  .action(async (name: string, opts: { install?: string }) => {
    try {
      await handleAgentRun(name, opts);
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
  .command('validate [name]')
  .description('Type-check a TypeScript agent (and optionally validate tool names)')
  .action(async (name?: string) => {
    await handleAgentValidate(name);
  });

agentCommand
  .command('install <package>')
  .description('Install a published agent package from npm')
  .action(async (pkg: string) => {
    await handleAgentInstall(pkg);
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

agentCommand
  .command('push <installName>')
  .description('Push a remediated sandbox to WPE production (reads latest sentinel report)')
  .action(async (installName: string) => {
    const reportPath = findLatestSentinelReport(installName);
    if (!reportPath) {
      console.error(`No remediation report found for "${installName}". Run the sentinel first.`);
      process.exit(1);
    }

    const verdict = parseReportVerdict(reportPath);
    if (verdict !== 'ready') {
      console.error(`Report verdict is "${verdict || 'unknown'}" — not safe to push.`);
      console.error(`Read the report: ${reportPath}`);
      process.exit(1);
    }

    console.log(`✓ Report: ${path.basename(reportPath)}`);
    console.log(`✓ Verdict: READY TO PUSH`);
    console.log('');
    console.log(`Executing on ${installName}.wpengine.com...`);
    console.log('');
    console.log('Note: Use the Agents UI in Local for step-by-step progress.');
    console.log('CLI execution will be added in a future release.');
    console.log('');
    console.log('Push command for UI:');
    console.log(`  Open Local → Nexus AI → Agents → Security Sentinel → Review → Execute`);
  });

// ---------------------------------------------------------------------------
// nexus agent tools — contributed tools sub-commands
// ---------------------------------------------------------------------------
// These commands work with tools that installed agents contribute via
// nexus.agent.yaml contributes.tools (the Agent SDK contributed-tools surface).
// They are separate from `nexus agent list` (lists agent platform agents) and
// `nexus agent run` (runs a full agent).

const LIST_CONTRIBUTED_TOOLS_QUERY = /* GraphQL */ `
  query {
    nexusListAgentTools {
      agentName
      tools {
        toolName
        description
        executionMode
        permissionTier
      }
    }
  }
`;

const INVOKE_CONTRIBUTED_TOOL_MUTATION = /* GraphQL */ `
  mutation nexusInvokeAgentTool($agentName: String!, $toolName: String!, $args: String) {
    nexusInvokeAgentTool(agentName: $agentName, toolName: $toolName, args: $args) {
      success
      error
      report
    }
  }
`;

function parseArgList(argList: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of argList) {
    const eqIdx = item.indexOf('=');
    if (eqIdx === -1) {
      result[item] = true;
    } else {
      result[item.slice(0, eqIdx)] = item.slice(eqIdx + 1);
    }
  }
  return result;
}

const agentToolsCommand = new Command('tools').description(
  'List and invoke tools contributed by installed agents (Agent SDK contributed-tools surface)',
);

agentToolsCommand
  .command('list [name]')
  .description('List contributed tools. Pass an agent name to filter to that agent.')
  .action(async (name?: string) => {
    try {
      const data = await defaultGql<{
        nexusListAgentTools: Array<{
          agentName: string;
          tools: Array<{
            toolName: string;
            description: string;
            executionMode: string;
            permissionTier: number;
          }>;
        }>;
      }>(LIST_CONTRIBUTED_TOOLS_QUERY);

      const groups = data?.nexusListAgentTools ?? [];
      const filtered = name ? groups.filter((g) => g.agentName === name) : groups;

      if (filtered.length === 0) {
        console.log(name ? `No contributed tools from agent '${name}'.` : 'No contributed tools registered.');
        return;
      }

      for (const group of filtered) {
        console.log(`\n  ${group.agentName}`);
        for (const tool of group.tools) {
          const tier = tool.permissionTier >= 3 ? ' [tier-3]' : '';
          console.log(`    ${tool.toolName.padEnd(28)} ${tool.description}  [${tool.executionMode}]${tier}`);
        }
      }
      console.log();
    } catch (error: any) {
      console.error(`\n❌ Failed to list contributed tools: ${error.message}`);
      process.exit(1);
    }
  });

agentToolsCommand
  .command('invoke <agentName> <toolName>')
  .description('Invoke a contributed tool (tier-3 tools must be invoked via MCP)')
  .option(
    '--arg <keyvalue>',
    'Argument in key=value format (repeatable)',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .action(async (agentName: string, toolName: string, options: { arg: string[] }) => {
    try {
      const args = parseArgList(options.arg);
      const data = await defaultGql<{
        nexusInvokeAgentTool: { success: boolean; error: string | null; report: string | null };
      }>(INVOKE_CONTRIBUTED_TOOL_MUTATION, {
        agentName,
        toolName,
        args: JSON.stringify(args),
      });

      const result = data?.nexusInvokeAgentTool;
      if (!result) {
        console.error('No response from server');
        process.exit(1);
      }
      if (!result.success) {
        console.error(result.error ?? 'Unknown error');
        process.exit(1);
      }
      if (result.report) console.log(result.report);
    } catch (error: any) {
      console.error(`\n❌ Failed to invoke tool: ${error.message}`);
      process.exit(1);
    }
  });

agentToolsCommand
  .command('build [agentPath]')
  .description('Generate the contributes section of nexus.agent.yaml from agent.js')
  .option('--check', 'Exit non-zero if the manifest is out of date (for CI)')
  .action(async (agentPath: string | undefined, options: { check?: boolean }) => {
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const yaml = await import('js-yaml');
    const { zodToJsonSchema } = await import('zod-to-json-schema');

    const resolvedPath = pathMod.resolve(agentPath ?? '.');
    const agentJsPath = pathMod.join(resolvedPath, 'agent.js');
    const manifestPath = pathMod.join(resolvedPath, 'nexus.agent.yaml');

    if (!fsMod.existsSync(agentJsPath)) {
      console.error(`agent.js not found at ${agentJsPath}`);
      process.exit(1);
    }
    if (!fsMod.existsSync(manifestPath)) {
      console.error(`nexus.agent.yaml not found at ${manifestPath}`);
      process.exit(1);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(agentJsPath) as {
      default?: {
        contributes?: {
          tools?: Record<
            string,
            { description: string; schema?: unknown; executionMode?: string }
          >;
        };
      };
    };
    const def = mod.default ?? (mod as unknown as typeof mod.default);
    const contributedTools = def?.contributes?.tools ?? {};
    const toolEntries = Object.entries(contributedTools).map(([toolName, tool]) => ({
      name: toolName,
      description: tool.description,
      executionMode: tool.executionMode ?? 'function',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: tool.schema ? zodToJsonSchema(tool.schema as any, { target: 'openApi3' }) : {},
    }));

    const raw = fsMod.readFileSync(manifestPath, 'utf8');
    const manifest = yaml.load(raw) as Record<string, unknown>;
    manifest.contributes = { tools: toolEntries };

    const generated = `# AUTO-GENERATED by nexus agent tools build — do not edit this section manually\n${yaml.dump(manifest)}`;

    if (options.check) {
      const existingRaw = fsMod.readFileSync(manifestPath, 'utf8');
      if (existingRaw.trim() !== generated.trim()) {
        console.error('nexus.agent.yaml contributes section is out of date. Run: nexus agent tools build');
        process.exit(1);
      }
      console.log('nexus.agent.yaml is up to date.');
      return;
    }

    fsMod.writeFileSync(manifestPath, generated, 'utf8');
    console.log(`Updated ${manifestPath} with ${toolEntries.length} contributed tool(s).`);
  });

agentCommand.addCommand(agentToolsCommand);

export { agentCommand };
export default agentCommand;
