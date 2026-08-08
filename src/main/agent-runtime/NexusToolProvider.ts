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
  /** Site IDs this provider may target with wp_eval. Empty = any site allowed (MCP mode). */
  private sandboxSiteIds: Set<string> = new Set();

  constructor(registry: ToolRegistry, services: NexusServices, tools: string[] | undefined) {
    this.registry = registry;
    this.services = services;
    this.allowedTools = tools !== undefined ? new Set(tools) : undefined;
  }

  /** Register a sandbox site ID so wp_eval may target it. Agent calls this once after sandbox creation. */
  registerSandbox(siteId: string): void {
    this.sandboxSiteIds.add(siteId);
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

    // Enforce wp_eval site scope: when running as an agent, restrict wp_eval to registered
    // sandbox sites to prevent prompt-injected code from targeting unrelated local sites.
    if (name === 'wp_eval' && this.allowedTools) {
      // No sandbox registered means no site is authorized for wp_eval at all -- this must
      // refuse, not fall through to "any site is fine" the way an empty sandboxSiteIds set
      // used to.
      if (this.sandboxSiteIds.size === 0) {
        throw new Error('wp_eval refused: no sandbox site registered for this agent');
      }
      const targetSite = args.site as string | undefined;
      if (targetSite && !this.sandboxSiteIds.has(targetSite)) {
        throw new Error(`wp_eval: site "${targetSite}" is not in this agent's registered sandbox scope`);
      }
    }

    // Audit: agents bypass McpSafetyWrapper, so we log tool calls here instead.
    const startTime = Date.now();

    // Call the registry with 'agent' as the access method
    const result = await this.registry.call(name, args, this.services, 'agent' as any);

    // Audit log the invocation (mirrors McpSafetyWrapper.auditLog for the agent path)
    const duration_ms = Date.now() - startTime;
    if (result.isError) {
      // Built-in registry didn't find the tool — try contributed tool routing.
      // Agents can call contributed tools from other agents (e.g. get_log_aggregates from
      // log-processor) by declaring them in their tools[] list. The dispatcher builds a
      // full agent context for the contributing agent and executes the handler.
      const contributed = this.services.contributedRegistry?.list().find(t => t.toolName === name);
      if (contributed && this.services.dispatcher) {
        const dispatchResult = await this.services.dispatcher.dispatch(
          contributed.agentName, contributed.toolName, args,
        );
        const dispatchDuration = Date.now() - startTime;
        if (dispatchResult.isError) {
          const errText = dispatchResult.content.find((c: any) => c.type === 'text')?.text ?? 'Dispatch error';
          this.services.auditLogger?.log({
            timestamp: new Date().toISOString(), toolName: `${contributed.agentName}/${name}`,
            tier: contributed.permissionTier as 1 | 2 | 3, params: args,
            confirmed: null, result: 'error', error: errText, duration_ms: dispatchDuration,
          });
          throw new Error(errText);
        }
        this.services.auditLogger?.log({
          timestamp: new Date().toISOString(), toolName: `${contributed.agentName}/${name}`,
          tier: contributed.permissionTier as 1 | 2 | 3, params: args,
          confirmed: null, result: 'success', error: undefined, duration_ms: dispatchDuration,
        });
        const dispatchText = dispatchResult.content.find((c: any) => c.type === 'text')?.text;
        if (!dispatchText) return undefined;
        try { return JSON.parse(dispatchText); } catch { return dispatchText; }
      }

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
