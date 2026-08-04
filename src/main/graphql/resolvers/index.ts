/**
 * Resolver index — combines all domain modules.
 *
 * This file re-exports the factory functions. (It once advertised a combined
 * `createAllResolvers` helper; no such export exists or ever did.)
 *
 * Domain modules:
 *   sites.ts   — site CRUD (list, get, create, clone, rename, start/stop/restart/delete, export, import, logs, config)
 *   twin.ts    — digital twin + fleet summary (status, refresh, deep-refresh, fleet summary/plugins/versions)
 *   wpe.ts     — WP Engine CAPI resolvers (accounts, installs, backup, domains, SSL, SSH, promote)
 *   wp-cli.ts  — WP-CLI command resolvers (nexusWpCommand, nexusWpPluginList)
 *
 * NOT all of these are live. resolvers.ts still wins module resolution for
 * './graphql/resolvers' and carries its own copies of the sites/twin/wpe
 * resolvers; only wp-cli.ts is served from here, because resolvers.ts spreads
 * `createWpCliResolvers(services)` rather than duplicating it. wpe.ts remains a
 * duplicate kept in sync by hand — see CLAUDE.md's audit section.
 */

export { createSiteResolvers } from './sites';
export { createTwinResolvers } from './twin';
export { createWpeResolvers } from './wpe';
export { createWpCliResolvers } from './wp-cli';
