import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logging/Logger';
import { rotateIfNeeded, pruneOldFiles } from '../logging/rotate';
import { getAgentAutonomy, getAgentSettings } from '../ipc-handlers';
import { NexusToolProvider } from './NexusToolProvider';
import { AgentAIClient } from './AgentAIClient';
import { AgentDbManager } from './AgentDbManager';
import { getProvider } from '../chat/providers/index';
import { AgentCredentialsContext } from '../credentials/AgentCredentialsContext';
import { NotConnectedError } from '../credentials/types';
import type { AgentDefinition, NexusEvent, AgentContext, AgentLogger, Finding, AgentAction, AgentDatabase, AgentDbHandle } from '../agent-sdk/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { AgentStateStore } from './AgentStateStore';
import type { ResolvedAIProvider } from '../ai/getAIProvider';

export interface AgentContextDeps {
  agent: AgentDefinition;
  event?: NexusEvent;
  toolRegistry: ToolRegistry;
  services: NexusServices;
  stateStore: AgentStateStore;
  resolvedProvider: ResolvedAIProvider;
  logDir: string;
  /** Platform-managed SQLite connection cache. Optional — falls back to per-call in-memory databases. */
  dbManager?: AgentDbManager;
  /** True when the user explicitly requested a full (non-incremental) run from the Run Now modal. */
  fullRun?: boolean;
  /** Per-run log filename (e.g. "run-1753276539000.log"). Defaults to "agent.log". */
  logFileName?: string;
}

