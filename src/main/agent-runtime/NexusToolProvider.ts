import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { ToolProvider } from '../agent-sdk/types';
import type { ProviderToolDefinition } from '../chat/providers/types';

/**
 * Implements ToolProvider by wrapping ToolRegistry with scope enforcement.
 * Enforces that agents can only invoke tools declared in their tools list.
 */
export class NexusToolProvider implements ToolProvider {
  private registry: ToolRegistry;
  private services: NexusServices;
  private allowedTools: Set<string> | undefined;

  constructor(registry: ToolRegistry, services: NexusServices, tools: string[] | undefined) {
    this.registry = registry;
    this.services = services;
    this.allowedTools = tools !== undefined ? new Set(tools) : undefined;
  }

  getProviderToolDefinitions(): ProviderToolDefinition[] {
    const all = this.registry.list(this.services);
    return all
      .filter(tool => !this.allowedTools || this.allowedTools.has(tool.name))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
  }

  async invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Enforce tool scope: if allowedTools is defined, only those tools are permitted
    if (this.allowedTools && !this.allowedTools.has(name)) {
      throw new Error(`Tool "${name}" is not declared in this agent's tools list`);
    }

    // Audit: agents bypass McpSafetyWrapper, so we log tool calls here instead.
    const startTime = Date.now();

    // Call the registry with 'agent' as the access method
    const result = await this.registry.call(name, args, this.services, 'agent' as any);

    // Audit log the invocation (mirrors McpSafetyWrapper.auditLog for the agent path)
    const duration_ms = Date.now() - startTime;
    if (result.isError) {
      const errorText = result.content.find((c: any) => c.type === 'text')?.text ?? 'Tool error';
      this.services.auditLogger?.log({
        timestamp: new Date().toISOString(),
        toolName: name,
        tier: 1,
        params: args,
        confirmed: null,
        result: 'error',
        error: errorText,
        duration_ms,
      });
      throw new Error(errorText);
    }

    this.services.auditLogger?.log({
      timestamp: new Date().toISOString(),
      toolName: name,
      tier: 1,
      params: args,
      confirmed: null,
      result: 'success',
      error: undefined,
      duration_ms,
    });

    // Parse JSON content if possible, otherwise return raw text
    const textContent = result.content.find((c: any) => c.type === 'text')?.text;
    if (!textContent) return undefined;
    try {
      return JSON.parse(textContent);
    } catch {
      return textContent;
    }
  }
}
