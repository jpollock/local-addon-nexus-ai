import { ToolRegistry } from '../../tool-registry';
import { syncCredentialsHandler } from './sync-credentials';
import { listAbilitiesHandler } from './list-abilities';
import { runAbilityHandler } from './run-ability';
import { setupAIToolHandler } from './setup-ai-tool';
import { getSiteAiConfigToolHandler } from './get-site-ai-config-tool';
import { switchProviderToolHandler } from './switch-provider-tool';
import { syncCredentialsMcpToolHandler } from './sync-credentials-mcp-tool';
import {
  getEventEndpointInfoTool,
  getEventProcessorStatsTool,
  getGraphContentTool,
  listGraphContentTool,
  getGraphPluginTool,
  listGraphPluginsTool,
  getGraphStatsTool,
} from './event-tools';

/**
 * WP Connector module — bridges Local with WordPress APIs:
 * - Setup for AI (plugin install, experiments, credentials, ACF)
 * - AI Connector Screen credential sync (WP 7.0+)
 * - Abilities API discovery and execution (WP 6.9+)
 * - Event processing and knowledge graph queries
 */
export function registerWpConnectorTools(registry: ToolRegistry): void {
  registry.register(setupAIToolHandler);
  registry.register(syncCredentialsHandler);
  registry.register(listAbilitiesHandler);
  registry.register(runAbilityHandler);

  // Gateway-aware AI provider management tools
  registry.register(getSiteAiConfigToolHandler);
  registry.register(switchProviderToolHandler);
  registry.register(syncCredentialsMcpToolHandler);

  // Event processing tools
  registry.register(getEventEndpointInfoTool);
  registry.register(getEventProcessorStatsTool);
  registry.register(getGraphContentTool);
  registry.register(listGraphContentTool);
  registry.register(getGraphPluginTool);
  registry.register(listGraphPluginsTool);
  registry.register(getGraphStatsTool);
}
