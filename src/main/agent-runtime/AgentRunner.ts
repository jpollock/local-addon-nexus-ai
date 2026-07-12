import { createLogger } from '../logging/Logger';
import type { AgentDefinition, NexusEvent, AgentResult, AgentContext, AIClient } from '../agent-sdk/types';
import type { AgentStateStore } from './AgentStateStore';
import type { NexusToolProvider } from './NexusToolProvider';

const logger = createLogger('AgentRunner');
const DEFAULT_TIMEOUT_MS = 300_000;

function makeLogger(agentName: string) {
  const base = createLogger(`agent:${agentName}`);
  return {
    info:  (msg: string, ...args: unknown[]) => base.info(msg, ...args),
    warn:  (msg: string, ...args: unknown[]) => base.warn(msg, ...args),
    error: (msg: string, ...args: unknown[]) => base.error(msg, ...args),
    debug: (msg: string, ...args: unknown[]) => base.debug(msg, ...args),
  };
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
    const agentLog = makeLogger(agent.name);

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

    try {
      await Promise.race([
        agent.run(ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('__TIMEOUT__')), timeoutMs)
        ),
      ]);
    } catch (err: any) {
      if (err.message === '__TIMEOUT__') {
        status = 'timeout';
        error = `Agent "${agent.name}" timed out after ${timeoutMs}ms`;
        logger.warn(error);
      } else {
        status = 'error';
        error = err.message ?? String(err);
        logger.error(`Agent "${agent.name}" failed: ${error}`);
        if (agent.onError) {
          try { await agent.onError(err, ctx); } catch { /* onError must not throw */ }
        }
      }
    }

    return { agentName: agent.name, startedAt, finishedAt: Date.now(), status, error };
  }
}
