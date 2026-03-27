import { ToolRegistry } from '../../tool-registry';
import { configureApiKeysHandler } from './configure-api-keys';

/**
 * Register test-only tools.
 * These tools are only useful for E2E testing and CI environments.
 */
export function registerTestTools(registry: ToolRegistry): void {
  registry.register(configureApiKeysHandler);
}
