import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition, NexusEvent, AgentResult, AgentContext, AIClient, AgentLogger } from '../agent-sdk/types';
import type { AgentStateStore } from './AgentStateStore';
import { NexusToolProvider } from './NexusToolProvider';
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
  private aiClient: AIClient;

  constructor(
    stateStore: AgentStateStore,
    toolRegistry: ToolRegistry,
    services: NexusServices,
    aiClient: AIClient,
  ) {
    this.stateStore = stateStore;
    this.toolRegistry = toolRegistry;
    this.services = services;
    this.aiClient = aiClient;
  }

  async run(agent: AgentDefinition, event?: NexusEvent): Promise<AgentResult> {
    const startedAt = Date.now();
    const timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const agentName = agent.name;

    // Build per-agent tool provider with scope enforcement
    const toolProvider = new NexusToolProvider(
      this.toolRegistry,
      this.services,
      agent.tools?.length ? agent.tools : undefined,
    );

    // Build file-backed logger — writes to both the standard logger and a per-agent log file
    const logDir = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Local',
      'nexus-ai',
      'agent-logs',
    );
    try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
    const logFile = path.join(logDir, `${agentName}.log`);
    const appLog = createLogger(`agent:${agentName}`);

    function appendLog(level: string, msg: string): void {
      try {
        fs.appendFileSync(logFile, `[${level}] ${new Date().toISOString()} ${msg}\n`);
      } catch { /* log file write errors are non-fatal */ }
    }

    const agentLog: AgentLogger = {
      info:  (msg: string) => { appLog.info(msg);  appendLog('INFO',  msg); },
      warn:  (msg: string) => { appLog.warn(msg);  appendLog('WARN',  msg); },
      error: (msg: string) => { appLog.error(msg); appendLog('ERROR', msg); },
      debug: (msg: string) => { appLog.debug(msg); appendLog('DEBUG', msg); },
    };

    const ctx: AgentContext = {
      trigger: agent.triggers[0],
      event,
      tools: toolProvider,
      state: this.stateStore.buildHandle(agentName),
      ai: this.aiClient,
      log: agentLog,
    };

    let status: AgentResult['status'] = 'success';
    let error: string | undefined;

    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      try {
        await Promise.race([
          agent.run(ctx),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new TimeoutError()), timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
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

    return { agentName: agent.name, startedAt, finishedAt: Date.now(), status, error };
  }
}
