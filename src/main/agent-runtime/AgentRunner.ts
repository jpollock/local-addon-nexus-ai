import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition, NexusEvent, AgentResult } from '../agent-sdk/types';
import type { AgentStateStore } from './AgentStateStore';
import type { ResolvedAIProvider } from '../ai/getAIProvider';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { AgentDbManager } from './AgentDbManager';
import { buildAgentContext } from './buildAgentContext';

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
  private dbManager?: AgentDbManager;

  constructor(
    stateStore: AgentStateStore,
    toolRegistry: ToolRegistry,
    services: NexusServices,
    resolvedProvider: ResolvedAIProvider,
    dbManager?: AgentDbManager,
  ) {
    this.stateStore = stateStore;
    this.toolRegistry = toolRegistry;
    this.services = services;
    this.resolvedProvider = resolvedProvider;
    this.dbManager = dbManager;
  }

  /**
   * Update the AI provider used for subsequent agent runs.
   * Called from onSettingsUpdated so agents pick up provider/key changes
   * without requiring a Local restart.
   */
  setProvider(provider: ResolvedAIProvider): void {
    this.resolvedProvider = provider;
  }

  async run(agent: AgentDefinition, event?: NexusEvent, options?: { fullRun?: boolean; logFileName?: string }): Promise<AgentResult> {
    const startedAt = Date.now();
    const timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const agentName = agent.name;

    const { ctx, agentLog, accFindings, accActions, accSites } = buildAgentContext({
      agent,
      event,
      toolRegistry: this.toolRegistry,
      services: this.services,
      stateStore: this.stateStore,
      resolvedProvider: this.resolvedProvider,
      logDir: path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', agentName, 'logs'),
      dbManager: this.dbManager,
      fullRun: options?.fullRun ?? false,
      logFileName: options?.logFileName,
    });

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
      if (rv.summary)  result.summary  = rv.summary;
    }

    // Attach per-run log file path and write report file if summary exists
    if (options?.logFileName) {
      const logsDir = path.join(
        os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
        'agents', agentName, 'logs',
      );
      result.logFile = path.join(logsDir, options.logFileName);

      if (result.summary) {
        const reportFileName = options.logFileName.replace(/\.log$/, '-report.md');
        const reportFilePath = path.join(logsDir, reportFileName);
        try {
          const fs = await import('fs');
          fs.writeFileSync(reportFilePath, result.summary, 'utf-8');
          result.reportFile = reportFilePath;
        } catch { /* non-fatal — report still accessible via DB summary */ }
      }
    }

    this.stateStore.recordRun(result);
    return result;
  }
}
