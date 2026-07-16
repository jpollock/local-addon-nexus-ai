import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition, NexusEvent, AgentResult, AgentContext, AgentLogger, Finding, AgentAction } from '../agent-sdk/types';
import type { AgentStateStore } from './AgentStateStore';
import { NexusToolProvider } from './NexusToolProvider';
import { AgentAIClient } from './AgentAIClient';
import { getProvider } from '../chat/providers/index';
import type { ResolvedAIProvider } from '../ai/getAIProvider';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';

const logger = createLogger('AgentRunner');
const DEFAULT_TIMEOUT_MS = 300_000;

class TimeoutError extends Error {
  constructor() {
    super('Agent timeout');
    this.name = 'TimeoutError';
  }
}

export class AgentRunner {
  private stateStore: AgentStateStore;
  private toolRegistry: ToolRegistry;
  private services: NexusServices;
  private resolvedProvider: ResolvedAIProvider;

  constructor(
    stateStore: AgentStateStore,
    toolRegistry: ToolRegistry,
    services: NexusServices,
    resolvedProvider: ResolvedAIProvider,
  ) {
    this.stateStore = stateStore;
    this.toolRegistry = toolRegistry;
    this.services = services;
    this.resolvedProvider = resolvedProvider;
  }

  /**
   * Update the AI provider used for subsequent agent runs.
   * Called from onSettingsUpdated so agents pick up provider/key changes
   * without requiring a Local restart.
   */
  setProvider(provider: ResolvedAIProvider): void {
    this.resolvedProvider = provider;
  }

  async run(agent: AgentDefinition, event?: NexusEvent): Promise<AgentResult> {
    const startedAt = Date.now();
    const timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const agentName = agent.name;

    const toolProvider = new NexusToolProvider(
      this.toolRegistry,
      this.services,
      agent.tools?.length ? agent.tools : undefined,
    );

    // Build AI client per-run so it gets this agent's scoped tool set.
    // When Local Gateway is enabled, route through the gateway so Nexus injects
    // credentials — same model as per-site WordPress AI capabilities.
    const effectiveProvider = this.resolvedProvider.useLocalGateway ? 'local-gateway' : this.resolvedProvider.provider;
    const aiProvider = getProvider(effectiveProvider);
    const agentModel = agent.model ?? this.resolvedProvider.model;
    // When using local-gateway, pass the gateway URL and auth token via apiKey/baseUrl
    const providerConfig = effectiveProvider === 'local-gateway'
      ? { apiKey: this.services.gatewayAuthToken ?? '', model: agentModel, baseUrl: this.services.gatewayUrl }
      : { apiKey: this.resolvedProvider.apiKey, model: agentModel };
    const aiClient = aiProvider
      ? new AgentAIClient(aiProvider, providerConfig, toolProvider)
      : {
          run: async (_prompt: string) => {
            logger.warn(`Agent "${agent.name}": AI provider "${this.resolvedProvider.provider}" unavailable — skipping AI call`);
            return '';
          },
          generateObject: async <T>(_opts: unknown): Promise<T> => {
            logger.warn(`Agent "${agent.name}": AI provider "${this.resolvedProvider.provider}" unavailable — skipping generateObject call`);
            return {} as T;
          },
        };

    const logDir = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Local',
      'nexus-ai',
      'agents',
      agentName,
      'logs',
    );
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
    const accActions:  AgentAction[] = [];
    const accSites:    Record<string, { status: string; findings: Finding[] }> = {};

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
      state: this.stateStore.buildHandle(agentName),
      ai: aiClient,
      log: agentLog,
    };

    let status: AgentResult['status'] = 'success';
    let error: string | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let agentReturnValue: unknown;

    try {
      try {
        await Promise.race([
          agent.run(ctx).then((rv) => { agentReturnValue = rv; }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new TimeoutError()), timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
    } catch (err: unknown) {
      if (err instanceof TimeoutError) {
        status = 'timeout';
        error = `Agent "${agent.name}" timed out after ${timeoutMs}ms`;
        logger.warn(error);
        if (agent.onError) {
          try { await agent.onError(err, ctx); } catch { /* onError must not throw */ }
        }
      } else if (err instanceof Error) {
        status = 'error';
        error = err.message;
        logger.error(`Agent "${agent.name}" failed: ${error}`);
        if (agent.onError) {
          try { await agent.onError(err, ctx); } catch { /* onError must not throw */ }
        }
      } else {
        status = 'error';
        error = String(err);
        logger.error(`Agent "${agent.name}" failed: ${error}`);
      }
    }

    const result: AgentResult = { agentName: agent.name, startedAt, finishedAt: Date.now(), status, error };

    // Merge structured log events accumulated during the run
    if (accFindings.length > 0) result.findings = accFindings;
    if (Object.keys(accSites).length > 0) {
      result.sites = Object.fromEntries(
        Object.entries(accSites).map(([k, v]) => [k, { ...v, findings: accFindings.filter(f => f.site === k) }]),
      );
    }

    // If the agent returned a typed AgentResult, its domain fields take precedence
    if (agentReturnValue && typeof agentReturnValue === 'object') {
      const rv = agentReturnValue as AgentResult;
      if (rv.verdict)  result.verdict  = rv.verdict;
      if (rv.findings) result.findings = rv.findings;
      if (rv.plan)     result.plan     = rv.plan;
      if (rv.sites)    result.sites    = rv.sites;
    }

    this.stateStore.recordRun(result);
    return result;
  }
}
