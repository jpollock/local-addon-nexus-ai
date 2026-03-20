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
    id: String!
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
    id: String!
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
    "List all sites (local + WPE)"
    nexusSitesList: NexusSitesListResult!

    "Get detailed information about a site"
    nexusSitesGet(target: String!): NexusSitesGetResult!

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
  }
`;
