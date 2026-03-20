# CLI ↔ MCP Feature Parity Analysis

**Status:** CRITICAL GAP — CLI has ~10% of MCP functionality

## Current State

### CLI Commands (10 total)
```bash
nexus sites list
nexus sites create <name>@local
nexus sites start <target>
nexus sites stop <target>
nexus sites restart <target>
nexus sites delete <target>
nexus wp <target> <command...>     # Generic WP-CLI passthrough
nexus sync pull <local> --from <wpe>
nexus sync push <local> --to <wpe>
nexus update [--check]
```

### MCP Tools (90+ total)

#### Site Management (17 tools) ✅=exists in CLI, ❌=missing
- ✅ `local_list_sites` → `nexus sites list`
- ✅ `local_start_site` → `nexus sites start`
- ✅ `local_stop_site` → `nexus sites stop`
- ✅ `local_restart_site` → `nexus sites restart`
- ✅ `local_create_site` → `nexus sites create`
- ✅ `local_delete_site` → `nexus sites delete`
- ❌ `local_get_site` - Get detailed site info
- ❌ `local_clone_site` - Clone an existing site
- ❌ `local_export_site` - Export site to archive
- ❌ `local_import_site` - Import site from archive
- ❌ `local_rename_site` - Rename a site
- ❌ `local_change_php_version` - Switch PHP versions
- ❌ `local_trust_ssl` - Trust SSL certificate
- ❌ `local_toggle_xdebug` - Enable/disable Xdebug
- ❌ `local_list_blueprints` - List available blueprints
- ❌ `local_save_blueprint` - Save site as blueprint
- ❌ `local_get_site_logs` - Get site logs

**CLI Coverage: 6/17 (35%)**

#### WPE Integration (11 tools)
- ❌ `wpe_get_accounts` - List WPE accounts
- ❌ `wpe_get_installs` - List installs for account
- ❌ `wpe_get_install` - Get install details
- ❌ `wpe_create_backup` - Create WPE backup
- ❌ `wpe_purge_cache` - Purge WPE cache
- ❌ `local_wpe_link` - Link local site to WPE
- ✅ `local_wpe_pull` → `nexus sync pull`
- ✅ `local_wpe_push` → `nexus sync push`
- ✅ `nexus_list_sites` → `nexus sites list` (partial - shows both local+WPE)
- ❌ `local_get_site_changes` - Check what changed
- ❌ `local_get_sync_history` - View sync history

**CLI Coverage: 3/11 (27%)**

#### WP-CLI (17 tools)
- ⚠️ `wp_plugin_list` → `nexus wp <target> plugin list` (special formatting)
- ⚠️ `wp_plugin_install` → `nexus wp <target> plugin install`
- ⚠️ `wp_plugin_activate` → `nexus wp <target> plugin activate`
- ⚠️ `wp_plugin_deactivate` → `nexus wp <target> plugin deactivate`
- ⚠️ `wp_plugin_update` → `nexus wp <target> plugin update`
- ⚠️ `wp_theme_list` → `nexus wp <target> theme list`
- ⚠️ `wp_core_version` → `nexus wp <target> core version`
- ⚠️ `wp_user_list` → `nexus wp <target> user list`
- ⚠️ `wp_option_get` → `nexus wp <target> option get`
- ⚠️ `wp_site_health` → `nexus wp <target> site health`
- ⚠️ `wp_db_export` → `nexus wp <target> db export`
- ⚠️ `import_database` → `nexus wp <target> db import`
- ⚠️ `wp_search_replace` → `nexus wp <target> search-replace`
- ⚠️ `wp_post_create` → `nexus wp <target> post create`
- ⚠️ `wp_post_update` → `nexus wp <target> post update`
- ⚠️ `wp_post_delete` → `nexus wp <target> post delete`
- ⚠️ `wp_eval` → `nexus wp <target> eval`

**CLI Coverage: 17/17 (100% via generic passthrough)**
**Problem:** No dedicated subcommands, no parameter validation, no formatted output except `plugin list`

