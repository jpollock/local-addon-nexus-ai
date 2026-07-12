import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { ToolProvider } from '../agent-sdk/types';

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

  async invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Enforce tool scope: if allowedTools is defined, only those tools are permitted
    if (this.allowedTools && !this.allowedTools.has(name)) {
      throw new Error(`Tool "${name}" is not declared in this agent's tools list`);
    }

    // Call the registry with 'agent' as the access method
    const result = await this.registry.call(name, args, this.services, 'agent' as any);

    // If the tool returned an error, throw it
    if (result.isError) {
      const text = result.content.find((c: any) => c.type === 'text')?.text ?? 'Tool error';
      throw new Error(text);
    }

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
