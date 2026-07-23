import type { McpToolDefinition } from '../mcp/types';
import type { ExecutionMode } from '../agent-sdk/types';

export type ContributedManifestEntry = {
  name: string;
  description: string;
  executionMode?: ExecutionMode;
  inputSchema: Record<string, unknown>;
};

export type RegisteredTool = {
  agentName: string;
  toolName: string;
  description: string;
  executionMode: ExecutionMode;
  inputSchema: Record<string, unknown>;
  permissionTier: number;
};

export class ContributedToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(agentName: string, entry: ContributedManifestEntry, permissionTier = 1): void {
    const key = `${agentName}/${entry.name}`;
    this.tools.set(key, {
      agentName,
      toolName: entry.name,
      description: entry.description,
      executionMode: entry.executionMode ?? 'function',
      inputSchema: entry.inputSchema,
      permissionTier,
    });
  }

  unregisterAgent(agentName: string): void {
    for (const key of this.tools.keys()) {
      if (key.startsWith(`${agentName}/`)) {
        this.tools.delete(key);
      }
    }
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  get(agentName: string, toolName: string): RegisteredTool | undefined {
    return this.tools.get(`${agentName}/${toolName}`);
  }

  getByMcpName(mcpName: string): RegisteredTool | undefined {
    // With VALID_AGENT_NAME banning __, splitting on __ gives exactly 3 parts
    // for valid names: ['agent', agentName, toolName].
    // A name like 'agent__my__agent__check' splits into 4 parts → rejected.
    const parts = mcpName.split('__');
    if (parts.length !== 3 || parts[0] !== 'agent') return undefined;
    return this.get(parts[1], parts[2]);
  }

  toMcpDefinitions(isEnabled?: (agentName: string) => boolean): McpToolDefinition[] {
    return this.list()
      .filter(tool => !isEnabled || isEnabled(tool.agentName))
      .map((tool) => ({
        name: `agent__${tool.agentName}__${tool.toolName}`,
        description: `${tool.description}\n\n[Provided by ${tool.agentName} agent]`,
        inputSchema: { ...tool.inputSchema },
      }));
  }

  toolsByAgent(): Map<string, RegisteredTool[]> {
    const result = new Map<string, RegisteredTool[]>();
    for (const tool of this.tools.values()) {
      const existing = result.get(tool.agentName) ?? [];
      result.set(tool.agentName, [...existing, tool]);
    }
    return result;
  }
}
