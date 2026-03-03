import { ToolRegistry } from '../../tool-registry';
import { syncCredentialsHandler } from './sync-credentials';
import { listAbilitiesHandler } from './list-abilities';
import { runAbilityHandler } from './run-ability';

/**
 * WP Connector module — bridges Local with WordPress APIs:
 * - AI Connector Screen credential sync (WP 7.0+)
 * - Abilities API discovery and execution (WP 6.9+)
 */
export function registerWpConnectorTools(registry: ToolRegistry): void {
  registry.register(syncCredentialsHandler);
  registry.register(listAbilitiesHandler);
  registry.register(runAbilityHandler);
}
