import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logging/Logger';
import { getAgentAutonomy } from '../ipc-handlers';
import { NexusToolProvider } from './NexusToolProvider';
import { AgentAIClient } from './AgentAIClient';
import { getProvider } from '../chat/providers/index';
import type { AgentDefinition, NexusEvent, AgentContext, AgentLogger, Finding, AgentAction } from '../agent-sdk/types';
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
}

export function buildAgentContext(deps: AgentContextDeps): {
  ctx: AgentContext;
  agentLog: AgentLogger;
  accFindings: Finding[];
  accActions: AgentAction[];
  accSites: Record<string, { status: string; findings: Finding[] }>;
} {
  const { agent, event, toolRegistry, services, stateStore, resolvedProvider, logDir } = deps;
  const agentName = agent.name;

  const toolProvider = new NexusToolProvider(
    toolRegistry,
    services,
    agent.tools?.length ? agent.tools : undefined,
  );

  // Build AI client per-run so it gets this agent's scoped tool set.
  // When Local Gateway is enabled, route through the gateway so Nexus injects
  // credentials — same model as per-site WordPress AI capabilities.
  const effectiveProvider = resolvedProvider.useLocalGateway ? 'local-gateway' : resolvedProvider.provider;
  const aiProvider = getProvider(effectiveProvider);
  const agentModel = agent.model ?? resolvedProvider.model;
  // When using local-gateway, pass the gateway URL and auth token via apiKey/baseUrl
  const providerConfig = effectiveProvider === 'local-gateway'
    ? { apiKey: services.gatewayAuthToken ?? '', model: agentModel, baseUrl: services.gatewayUrl }
    : { apiKey: resolvedProvider.apiKey, model: agentModel };
  // Direct provider config: used for generateObject forced-tool calls that need tool_config/tool_choice
  // The local-gateway proxy doesn't translate these, so we bypass it for structured output calls
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

  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
  const logFile = path.join(logDir, 'agent.log');
  const appLog = createLogger(`agent:${agentName}`);

  function appendLog(level: string, msg: string): void {
    try {
      fs.appendFileSync(logFile, `[${level}] ${new Date().toISOString()} ${msg}\n`);
    } catch { /* non-fatal */ }
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

  const ctx: AgentContext = {
    trigger: agent.triggers[0],
    event,
    tools: toolProvider,
    state: stateStore.buildHandle(agentName),
    ai: aiClient,
    log: agentLog,
    autonomy: getAgentAutonomy(agentName),
  };

  return { ctx, agentLog, accFindings, accActions, accSites };
}
