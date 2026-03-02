import { ToolRegistry } from '../../tool-registry';
import { siteAuditHandler } from './site-audit';
import { pluginAuditHandler } from './plugin-audit';

/**
 * Composite module — multi-step tools that orchestrate several service
 * calls in parallel and return aggregated results.
 */
export function registerCompositeTools(registry: ToolRegistry): void {
  registry.register(siteAuditHandler);
  registry.register(pluginAuditHandler);
}
