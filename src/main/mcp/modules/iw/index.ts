import { ToolRegistry } from '../../tool-registry';
import { iwGetConnectionStatusHandler, iwConnectSiteHandler, iwDisconnectSiteHandler } from './iw-tools';

export function registerIwTools(registry: ToolRegistry): void {
  registry.register(iwGetConnectionStatusHandler);
  registry.register(iwConnectSiteHandler);
  registry.register(iwDisconnectSiteHandler);
}