#### Fleet Intelligence (14+ tools)
- ❌ `fleet_summary` - Overview of all sites
- ❌ `find_sites_with_plugin` - Find sites using a plugin
- ❌ `find_sites_with_theme` - Find sites using a theme
- ❌ `find_outdated_sites` - Find sites needing updates
- ❌ `compare_sites` - Compare two sites
- ❌ `detect_drift` - Detect configuration drift
- ❌ `bulk_plugin_update` - Update plugins across multiple sites
- ❌ `bulk_reindex` - Reindex multiple sites
- ❌ `fleet_filter` - Filter sites by criteria
- ❌ `fleet_health_summary` - Health metrics across fleet
- ❌ `fleet_search` - Search across fleet
- ❌ `get_site_health` - Get health for specific site
- ❌ `list_site_groups` - List saved site groups
- ❌ `manage_site_group` - Create/update/delete groups

**CLI Coverage: 0/14 (0%)**

#### Content Search (2 tools)
- ❌ `search_content` - Search content in a site
- ❌ `search_across_sites` - Search across multiple sites

**CLI Coverage: 0/2 (0%)**

#### Site Context (4 tools)
- ❌ `get_site_structure` - Get site file/folder structure
- ❌ `get_index_status` - Check indexing status
- ❌ `list_indexed_sites` - List indexed sites
- ❌ `reindex_site` - Reindex a site

**CLI Coverage: 0/4 (0%)**

#### Ollama (3 tools)
- ❌ `ask_ollama` - Query Ollama models
- ❌ `list_models` - List available models
- ❌ `model_recommender` - Get model recommendations

**CLI Coverage: 0/3 (0%)**

#### WP Connector (5 tools)
- ❌ `list_abilities` - List WordPress AI abilities
- ❌ `run_ability` - Execute an AI ability
- ❌ `setup_ai` - Setup AI on a site
- ❌ `sync_credentials` - Sync AI credentials
- ❌ `auto_sync_credentials` - Auto-sync on changes

**CLI Coverage: 0/5 (0%)**

#### Composite Tools (2 tools)
- ❌ `plugin_audit` - Comprehensive plugin audit
- ❌ `site_audit` - Comprehensive site audit

**CLI Coverage: 0/2 (0%)**

## Overall Parity Score

| Module | CLI Coverage | Tools Missing |
|--------|--------------|---------------|
| Site Management | 35% (6/17) | 11 |
| WPE Integration | 27% (3/11) | 8 |
| WP-CLI | 100%* (passthrough only) | 0* |
| Fleet Intelligence | 0% (0/14) | 14 |
| Content Search | 0% (0/2) | 2 |
| Site Context | 0% (0/4) | 4 |
| Ollama | 0% (0/3) | 3 |
| WP Connector | 0% (0/5) | 5 |
| Composite | 0% (0/2) | 2 |
| **TOTAL** | **~10% (9/60+)** | **51+** |

*WP-CLI has generic passthrough but lacks dedicated commands with proper UX

## Proposed CLI Structure

