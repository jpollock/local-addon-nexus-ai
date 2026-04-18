/**
 * Resolver index — combines all domain modules.
 *
 * This file re-exports the factory functions and provides a combined
 * `createAllResolvers` helper for use by the original resolvers.ts during
 * the migration period.
 *
 * Domain modules:
 *   sites.ts   — site CRUD (list, get, create, clone, rename, start/stop/restart/delete, export, import, logs, config)
 *   twin.ts    — digital twin + fleet summary (status, refresh, deep-refresh, fleet summary/plugins/versions)
 *   wpe.ts     — WP Engine CAPI resolvers (accounts, installs, backup, domains, SSL, SSH, promote)
 *   wp-cli.ts  — WP-CLI command resolvers (nexusWpCommand, nexusWpPluginList)
 */

export { createSiteResolvers } from './sites';
export { createTwinResolvers } from './twin';
export { createWpeResolvers } from './wpe';
export { createWpCliResolvers } from './wp-cli';
