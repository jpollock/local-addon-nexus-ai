import { ToolRegistry } from '../../tool-registry';
import { iwGetConnectionStatusHandler, iwConnectSiteHandler, iwDisconnectSiteHandler } from './iw-tools';
import { iwFleetStatusHandler } from './fleet-tools';
import { iwListKbCollectionsHandler, iwGetKbCollectionHandler, iwSearchKbHandler } from './kb-tools';

export function registerIwTools(registry: ToolRegistry): void {
  registry.register(iwGetConnectionStatusHandler);
  registry.register(iwConnectSiteHandler);
  registry.register(iwDisconnectSiteHandler);
  registry.register(iwFleetStatusHandler);
  registry.register(iwListKbCollectionsHandler);
  registry.register(iwGetKbCollectionHandler);
  registry.register(iwSearchKbHandler);
}