### Full Command Tree
```
nexus
├── sites
│   ├── list [--local-only] [--wpe-only] [--json]
│   ├── get <target> [--json]
│   ├── create <name>@local [--blueprint=<name>] [--php=<ver>] [--wp=<ver>]
│   ├── clone <source> <dest>
│   ├── rename <target> <new-name>
│   ├── start <target>
│   ├── stop <target>
│   ├── restart <target>
│   ├── delete <target> [--force]
│   ├── export <target> <output-path>
│   ├── import <archive-path> [--name=<name>]
│   ├── logs <target> [--tail=<n>] [--follow]
│   └── config
│       ├── php <target> <version>
│       ├── ssl <target> --trust
│       └── xdebug <target> [--enable|--disable]
│
├── blueprints
│   ├── list [--json]
│   └── save <target> <blueprint-name>
│
├── wpe
│   ├── accounts [--json]
│   ├── installs [<account>] [--json]
│   ├── install <install-id> [--json]
│   ├── backup <install-id>
│   ├── cache <install-id> --purge
│   ├── link <local-site> <wpe-install>
│   └── changes <local-site> [--since=<date>]
│
├── sync
│   ├── pull <local> --from <wpe> [--db-only] [--files-only]
│   ├── push <local> --to <wpe> [--db] [--db-only] [--files-only] [--create]
│   └── history <local-site> [--json]
│
├── wp
│   ├── <target> <command...>  # Generic passthrough (keep)
│   ├── plugin
│   │   ├── list <target> [--status=<active|inactive|all>] [--json]
│   │   ├── install <target> <slug...> [--activate]
│   │   ├── activate <target> <slug...>
│   │   ├── deactivate <target> <slug...>
│   │   └── update <target> [<slug>] [--all] [--dry-run]
│   ├── theme
│   │   ├── list <target> [--json]
│   │   └── activate <target> <slug>
│   ├── core
│   │   ├── version <target>
│   │   └── update <target> [--version=<ver>]
│   ├── db
│   │   ├── export <target> [--output=<path>]
│   │   ├── import <target> <file>
│   │   └── search-replace <target> <from> <to> [--dry-run] [--all-tables]
│   ├── post
│   │   ├── create <target> --title=<title> [--content=<content>] [--status=<status>]
│   │   ├── update <target> <id> [--title=<title>] [--content=<content>]
│   │   └── delete <target> <id> [--force]
│   ├── user
│   │   └── list <target> [--json]
│   ├── option
│   │   └── get <target> <option-name>
│   └── health <target> [--json]
│
├── fleet
│   ├── summary [--json]
│   ├── health [--json]
│   ├── search <query> [--json]
│   ├── filter --plugin=<slug> | --theme=<slug> | --wp=<version> | --php=<version>
│   ├── outdated [--wp] [--php] [--plugins]
│   ├── compare <site1> <site2> [--json]
│   ├── drift [--threshold=<percent>]
│   ├── groups
│   │   ├── list
│   │   ├── create <name> --sites=<site1,site2,...>
│   │   ├── add <group> <site...>
│   │   ├── remove <group> <site...>
│   │   └── delete <group>
│   └── bulk
│       ├── plugin update <plugin-slug> [--sites=<group>|<site1,site2>] [--dry-run]
│       └── reindex [--sites=<group>|<site1,site2>]
│
├── search
│   ├── content <target> <query> [--post-type=<type>] [--json]
│   └── across <query> [--sites=<site1,site2>] [--json]
│
├── index
│   ├── status <target>
│   ├── list [--json]
│   └── reindex <target> [--force]
│
├── ai
│   ├── ask <query> [--model=<model>]
│   ├── models [--json]
│   ├── setup <target> [--provider=<ollama|openai>]
│   ├── abilities <target> [--json]
│   ├── run <target> <ability> [--args=<json>]
│   └── credentials
│       ├── sync <target>
│       └── auto-sync [--enable|--disable]
│
├── audit
│   ├── site <target> [--json]
│   └── plugin <target> [--vulnerabilities] [--updates] [--unused]
│
└── update [--check]
```

## Implementation Plan

### Phase 1: Complete Site Management (11 commands)
- [ ] `nexus sites get`
- [ ] `nexus sites clone`
- [ ] `nexus sites rename`
- [ ] `nexus sites export`
- [ ] `nexus sites import`
- [ ] `nexus sites logs`
- [ ] `nexus sites config php`
- [ ] `nexus sites config ssl`
- [ ] `nexus sites config xdebug`
- [ ] `nexus blueprints list`
- [ ] `nexus blueprints save`

### Phase 2: Complete WPE Integration (7 commands)
- [ ] `nexus wpe accounts`
- [ ] `nexus wpe installs`
- [ ] `nexus wpe install`
- [ ] `nexus wpe backup`
- [ ] `nexus wpe cache --purge`
- [ ] `nexus wpe link`
- [ ] `nexus wpe changes`
- [ ] `nexus sync history`

