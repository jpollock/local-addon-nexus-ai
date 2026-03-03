import { ToolRegistry } from '../../tool-registry';
import { syncCredentialsHandler } from './sync-credentials';
import { listAbilitiesHandler } from './list-abilities';
import { runAbilityHandler } from './run-ability';
import { setupAIToolHandler } from './setup-ai-tool';

/**
 * WP Connector module — bridges Local with WordPress APIs:
 * - Setup for AI (plugin install, experiments, credentials, ACF)
 * - AI Connector Screen credential sync (WP 7.0+)
 * - Abilities API discovery and execution (WP 6.9+)
 */
export function registerWpConnectorTools(registry: ToolRegistry): void {
  registry.register(setupAIToolHandler);
  registry.register(syncCredentialsHandler);
  registry.register(listAbilitiesHandler);
  registry.register(runAbilityHandler);
}
