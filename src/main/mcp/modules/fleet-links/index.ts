import { ToolRegistry } from '../../tool-registry';
import { listFleetHandler } from './list-fleet';
import { linkSiteHandler } from './link-site';
import { unlinkSiteHandler } from './unlink-site';

export { listFleetHandler, linkSiteHandler, unlinkSiteHandler };

/** Fleet identity — list the fleet, and correct the local-site-to-install links. */
export function registerFleetLinkTools(registry: ToolRegistry): void {
  registry.register(listFleetHandler);
  registry.register(linkSiteHandler);
  registry.register(unlinkSiteHandler);
}
