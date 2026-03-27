import { ToolRegistry } from '../../tool-registry';
import { pluginListHandler } from './plugin-list';
import { pluginInstallHandler } from './plugin-install';
import { pluginActivateHandler } from './plugin-activate';
import { pluginDeactivateHandler } from './plugin-deactivate';
import { pluginUpdateHandler } from './plugin-update';
import { themeListHandler } from './theme-list';
import { coreVersionHandler } from './core-version';
import { userListHandler } from './user-list';
import { optionGetHandler } from './option-get';
import { siteHealthHandler } from './site-health';
import { dbExportHandler } from './db-export';
import { importDatabaseHandler } from './import-database';
import { searchReplaceHandler } from './search-replace';
import { wpPostCreateHandler } from './post-create';
import { wpPostUpdateHandler } from './post-update';
import { wpPostDeleteHandler } from './post-delete';
import { evalHandler } from './eval';

/**
 * WP-CLI module — WordPress management tools via Local's wpCli service.
 * All tools require `localServices` and a running site.
 */
export function registerWpCliTools(registry: ToolRegistry): void {
  registry.register(pluginListHandler);
  registry.register(pluginInstallHandler);
  registry.register(pluginActivateHandler);
  registry.register(pluginDeactivateHandler);
  registry.register(pluginUpdateHandler);
  registry.register(themeListHandler);
  registry.register(coreVersionHandler);
  registry.register(userListHandler);
  registry.register(optionGetHandler);
  registry.register(siteHealthHandler);
  registry.register(dbExportHandler);
  registry.register(importDatabaseHandler);
  registry.register(searchReplaceHandler);
  registry.register(wpPostCreateHandler);
  registry.register(wpPostUpdateHandler);
  registry.register(wpPostDeleteHandler);
  registry.register(evalHandler);
}