export function buildAgentContext(deps: AgentContextDeps): {
  ctx: AgentContext;
  agentLog: AgentLogger;
  accFindings: Finding[];
  accActions: AgentAction[];
  accSites: Record<string, { status: string; findings: Finding[] }>;
} {
  const { agent, event, toolRegistry, services, stateStore, resolvedProvider, logDir, dbManager, fullRun, logFileName } = deps;
  const agentName = agent.name;

  const toolProvider = new NexusToolProvider(
    toolRegistry,
    services,
    agent.tools?.length ? agent.tools : undefined,
  );

  // Build AI client per-run so it gets this agent's scoped tool set.
  //
  // Agents ALWAYS call the resolved provider directly — never through the Local AI Gateway HTTP
  // server, regardless of settings.useLocalGateway. That flag governs whether a WordPress SITE's
  // own AI calls (from its PHP/MU-plugin code) route through Local so Nexus can inject
  // credentials the site never sees. An agent runs in this process already, with direct access
  // to resolvedProvider.apiKey — it has no WP-site credential problem to solve by detouring
  // through a server built for a completely different caller. Routing agents through it anyway
  // meant every agent's AI calls broke the moment a user turned useLocalGateway on for their
  // sites: the gateway's own provider routing (AIGatewayRoutes.ts) only recognized a subset of
  // providers, so an agent configured for e.g. 'power' 503'd with "No API key configured" even
  // though a real key was present — the gateway just isn't the right layer for this caller.
  const effectiveProvider = resolvedProvider.provider;
  const aiProvider = getProvider(effectiveProvider);
  const agentModel = agent.model ?? resolvedProvider.model;
  const providerConfig = { apiKey: resolvedProvider.apiKey, model: agentModel };
  // directProvider/directConfig used to exist to bypass the local-gateway proxy for
  // generateObject's forced-tool calls (tool_config/tool_choice, which the proxy didn't
  // translate). With effectiveProvider never resolving to local-gateway anymore, these are
  // identical to aiProvider/providerConfig — kept as distinct values rather than collapsed, so
  // AgentAIClient's constructor signature doesn't change in this fix.
  const directProvider = getProvider(resolvedProvider.provider);
  const directConfig = { apiKey: resolvedProvider.apiKey, model: agentModel };
  const aiClient = aiProvider
    ? new AgentAIClient(aiProvider, providerConfig, toolProvider, directProvider ?? undefined, directConfig)
    : {
        run: async (_prompt: string) => {
          createLogger(`agent:${agentName}`).warn(`Agent "${agentName}": AI provider "${resolvedProvider.provider}" unavailable — skipping AI call`);
          return '';
        },
        generateObject: async <T>(_opts: unknown): Promise<T> => {
          createLogger(`agent:${agentName}`).warn(`Agent "${agentName}": AI provider "${resolvedProvider.provider}" unavailable — skipping generateObject call`);
          return {} as T;
        },
      };

  const credentialManager = services.credentialManager;
  const agentSiteId = event?.siteId ?? '';
  const credentials = new AgentCredentialsContext({
    agentId: agent.name,
    siteId: agentSiteId,
    manifestCredentials: agent.credentials ?? [],
    manager: credentialManager ?? {
      getTokenForGrant: async (provider: string) => { throw new NotConnectedError(provider); },
      getStatusForAgent: async () => 'not_connected' as const,
      requestConnectionForAgent: async () => {},
      getSecretForAgent: async (provider: string) => { throw new Error(`No credential manager — cannot get secret for ${provider}`); },
      markApiKeyRevoked: (_provider: string) => {},
    },
  });

  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

  // Per-run logs and reports accumulated one pair per run forever. Keep the 20
  // most recent of each; older runs remain summarised in the agent_runs table.
  try {
    pruneOldFiles(logDir, /^run-.*\.log$/, 20);
    pruneOldFiles(logDir, /^run-.*-report\.md$/, 20);
  } catch { /* best effort */ }

  const logFile = path.join(logDir, logFileName ?? 'agent.log');
  const appLog = createLogger(`agent:${agentName}`);

  /** Agent logs are appended on every single log call and were previously
   *  uncapped — security-sentinel/agent.log reached 9.1 MB. Rotate before each
   *  append; rotateIfNeeded is a cheap statSync when under the limit. */
  function appendLog(level: string, msg: string): void {
    try {
      rotateIfNeeded(logFile);
      fs.appendFileSync(logFile, `[${level}] ${new Date().toISOString()} ${msg}\n`);
    } catch { /* logging must never break the agent */ }
  }

  // Accumulators for structured log events — merged into AgentResult after run
  const accFindings: Finding[] = [];
  const accActions: AgentAction[] = [];
  const accSites: Record<string, { status: string; findings: Finding[] }> = {};

  const agentLog: AgentLogger = {
    info:  (msg: string) => { appLog.info(msg);  appendLog('INFO',  msg); },
    warn:  (msg: string) => { appLog.warn(msg);  appendLog('WARN',  msg); },
    error: (msg: string) => { appLog.error(msg); appendLog('ERROR', msg); },
    debug: (msg: string) => { appLog.debug(msg); appendLog('DEBUG', msg); },
    finding: (finding: Finding) => {
      accFindings.push(finding);
      const sev = finding.severity === 'critical' || finding.severity === 'high' ? 'WARN' : 'INFO';
      appendLog(sev, `[${finding.severity.toUpperCase()}] ${finding.id}: ${finding.title}${finding.site ? ` (${finding.site})` : ''}`);
    },
    action: (action: AgentAction) => {
      accActions.push(action);
      appendLog(action.result === 'failed' ? 'WARN' : 'INFO',
        `[action] ${action.label}${action.result ? ` — ${action.result}` : ''}${action.durationMs ? ` (${action.durationMs}ms)` : ''}`);
    },
    phase: (name: string, description?: string) => {
      appendLog('INFO', `[phase] ${name}${description ? ': ' + description : ''}`);
    },
    siteStatus: (site: string, status: string) => {
      if (!accSites[site]) accSites[site] = { status, findings: [] };
      else accSites[site].status = status;
      const icon = status === 'clean' ? '✓' : status === 'escalated' ? '↑' : status === 'error' ? '✗' : '→';
      appendLog('INFO', `[site] ${site} — ${icon} ${status}`);
    },
  };

  // Build the db handle — either delegate to the platform manager (production) or
  // an in-memory fallback (tests that construct buildAgentContext directly without a dbManager).
  const db: AgentDbHandle = dbManager
    ? { open: (name: string) => dbManager.open(agentName, name) }
    : (() => {
        appLog.warn(`Agent "${agentName}": no dbManager provided — ctx.db.open() will use ephemeral in-memory databases. Data will not persist between runs.`);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
        const memDbs = new Map<string, AgentDatabase>();
        return {
          open(name: string): AgentDatabase {
            if (!memDbs.has(name)) {
              const db = new BetterSqlite3(':memory:');
              db.pragma('journal_mode = WAL');
              memDbs.set(name, db as unknown as AgentDatabase);
            }
            return memDbs.get(name)!;
          },
        };
      })();

  const ctx: AgentContext = {
    trigger: agent.triggers[0],
    event,
    tools: toolProvider,
    state: stateStore.buildHandle(agentName),
    ai: aiClient,
    log: agentLog,
    autonomy: getAgentAutonomy(agentName),
    settings: getAgentSettings(agentName),
    credentials,
    db,
    fullRun: fullRun ?? false,
  };

  return { ctx, agentLog, accFindings, accActions, accSites };
}