### Phase 3: Dedicated WP-CLI Commands (15 commands)
- [ ] `nexus wp plugin list` (enhance existing)
- [ ] `nexus wp plugin install/activate/deactivate/update`
- [ ] `nexus wp theme list/activate`
- [ ] `nexus wp core version/update`
- [ ] `nexus wp db export/import/search-replace`
- [ ] `nexus wp post create/update/delete`
- [ ] `nexus wp user list`
- [ ] `nexus wp option get`
- [ ] `nexus wp health`

### Phase 4: Fleet Intelligence (14 commands)
- [ ] `nexus fleet summary`
- [ ] `nexus fleet health`
- [ ] `nexus fleet search`
- [ ] `nexus fleet filter`
- [ ] `nexus fleet outdated`
- [ ] `nexus fleet compare`
- [ ] `nexus fleet drift`
- [ ] `nexus fleet groups *`
- [ ] `nexus fleet bulk plugin update`
- [ ] `nexus fleet bulk reindex`

### Phase 5: Content & Context (6 commands)
- [ ] `nexus search content`
- [ ] `nexus search across`
- [ ] `nexus index status`
- [ ] `nexus index list`
- [ ] `nexus index reindex`

### Phase 6: AI & Connector (7 commands)
- [ ] `nexus ai ask`
- [ ] `nexus ai models`
- [ ] `nexus ai setup`
- [ ] `nexus ai abilities`
- [ ] `nexus ai run`
- [ ] `nexus ai credentials sync`
- [ ] `nexus ai credentials auto-sync`

### Phase 7: Composite Tools (2 commands)
- [ ] `nexus audit site`
- [ ] `nexus audit plugin`

## Test Coverage Requirements

### Unit Tests
- [ ] All new commands in `tests/unit/cli/commands/`
- [ ] All utilities in `tests/unit/cli/utils/`
- [ ] Bootstrap system (✅ already complete - 15/15 passing)

### Integration Tests
- [ ] GraphQL mutation calls for each command
- [ ] Target parsing and validation
- [ ] Error handling and user prompts
- [ ] JSON output format validation

### E2E Tests
- [ ] Full command workflows (create → start → configure → sync → delete)
- [ ] Fleet operations on multiple sites
- [ ] AI setup and credential sync
- [ ] Audit workflows

### Current Test Status
```bash
# Unit tests
tests/unit/cli/
├── bootstrap.test.ts (✅ 15/15 passing)
└── commands/
    ├── sites.test.ts (❌ MISSING)
    ├── wp.test.ts (❌ MISSING)
    ├── sync.test.ts (❌ MISSING)
    ├── wpe.test.ts (❌ MISSING)
    ├── fleet.test.ts (❌ MISSING)
    ├── search.test.ts (❌ MISSING)
    ├── index.test.ts (❌ MISSING)
    ├── ai.test.ts (❌ MISSING)
    └── audit.test.ts (❌ MISSING)

# Integration tests
tests/integration/cli/ (❌ MISSING ENTIRELY)

# E2E tests
tests/e2e/cli/ (❌ MISSING ENTIRELY)
```

**Test Coverage: <5% (only bootstrap system tested)**

## Breaking Changes

None - all new commands are additive. Existing commands remain unchanged.

## Timeline Estimate

- Phase 1: 2-3 days
- Phase 2: 1-2 days
- Phase 3: 2-3 days
- Phase 4: 3-4 days
- Phase 5: 1-2 days
- Phase 6: 2-3 days
- Phase 7: 1 day
- Testing: 3-4 days

**Total: 15-22 days of focused development**

## Priority Order

1. **Phase 1 (Site Management)** - Core daily workflows
2. **Phase 2 (WPE Integration)** - Complete the sync story
3. **Phase 3 (WP-CLI)** - Better UX for common operations
4. **Phase 4 (Fleet Intelligence)** - The killer feature for managing multiple sites
5. **Phase 5 (Content/Context)** - Search and indexing
6. **Phase 6 (AI)** - AI integration and abilities
7. **Phase 7 (Composite)** - Convenience wrappers

## Next Steps

1. ✅ Document the gap (this file)
2. Get approval on command structure
3. Implement Phase 1 (Site Management)
4. Write unit tests for Phase 1
5. Continue through phases with test-first approach
6. Update documentation as we go
