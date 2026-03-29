/**
 * GraphQL Schema for Nexus CLI
 *
 * Defines type definitions for CLI commands.
 * POC: 5 commands (sites list/create, wp plugin list, sync pull/push)
 */

import gql from 'graphql-tag';

export const typeDefs = gql`
  # ============================================================================
  # Site Management Types
  # ============================================================================

  type LocalSite {
    "Site name (as shown in Local)"
    name: String!
    "Site status (running, stopped, etc.)"
    status: String!
    "WordPress version"
    wpVersion: String
    "Site domain"
    domain: String!
    "Site ID"
    id: ID!
    "PHP version"
    phpVersion: String
    "Linked WPE environment"
    linkedTo: SiteLink
  }

  type WpeSite {
    "WPE account ID (UUID)"
    account: String!
    "WPE account name (for display)"
    accountName: String
    "WPE install ID"
    installId: String!
    "Environment type (production, staging, development)"
    environment: String!
    "Install name"
    name: String
    "Primary domain"
    domain: String
    "WordPress version"
    wpVersion: String
    "PHP version"
    phpVersion: String
    "Linked local site"
    linkedTo: String
  }

  type SiteLink {
    "WPE account ID (UUID)"
    account: String!
    "WPE account name (for display)"
    accountName: String
    "WPE install ID (UUID)"
    installId: String!
    "WPE install name (for display)"
    installName: String
    "WPE environment"
    environment: String!
    "Created at"
    createdAt: String!
    "Last synced at"
    lastSyncedAt: String
  }

  type NexusSitesListResult {
    "Local sites"
    local: [LocalSite!]!
    "WPE sites"
    wpe: [WpeSite!]!
  }

  type SiteDetails {
    "Site ID"
    id: ID!
    "Site name"
    name: String!
    "Site domain"
    domain: String
    "Site path on disk"
    path: String!
    "Site status (running, halted)"
    status: String!
    "WordPress version"
    wpVersion: String
    "PHP version"
    phpVersion: String
    "Is site indexed"
    indexed: Boolean!
    "Last indexed timestamp"
    indexedAt: String
    "Number of indexed documents"
    documentCount: Int!
    "Number of indexed chunks"
    chunkCount: Int!
    "WPE link info"
    linkedTo: SiteLinkInfo
  }

  type SiteLinkInfo {
    "WPE install ID"
    installId: String!
    "WPE environment"
    environment: String!
  }

  type NexusSitesGetResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Site details"
    site: SiteDetails
  }

  input NexusCloneSiteInput {
    "Source site name (e.g., 'mysite@local')"
    source: String!
    "New site name"
    newName: String!
  }

  type NexusCloneSiteResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Cloned site name"
    siteName: String
    "Cloned site ID"
    siteId: String
  }

  input NexusRenameSiteInput {
    "Site target (e.g., 'mysite@local')"
    target: String!
    "New site name"
    newName: String!
  }

  type NexusRenameSiteResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Old site name"
    oldName: String
    "New site name"
    newName: String
  }

  input NexusExportSiteInput {
    "Site target (e.g., 'mysite@local')"
    target: String!
    "Output path for archive (optional)"
    outputPath: String
  }

  type NexusExportSiteResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Path to exported archive"
    outputPath: String
  }

  input NexusImportSiteInput {
    "Path to archive file"
    archivePath: String!
    "Name for imported site (optional)"
    name: String
  }

  type NexusImportSiteResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Imported site name"
    siteName: String
    "Imported site ID"
    siteId: String
  }

  input NexusGetLogsInput {
    "Site target (e.g., 'mysite@local')"
    target: String!
    "Number of lines to tail"
    tail: Int
    "Follow logs (stream)"
    follow: Boolean
  }

  type NexusGetLogsResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Log content"
    logs: String
  }

  input NexusConfigPhpInput {
    "Site target (e.g., 'mysite@local')"
    target: String!
    "PHP version (e.g., '8.2', '8.1', '7.4')"
    version: String!
  }

  type NexusConfigPhpResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Old PHP version"
    oldVersion: String
    "New PHP version"
    newVersion: String
  }

  input NexusConfigSslInput {
    "Site target (e.g., 'mysite@local')"
    target: String!
  }

  type NexusConfigSslResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
  }

  input NexusConfigXdebugInput {
    "Site target (e.g., 'mysite@local')"
    target: String!
    "Enable or disable Xdebug"
    enable: Boolean!
  }

  type NexusConfigXdebugResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Xdebug enabled status"
    enabled: Boolean!
  }

  type Blueprint {
    "Blueprint name"
    name: String!
    "Blueprint description"
    description: String
  }

  type NexusBlueprintsListResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Available blueprints"
    blueprints: [Blueprint!]
  }

  input NexusBlueprintsSaveInput {
    "Site target (e.g., 'mysite@local')"
    target: String!
    "Name for the blueprint"
    blueprintName: String!
  }

  type NexusBlueprintsSaveResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Created blueprint name"
    blueprintName: String
  }

  # ============================================================================
  # WPE Integration Types
  # ============================================================================

  type WpeAccount {
    "Account ID"
    id: ID!
    "Account name"
    name: String!
  }

  type NexusWpeAccountsResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "WPE accounts"
    accounts: [WpeAccount!]!
  }

  type WpeInstall {
    "Install ID"
    id: ID!
    "Install name"
    name: String!
    "Account ID"
    account: String!
    "Account name"
    accountName: String
    "Environment"
    environment: String!
    "Primary domain"
    domain: String
    "PHP version"
    phpVersion: String
    "WordPress version"
    wpVersion: String
  }

  type NexusWpeInstallsResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "WPE installs"
    installs: [WpeInstall!]!
  }

  type NexusWpeInstallResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Install details"
    install: WpeInstall
  }

  input NexusWpeBackupInput {
    "WPE target (e.g., 'wpe:account/install@production')"
    target: String!
    "Backup description"
    description: String
  }

  type NexusWpeBackupResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Backup ID"
    backupId: String
  }

  type NexusWpeCacheResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
  }

  input NexusWpeLinkInput {
    "Local site (e.g., 'mysite@local')"
    localSite: String!
    "WPE target (e.g., 'wpe:account/install@production')"
    wpeTarget: String!
  }

  type NexusWpeLinkResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
  }

  input NexusWpeChangesInput {
    "Local site (e.g., 'mysite@local')"
    localSite: String!
    "Show changes since date"
    since: String
  }

  type WpeChange {
    "Change type (added, modified, deleted)"
    type: String!
    "File path"
    path: String!
    "Change status"
    status: String
  }

  type NexusWpeChangesResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "List of changes"
    changes: [WpeChange!]!
  }

  type NexusSyncHistoryEntry {
    "Sync timestamp"
    timestamp: String!
    "Sync direction (pull or push)"
    direction: String!
    "Success flag"
    success: Boolean!
    "Files transferred"
    filesTransferred: Int
    "Database included"
    databaseIncluded: Boolean
  }

  type NexusSyncHistoryResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Sync history"
    history: [NexusSyncHistoryEntry!]!
  }

  input NexusCreateSiteInput {
    "Site name"
    name: String!
    "Blueprint name (optional)"
    blueprint: String
    "PHP version (optional)"
    phpVersion: String
    "WordPress version (optional)"
    wpVersion: String
  }

  type NexusCreateSiteResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Created site name"
    siteName: String
    "Created site ID"
    siteId: String
    "Created site domain"
    siteDomain: String
  }

  type NexusSiteOperationResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Site name"
    siteName: String
    "New site status"
    status: String
  }

  # ============================================================================
  # WP-CLI Types
  # ============================================================================

  type NexusWpPlugin {
    "Plugin name"
    name: String!
    "Plugin slug"
    slug: String!
    "Status (active, inactive, must-use)"
    status: String!
    "Version"
    version: String!
    "Update available"
    update: String
    "Auto-update enabled"
    autoUpdate: String
  }

  type NexusWpPluginListResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "List of plugins"
    plugins: [NexusWpPlugin!]
  }

  type NexusWpCommandResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Command stdout"
    stdout: String
    "Command stderr"
    stderr: String
    "Exit code"
    exitCode: Int
  }

  # ============================================================================
  # Sync Types
  # ============================================================================

  input NexusSyncPullInput {
    "Local site target (e.g., 'mysite@local')"
    localSite: String!
    "WPE site target (e.g., 'wpe:account/install@production')"
    wpeTarget: String!
    "Pull database only"
    dbOnly: Boolean
    "Pull files only"
    filesOnly: Boolean
  }

  type NexusSyncPullResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Link was created during this operation"
    linkCreated: Boolean!
    "Bytes transferred"
    bytesTransferred: Float
    "Sync duration (seconds)"
    duration: Float
  }

  input NexusSyncPushInput {
    "Local site target (e.g., 'mysite@local')"
    localSite: String!
    "WPE site target (e.g., 'wpe:account/install@production')"
    wpeTarget: String!
    "Push database (requires confirmation)"
    includeDb: Boolean
    "Push database only"
    dbOnly: Boolean
    "Push files only"
    filesOnly: Boolean
    "Create WPE install if doesn't exist"
    create: Boolean
    "Confirmation token from previous call"
    _confirmationToken: String
  }

  type NexusSyncPushResult {
    "Success flag"
    success: Boolean!
    "Error message if failed"
    error: String
    "Confirmation token (if confirmation required)"
    confirmationToken: String
    "Confirmation message"
    confirmationMessage: String
    "Link was created during this operation"
    linkCreated: Boolean!
    "Install was created during this operation"
    installCreated: Boolean!
    "Bytes transferred"
    bytesTransferred: Float
    "Sync duration (seconds)"
    duration: Float
  }

  # ============================================================================
  # Mutations
  # ============================================================================

  extend type Mutation {
    "Get current AI provider configuration"
    nexusAiGetConfig: NexusAiGetConfigResult!

    "Set AI provider, model, and optionally API key"
    nexusAiSetConfig(provider: String!, model: String!, apiKey: String, useLocalGateway: Boolean): NexusAiSetConfigResult!

    "List all sites (local + WPE)"
    nexusSitesList: NexusSitesListResult!

    "Get detailed information about a site"
    nexusSitesGet(target: String!): NexusSitesGetResult!

    "Clone an existing site"
    nexusSitesClone(input: NexusCloneSiteInput!): NexusCloneSiteResult!

    "Rename a site"
    nexusSitesRename(input: NexusRenameSiteInput!): NexusRenameSiteResult!

    "Export a site to archive"
    nexusSitesExport(input: NexusExportSiteInput!): NexusExportSiteResult!

    "Import a site from archive"
    nexusSitesImport(input: NexusImportSiteInput!): NexusImportSiteResult!

    "Get site logs"
    nexusSitesLogs(input: NexusGetLogsInput!): NexusGetLogsResult!

    "Change PHP version"
    nexusSitesConfigPhp(input: NexusConfigPhpInput!): NexusConfigPhpResult!

    "Trust SSL certificate"
    nexusSitesConfigSsl(input: NexusConfigSslInput!): NexusConfigSslResult!

    "Toggle Xdebug"
    nexusSitesConfigXdebug(input: NexusConfigXdebugInput!): NexusConfigXdebugResult!

    "List blueprints"
    nexusBlueprintsList: NexusBlueprintsListResult!

    "Save site as blueprint"
    nexusBlueprintsSave(input: NexusBlueprintsSaveInput!): NexusBlueprintsSaveResult!

    # WPE Integration
    "List WP Engine accounts"
    nexusWpeAccounts: NexusWpeAccountsResult!

    "List WPE installs"
    nexusWpeInstalls(account: String): NexusWpeInstallsResult!

    "Get WPE install details"
    nexusWpeInstall(installId: String!): NexusWpeInstallResult!

    "Create WPE backup"
    nexusWpeBackup(input: NexusWpeBackupInput!): NexusWpeBackupResult!

    "Purge WPE cache"
    nexusWpeCache(target: String!): NexusWpeCacheResult!

    "Link local site to WPE"
    nexusWpeLink(input: NexusWpeLinkInput!): NexusWpeLinkResult!

    "Get changes between local and WPE"
    nexusWpeChanges(input: NexusWpeChangesInput!): NexusWpeChangesResult!

    "Get sync history"
    nexusSyncHistory(localSite: String!): NexusSyncHistoryResult!

    "Create a new local site"
    nexusSitesCreate(input: NexusCreateSiteInput!): NexusCreateSiteResult!

    "Start a local site"
    nexusSitesStart(target: String!): NexusSiteOperationResult!

    "Stop a local site"
    nexusSitesStop(target: String!): NexusSiteOperationResult!

    "Restart a local site"
    nexusSitesRestart(target: String!): NexusSiteOperationResult!

    "Delete a local site"
    nexusSitesDelete(target: String!): NexusSiteOperationResult!

    "List plugins on a site (local or WPE)"
    nexusWpPluginList(target: String!): NexusWpPluginListResult!

    "Run any WP-CLI command on a site (local or WPE)"
    nexusWpCommand(target: String!, command: [String!]!): NexusWpCommandResult!

    "Pull from WPE to local"
    nexusSyncPull(input: NexusSyncPullInput!): NexusSyncPullResult!

    "Push from local to WPE"
    nexusSyncPush(input: NexusSyncPushInput!): NexusSyncPushResult!

    # Fleet Intelligence
    "Fleet health summary"
    nexusFleetHealth: NexusFleetHealthResult!

    "Individual site health"
    nexusFleetSiteHealth(target: String!): NexusFleetSiteHealthResult!

    "Search across all sites"
    nexusFleetSearch(query: String!, limit: Int): NexusFleetSearchResult!

    "Filter sites by criteria"
    nexusFleetFilter(filter: NexusFleetFilterInput!): NexusFleetFilterResult!

    "List site groups"
    nexusFleetGroupsList: NexusFleetGroupsListResult!

    "Create site group"
    nexusFleetGroupsCreate(name: String!, description: String): NexusFleetGroupsCreateResult!

    "Add sites to group"
    nexusFleetGroupsAdd(group: String!, sites: [String!]!): NexusFleetGroupsAddResult!

    "Remove sites from group"
    nexusFleetGroupsRemove(group: String!, sites: [String!]!): NexusFleetGroupsRemoveResult!

    "Delete site group"
    nexusFleetGroupsDelete(group: String!): NexusFleetGroupsDeleteResult!

    "Bulk reindex sites"
    nexusFleetBulkReindex(targets: [String!]!): NexusFleetBulkReindexResult!

    "Bulk plugin update"
    nexusFleetBulkPluginUpdate(input: NexusFleetBulkPluginUpdateInput!): NexusFleetBulkPluginUpdateResult!

    "Bulk health check"
    nexusFleetBulkHealthCheck(targets: [String!]!): NexusFleetBulkHealthCheckResult!

    "Compare two sites"
    nexusFleetCompare(target1: String!, target2: String!): NexusFleetCompareResult!

    # Content & Context
    "Search content within a site"
    nexusContentSearch(target: String!, query: String!, limit: Int): NexusContentSearchResult!

    "Search content across all sites"
    nexusContentSearchAll(query: String!, limit: Int): NexusContentSearchAllResult!

    "Get site file structure"
    nexusContentStructure(target: String!, depth: Int): NexusContentStructureResult!

    "Get indexing status"
    nexusContentIndexStatus(target: String!): NexusContentIndexStatusResult!

    "List indexed sites"
    nexusContentListIndexed: NexusContentListIndexedResult!

    "Reindex a site"
    nexusContentReindex(target: String!): NexusContentReindexResult!

    # AI & Connector
    "List Ollama models"
    nexusAiModels: NexusAiModelsResult!

    "Ask Ollama a question"
    nexusAiAsk(query: String!, model: String): NexusAiAskResult!

    "Setup AI on WordPress site"
    nexusAiSetup(target: String!, provider: String, force: Boolean): NexusAiSetupResult!

    "Sync AI credentials to site"
    nexusAiSyncCredentials(target: String!): NexusAiSyncCredentialsResult!

    "List AI abilities on site"
    nexusAiAbilities(target: String!): NexusAiAbilitiesResult!

    "Run an AI ability"
    nexusAiRun(target: String!, ability: String!, params: String): NexusAiRunResult!

    "Get AI connector status"
    nexusAiStatus(target: String!): NexusAiStatusResult!

    "Get per-site AI provider configuration"
    nexusAiGetSiteConfig(target: String!): NexusAiGetSiteConfigResult!

    "Switch AI provider on an already-configured site"
    nexusAiSwitchProvider(target: String!, provider: String!): NexusAiSwitchProviderResult!

    # Composite Audits
    "Comprehensive site audit"
    nexusAuditSite(target: String!): NexusAuditSiteResult!

    "Fleet-wide plugin audit"
    nexusAuditPlugins: NexusAuditPluginsResult!
  }

  # ============================================================================
  # Fleet Intelligence Types
  # ============================================================================

  type FleetHealthSummary {
    totalSites: Int!
    runningSites: Int!
    haltedSites: Int!
    healthyCount: Int!
    warningCount: Int!
    criticalCount: Int!
    totalPlugins: Int!
    outdatedPlugins: Int!
    totalThemes: Int!
    outdatedThemes: Int!
  }

  type NexusFleetHealthResult {
    success: Boolean!
    error: String
    summary: FleetHealthSummary
  }

  type HealthIssue {
    severity: String!
    message: String!
    category: String!
  }

  type PluginHealth {
    total: Int!
    active: Int!
    outdated: Int!
  }

  type ThemeHealth {
    total: Int!
    active: Int!
    outdated: Int!
  }

  type WordPressHealth {
    version: String!
    updateAvailable: Boolean!
  }

  type SiteHealth {
    status: String!
    score: Int!
    issues: [HealthIssue!]!
    plugins: PluginHealth!
    themes: ThemeHealth!
    wordpress: WordPressHealth!
  }

  type NexusFleetSiteHealthResult {
    success: Boolean!
    error: String
    health: SiteHealth
  }

  type SearchResult {
    target: String!
    siteName: String!
    type: String!
    score: Float!
    snippet: String!
  }

  type NexusFleetSearchResult {
    success: Boolean!
    error: String
    results: [SearchResult!]!
  }

  input NexusFleetFilterInput {
    status: String
    plugin: String
    wpVersion: String
    linkedOnly: Boolean
  }

  type FilteredSite {
    target: String!
    name: String!
    status: String!
    wpVersion: String
    linkedTo: String
  }

  type NexusFleetFilterResult {
    success: Boolean!
    error: String
    sites: [FilteredSite!]!
  }

  type NexusSiteGroup {
    id: ID!
    name: String!
    description: String
    siteCount: Int!
    createdAt: String!
  }

  type NexusFleetGroupsListResult {
    success: Boolean!
    error: String
    groups: [NexusSiteGroup!]!
  }

  type NexusFleetGroupsCreateResult {
    success: Boolean!
    error: String
    groupId: String
  }

  type NexusFleetGroupsAddResult {
    success: Boolean!
    error: String
    addedCount: Int!
  }

  type NexusFleetGroupsRemoveResult {
    success: Boolean!
    error: String
    removedCount: Int!
  }

  type NexusFleetGroupsDeleteResult {
    success: Boolean!
    error: String
  }

  type ReindexResult {
    target: String!
    success: Boolean!
    error: String
    documentCount: Int
  }

  type NexusFleetBulkReindexResult {
    success: Boolean!
    error: String
    results: [ReindexResult!]!
  }

  input NexusFleetBulkPluginUpdateInput {
    targets: [String!]!
    plugin: String
    all: Boolean!
    dryRun: Boolean!
  }

  type UpdatedPlugin {
    slug: String!
    oldVersion: String!
    newVersion: String!
  }

  type PluginUpdateResult {
    target: String!
    success: Boolean!
    error: String
    updatedPlugins: [UpdatedPlugin!]!
  }

  type NexusFleetBulkPluginUpdateResult {
    success: Boolean!
    error: String
    results: [PluginUpdateResult!]!
  }

  type HealthCheckResult {
    target: String!
    status: String!
    score: Int!
    issueCount: Int!
  }

  type NexusFleetBulkHealthCheckResult {
    success: Boolean!
    error: String
    results: [HealthCheckResult!]!
  }

  type SiteInfo {
    target: String!
    wpVersion: String!
    pluginCount: Int!
    themeCount: Int!
  }

  type SiteDifference {
    category: String!
    item: String!
    site1Value: String!
    site2Value: String!
  }

  type SiteComparison {
    site1: SiteInfo!
    site2: SiteInfo!
    differences: [SiteDifference!]!
  }

  type NexusFleetCompareResult {
    success: Boolean!
    error: String
    comparison: SiteComparison
  }

  # ============================================================================
  # Content & Context Types
  # ============================================================================

  type ContentSearchResult {
    path: String!
    type: String!
    score: Float!
    snippet: String!
    lineNumber: Int
  }

  type NexusContentSearchResult {
    success: Boolean!
    error: String
    results: [ContentSearchResult!]!
  }

  type CrossSiteSearchResult {
    target: String!
    siteName: String!
    path: String!
    type: String!
    score: Float!
    snippet: String!
  }

  type NexusContentSearchAllResult {
    success: Boolean!
    error: String
    results: [CrossSiteSearchResult!]!
  }

  type StructureChild {
    path: String!
    type: String!
    size: Int
  }

  type SiteStructure {
    path: String!
    type: String!
    fileCount: Int!
    children: [StructureChild!]
  }

  type NexusContentStructureResult {
    success: Boolean!
    error: String
    structure: SiteStructure
  }

  type IndexStatus {
    state: String!
    documentCount: Int!
    chunkCount: Int!
    lastIndexed: String
    indexedAt: String
    errorMessage: String
  }

  type NexusContentIndexStatusResult {
    success: Boolean!
    error: String
    status: IndexStatus
  }

  type IndexedSite {
    target: String!
    siteName: String!
    state: String!
    documentCount: Int!
    chunkCount: Int!
    lastIndexed: String
  }

  type NexusContentListIndexedResult {
    success: Boolean!
    error: String
    sites: [IndexedSite!]!
  }

  type NexusContentReindexResult {
    success: Boolean!
    error: String
    documentCount: Int
    chunkCount: Int
  }

  # ============================================================================
  # AI & Connector Types
  # ============================================================================

  type OllamaModel {
    name: String!
    size: Float!
    modified: String!
  }

  type NexusAiModelsResult {
    success: Boolean!
    error: String
    models: [OllamaModel!]!
  }

  type NexusAiAskResult {
    success: Boolean!
    error: String
    response: String
  }

  type InstalledPlugin {
    plugin: String!
    version: String!
  }

  type AiConfiguration {
    experiments: [String!]!
    providers: [String!]!
    credentials: Boolean!
  }

  type NexusAiSetupResult {
    success: Boolean!
    error: String
    installed: [InstalledPlugin!]!
    configured: AiConfiguration
  }

  type SyncedCredential {
    provider: String!
    credentialCount: Int!
  }

  type NexusAiSyncCredentialsResult {
    success: Boolean!
    error: String
    synced: [SyncedCredential!]
    "Provider configured for this site (when syncing via autoSyncCredentials)"
    provider: String
  }

  type AbilityParameter {
    name: String!
    type: String!
    required: Boolean!
    description: String
  }

  type AiAbility {
    name: String!
    description: String!
    parameters: [AbilityParameter!]!
  }

  type NexusAiAbilitiesResult {
    success: Boolean!
    error: String
    abilities: [AiAbility!]!
  }

  type NexusAiRunResult {
    success: Boolean!
    error: String
    result: String
  }

  type AiConnectorStatus {
    connectorInstalled: Boolean!
    connectorVersion: String
    experimentsEnabled: Boolean!
    providersConfigured: Int!
    credentialsSynced: Boolean!
    abilitiesAvailable: Int!
  }

  type NexusAiStatusResult {
    success: Boolean!
    error: String
    status: AiConnectorStatus
  }

  # ============================================================================
  # Composite Audit Types
  # ============================================================================

  type AuditPlugin {
    name: String!
    version: String!
    status: String!
    updateAvailable: Boolean!
    updateVersion: String
  }

  type AuditTheme {
    name: String!
    version: String!
    status: String!
    updateAvailable: Boolean!
  }

  type AuditHealthIssue {
    severity: String!
    message: String!
  }

  type AuditHealth {
    status: String!
    score: Int!
    issues: [AuditHealthIssue!]!
  }

  type AuditSecurity {
    outdatedPlugins: Int!
    outdatedThemes: Int!
    coreUpToDate: Boolean!
    phpUpToDate: Boolean!
  }

  type SiteAudit {
    siteName: String!
    wpVersion: String!
    phpVersion: String!
    plugins: [AuditPlugin!]!
    themes: [AuditTheme!]!
    health: AuditHealth!
    security: AuditSecurity!
  }

  type NexusAuditSiteResult {
    success: Boolean!
    error: String
    audit: SiteAudit
  }

  type SitePluginReport {
    siteName: String!
    pluginCount: Int!
    activePlugins: Int!
    outdatedCount: Int!
    plugins: [AuditPlugin!]!
  }

  type PluginAuditReport {
    totalSites: Int!
    sitesAudited: Int!
    totalPlugins: Int!
    outdatedPlugins: Int!
    sites: [SitePluginReport!]!
  }

  type NexusAuditPluginsResult {
    success: Boolean!
    error: String
    report: PluginAuditReport
  }

  # ============================================================================
  # AI Provider Config Types
  # ============================================================================

  type AiProviderConfig {
    "Currently configured provider ID (anthropic, openai, google, ollama, local-gateway)"
    provider: String
    "Currently configured model"
    model: String
    "Whether an API key is saved for the current provider"
    hasApiKey: Boolean!
    "Whether Local AI Gateway is enabled"
    useLocalGateway: Boolean!
  }

  type NexusAiGetConfigResult {
    success: Boolean!
    error: String
    config: AiProviderConfig
  }

  type NexusAiSetConfigResult {
    success: Boolean!
    error: String
  }

  type AiSiteConfig {
    "Provider ID configured for this site"
    provider: String!
    "Model name (if set)"
    model: String
    "Unix timestamp when configured"
    configuredAt: Float!
  }

  type NexusAiGetSiteConfigResult {
    success: Boolean!
    error: String
    config: AiSiteConfig
  }

  type NexusAiSwitchProviderResult {
    success: Boolean!
    error: String
    previousProvider: String
    newProvider: String
  }

  # ============================================================================
  # Database Scanner Types
  # ============================================================================

  type DbTableInfo {
    name: String!
    rows: Int!
    dataSizeBytes: Float!
    indexSizeBytes: Float!
    totalSizeBytes: Float!
  }

  type DbRevisionPost {
    postId: Int!
    postTitle: String!
    revisionCount: Int!
  }

  type DbRevisionInfo {
    totalCount: Int!
    estimatedSizeBytes: Float!
    topPosts: [DbRevisionPost!]!
  }

  type DbTransientInfo {
    expiredCount: Int!
    totalCount: Int!
    estimatedSizeBytes: Float!
  }

  type DbOrphanInfo {
    orphanedPostMeta: Int!
    orphanedCommentMeta: Int!
    orphanedUserMeta: Int!
  }

  type DbDraftTrashInfo {
    autoDraftCount: Int!
    trashedPostCount: Int!
    estimatedSizeBytes: Float!
  }

  type DbPluginTableInfo {
    leftoverTables: [String!]!
    customTables: [DbTableInfo!]!
  }

  type DbWooCommerceInfo {
    sessionCount: Int!
    estimatedSessionSizeBytes: Float!
    oldLogCount: Int!
  }

  type DbScanResultGql {
    siteId: String!
    siteName: String!
    scannedAt: Float!
    wpVersion: String!
    isWooCommerceActive: Boolean!
    tables: [DbTableInfo!]!
    revisions: DbRevisionInfo!
    transients: DbTransientInfo!
    orphans: DbOrphanInfo!
    draftsAndTrash: DbDraftTrashInfo!
    pluginTables: DbPluginTableInfo!
    wooCommerce: DbWooCommerceInfo
    healthScore: Int!
    summary: [String!]!
    durationMs: Int!
  }

  type NexusDbScanResult {
    success: Boolean!
    error: String
    scan: DbScanResultGql
  }

  input NexusDbCleanInput {
    target: String!
    items: [String!]
    dryRun: Boolean
  }

  type DbCleanItemResult {
    type: String!
    label: String!
    rowsAffected: Int!
    success: Boolean!
    error: String
  }

  type DbCleanResultGql {
    siteId: String!
    siteName: String!
    dryRun: Boolean!
    cleanedAt: Float!
    items: [DbCleanItemResult!]!
    totalRowsAffected: Int!
    estimatedSpaceFreedBytes: Float!
  }

  type NexusDbCleanResult {
    success: Boolean!
    error: String
    result: DbCleanResultGql
  }

  type DbFleetEntry {
    siteId: String!
    siteName: String!
    healthScore: Int!
    wpVersion: String!
    isWooCommerceActive: Boolean!
    revisionCount: Int!
    expiredTransients: Int!
    leftoverTables: Int!
    topIssue: String
    summary: [String!]!
    durationMs: Int!
  }

  type NexusDbReportResult {
    success: Boolean!
    error: String
    scannedAt: Float
    sitesScanned: Int
    sitesFailed: Int
    sites: [DbFleetEntry!]
  }

  extend type Mutation {
    "Scan database health for a local WordPress site"
    nexusDbScan(target: String!): NexusDbScanResult!
    "Clean database items (dry_run defaults true)"
    nexusDbClean(input: NexusDbCleanInput!): NexusDbCleanResult!
    "Fleet database health report — scans all running sites"
    nexusDbReport: NexusDbReportResult!
  }
`;
