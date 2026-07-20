import * as path from 'path';
import * as os from 'os';
import type { McpToolResult } from '../mcp/types';
import type { NexusServices } from '../mcp/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { ContributedToolRegistry, RegisteredTool } from './ContributedToolRegistry';
import type { AgentDefinition } from '../agent-sdk/types';
import type { ResolvedAIProvider } from '../ai/getAIProvider';
import type { AgentStateStore } from './AgentStateStore';
import { buildAgentContext } from './buildAgentContext';

// Ban consecutive underscores so the __ MCP delimiter is unambiguous.
const VALID_AGENT_NAME = /^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$|^[a-z0-9]$/;

const DEFAULT_AGENTS_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Local',
  'nexus-ai',
  'agents',
);

const HANDLER_TIMEOUT_MS = 30_000;

export class AgentDispatcher {
  private moduleCache = new Map<string, AgentDefinition>();

  constructor(
    private readonly contributedRegistry: ContributedToolRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly services: NexusServices,
    private readonly agentsDir: string = DEFAULT_AGENTS_DIR,
    private readonly resolvedProvider: ResolvedAIProvider,
    private readonly stateStore: AgentStateStore,
  ) {}

  clearCache(agentName: string): void {
    this.moduleCache.delete(agentName);
  }

  async dispatch(agentName: string, toolName: string, args: unknown): Promise<McpToolResult> {
    const registered = this.contributedRegistry.get(agentName, toolName);
    if (!registered) {
      return {
        content: [{ type: 'text', text: `Tool ${agentName}/${toolName} not found` }],
        isError: true,
      };
    }

    const start = Date.now();
    let outcome: 'ok' | 'error' = 'ok';

    const result =
      registered.executionMode === 'run'
        ? await this.dispatchRun(registered, args)
        : await this.dispatchFunction(registered, args);

    if (result.isError) outcome = 'error';

    this.services.auditLogger?.log({
      timestamp: new Date().toISOString(),
      toolName: `${agentName}/${toolName}`,
      tier: registered.permissionTier as 1 | 2 | 3,
      params: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
      confirmed: null,
      result: outcome === 'ok' ? 'success' : 'error',
      duration_ms: Date.now() - start,
    });

    return result;
  }

  private loadModule(agentName: string): AgentDefinition {
    if (this.moduleCache.has(agentName)) return this.moduleCache.get(agentName)!;
    if (!VALID_AGENT_NAME.test(agentName)) {
      throw new Error(`Invalid agent name: '${agentName}'`);
    }
    const agentPath = path.join(this.agentsDir, agentName, 'agent.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(agentPath) as { default?: AgentDefinition } | AgentDefinition;
    const def = (mod as { default?: AgentDefinition }).default ?? (mod as AgentDefinition);
    this.moduleCache.set(agentName, def);
    return def;
  }

  private async dispatchFunction(registered: RegisteredTool, args: unknown): Promise<McpToolResult> {
    try {
      const def = this.loadModule(registered.agentName);
      const handler = def.contributes?.tools?.[registered.toolName]?.handler;
      if (!handler) {
        return {
          content: [{ type: 'text', text: `Handler for ${registered.toolName} not found` }],
          isError: true,
        };
      }
      const { ctx } = buildAgentContext({
        agent: def,
        toolRegistry: this.toolRegistry,
        services: this.services,
        stateStore: this.stateStore,
        resolvedProvider: this.resolvedProvider,
        logDir: path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Local',
          'nexus-ai',
          'agents',
          registered.agentName,
          'logs',
        ),
      });
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Agent tool handler timed out')),
          HANDLER_TIMEOUT_MS,
        );
      });
      const result = await Promise.race([
        (async () => {
          const r = await handler(args, ctx);
          clearTimeout(timeoutHandle);
          return r;
        })(),
        timeoutPromise,
      ]);
      return { content: result.content, isError: result.isError };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  }

  private async dispatchRun(registered: RegisteredTool, args: unknown): Promise<McpToolResult> {
    try {
      const def = this.loadModule(registered.agentName);
      const { ctx } = buildAgentContext({
        agent: def,
        toolRegistry: this.toolRegistry,
        services: this.services,
        stateStore: this.stateStore,
        resolvedProvider: this.resolvedProvider,
        logDir: path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Local',
          'nexus-ai',
          'agents',
          registered.agentName,
          'logs',
        ),
      });
      await def.run(ctx);
      return { content: [{ type: 'text', text: 'Run complete' }] };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Run error: ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  }
}
