import { createLogger } from '../logging/Logger';
import type { AgentDefinition, NexusEvent, AgentResult, AgentContext, AIClient } from '../agent-sdk/types';
import type { AgentStateStore } from './AgentStateStore';
import type { NexusToolProvider } from './NexusToolProvider';

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
  private toolProvider: NexusToolProvider;
  private aiClient: AIClient;

  constructor(stateStore: AgentStateStore, toolProvider: NexusToolProvider, aiClient: AIClient) {
    this.stateStore = stateStore;
    this.toolProvider = toolProvider;
    this.aiClient = aiClient;
  }

  async run(agent: AgentDefinition, event?: NexusEvent): Promise<AgentResult> {
    const startedAt = Date.now();
    const timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const agentLog = createLogger(`agent:${agent.name}`);

    const ctx: AgentContext = {
      trigger: agent.triggers[0],
      event,
      tools: this.toolProvider,
      state: this.stateStore.buildHandle(agent.name),
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
