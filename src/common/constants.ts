export const ADDON_NAME = 'NexusAI';
export const ADDON_PREFIX = 'nexus-ai';

// ---------------------------------------------------------------------------
// IPC Channels
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  GET_MCP_INFO: `${ADDON_PREFIX}:get-mcp-info`,
  GET_STARTUP_STATUS: `${ADDON_PREFIX}:get-startup-status`,
  GET_FLEET_STATUS: `${ADDON_PREFIX}:get-fleet-status`,
  GET_SITE_CHANGE_EVENTS: `${ADDON_PREFIX}:get-site-change-events`,
  GET_SITES: `${ADDON_PREFIX}:get-sites`,
  GET_WPE_SITE_IDS: `${ADDON_PREFIX}:get-wpe-site-ids`,
  GET_DASHBOARD_STATS: `${ADDON_PREFIX}:get-dashboard-stats`,
  START_SITE: `${ADDON_PREFIX}:start-site`,
  STOP_SITE: `${ADDON_PREFIX}:stop-site`,
  STATUS_CHANGE: `${ADDON_PREFIX}:status-change`,
  SEARCH: `${ADDON_PREFIX}:search`,
  SEARCH_KEYWORD: `${ADDON_PREFIX}:search:keyword`,
  INDEX_SITE: `${ADDON_PREFIX}:index-site`,
  INDEX_PROGRESS: `${ADDON_PREFIX}:content:index-progress`,
  GET_SETTINGS: `${ADDON_PREFIX}:get-settings`,
  UPDATE_SETTINGS: `${ADDON_PREFIX}:update-settings`,

  // AI Setup
  SETUP_AI: `${ADDON_PREFIX}:setup-ai`,
  GET_SITE_AI_CONFIG: `${ADDON_PREFIX}:ai:get-site-config`,
  SWITCH_AI_PROVIDER: `${ADDON_PREFIX}:ai:switch-provider`,
  REMOVE_WP_AI: `${ADDON_PREFIX}:ai:remove-wp-ai`,
  GET_WP_VERSION: `${ADDON_PREFIX}:get-wp-version`,
  UPGRADE_WP: `${ADDON_PREFIX}:upgrade-wp`,

  // Chat
  CHAT_SEND: `${ADDON_PREFIX}:chat-send`,
  CHAT_STREAM: `${ADDON_PREFIX}:chat-stream`,
  CHAT_TOOL_APPROVE: `${ADDON_PREFIX}:chat-tool-approve`,
  CHAT_STOP: `${ADDON_PREFIX}:chat-stop`,
  CHAT_CLEAR: `${ADDON_PREFIX}:chat-clear`,

  // Provider management
  VALIDATE_API_KEY: `${ADDON_PREFIX}:validate-api-key`,
  SAVE_API_KEY: `${ADDON_PREFIX}:save-api-key`,
  GET_MODELS: `${ADDON_PREFIX}:get-models`,
  GET_PROVIDERS: `${ADDON_PREFIX}:get-providers`,
  GET_API_KEY: `${ADDON_PREFIX}:get-api-key`,
  GET_API_KEY_STATUS: `${ADDON_PREFIX}:get-api-key-status`,

  // Event tracking & visibility (Sprint 1)
  EVENTS_GET_TIMELINE: `${ADDON_PREFIX}:events:get-timeline`,
  EVENTS_GET_STATS: `${ADDON_PREFIX}:events:get-stats`,
  STORAGE_GET_HEALTH: `${ADDON_PREFIX}:storage:get-health`,
  ISSUES_DETECT: `${ADDON_PREFIX}:issues:detect`,
  STORAGE_CLEANUP: `${ADDON_PREFIX}:storage:cleanup`,
  EVENTS_RETRY_FAILED: `${ADDON_PREFIX}:events:retry-failed`,

  // Search & Discovery (Sprint 2)
  SEARCH_UNIFIED: `${ADDON_PREFIX}:search:unified`,
  FILTERS_GET_COUNTS: `${ADDON_PREFIX}:filters:get-counts`,
  FILTERS_APPLY: `${ADDON_PREFIX}:filters:apply`,
  HEALTH_GET_SCORE: `${ADDON_PREFIX}:health:get-score`,
  HEALTH_GET_ALL_SCORES: `${ADDON_PREFIX}:health:get-all-scores`,
  QUERIES_LIST: `${ADDON_PREFIX}:queries:list`,
  QUERIES_CREATE: `${ADDON_PREFIX}:queries:create`,
  QUERIES_UPDATE: `${ADDON_PREFIX}:queries:update`,
  QUERIES_DELETE: `${ADDON_PREFIX}:queries:delete`,
  QUERIES_RUN: `${ADDON_PREFIX}:queries:run`,

  // Bulk Operations (Sprint 3)
  BULK_EXECUTE: `${ADDON_PREFIX}:bulk:execute`,
  BULK_STATUS: `${ADDON_PREFIX}:bulk:status`,
  BULK_CANCEL: `${ADDON_PREFIX}:bulk:cancel`,
  BULK_LIST: `${ADDON_PREFIX}:bulk:list`,
  BULK_PROGRESS: `${ADDON_PREFIX}:bulk:progress`,

  // Site Groups (Sprint 3)
  GROUPS_LIST: `${ADDON_PREFIX}:groups:list`,
  GROUPS_CREATE: `${ADDON_PREFIX}:groups:create`,
  GROUPS_UPDATE: `${ADDON_PREFIX}:groups:update`,
  GROUPS_DELETE: `${ADDON_PREFIX}:groups:delete`,
  GROUPS_ADD_SITE: `${ADDON_PREFIX}:groups:add-site`,
  GROUPS_REMOVE_SITE: `${ADDON_PREFIX}:groups:remove-site`,

  // Health Trends (Sprint 3)
  HEALTH_GET_TREND: `${ADDON_PREFIX}:health:get-trend`,
  HEALTH_GET_FLEET_TREND: `${ADDON_PREFIX}:health:get-fleet-trend`,

  // Dashboard v2 (Sprint 3)
  DASHBOARD_V2_STATS: `${ADDON_PREFIX}:dashboard:v2-stats`,

  // Credential Sync (Sprint 4)
  SYNC_ALL_CREDENTIALS: `${ADDON_PREFIX}:credentials:sync-all`,
  GET_CREDENTIAL_SYNC_STATUS: `${ADDON_PREFIX}:credentials:sync-status`,

  // AI Status (Sprint 4)
  GET_AI_STATUS: `${ADDON_PREFIX}:ai:get-status`,
  GET_AI_PROXY_INFO: `${ADDON_PREFIX}:ai:proxy-info`,
  SETUP_AI_FLEET: `${ADDON_PREFIX}:ai:setup-fleet`,
  INDEX_ALL_FLEET: `${ADDON_PREFIX}:index-fleet`,
  
  // Auto-start/stop fleet operations (Phase 4)
  SETUP_AI_ALL_AUTO: `${ADDON_PREFIX}:ai:setup-all-auto`,
  INDEX_ALL_AUTO: `${ADDON_PREFIX}:index-all-auto`,

  // Site Finder (Advanced site search)
  SITE_FINDER_GET_OPTIONS: `${ADDON_PREFIX}:site-finder:get-options`,
  SITE_FINDER_APPLY: `${ADDON_PREFIX}:site-finder:apply`,
  SITE_FINDER_AI_PARSE: `${ADDON_PREFIX}:site-finder:ai-parse`,

  // Sidebar Search
  SIDEBAR_FILTER: `${ADDON_PREFIX}:sidebar:filter`,
  SIDEBAR_BULK_ACTION: `${ADDON_PREFIX}:sidebar:bulk-action`,
  SIDEBAR_SEARCH_TOGGLE: `${ADDON_PREFIX}:sidebar:search-toggle`,
  SIDEBAR_NAVIGATE_TO_SITE: `${ADDON_PREFIX}:sidebar:navigate-to-site`,

  // Graph Sync
  SYNC_GRAPH_ALL: `${ADDON_PREFIX}:sync-graph-all`,

  // Fleet operations (new, user-intent named)
  FLEET_REFRESH_QUICK: `${ADDON_PREFIX}:fleet:refresh-quick`,
  FLEET_HEALTH_CHECK_ALL: `${ADDON_PREFIX}:fleet:health-check-all`,
  FLEET_PLUGIN_UPDATE_ALL: `${ADDON_PREFIX}:fleet:plugin-update-all`,

  // Digital Twin (Site Metadata Cache)
  GET_SITE_METADATA: `${ADDON_PREFIX}:metadata:get`,
  REFRESH_SITE_METADATA: `${ADDON_PREFIX}:metadata:refresh`,

  // AI Gateway (Centralized AI Routing)
  AI_GATEWAY_GET_USAGE: `${ADDON_PREFIX}:ai-gateway:get-usage`,
  AI_GATEWAY_GET_COST: `${ADDON_PREFIX}:ai-gateway:get-cost`,
  AI_GATEWAY_GET_STATS: `${ADDON_PREFIX}:ai-gateway:get-stats`,
  AI_GATEWAY_CLEAR_USAGE: `${ADDON_PREFIX}:ai-gateway:clear-usage`,
  AI_GATEWAY_GET_RATE_LIMIT: `${ADDON_PREFIX}:ai-gateway:get-rate-limit`,
  AI_GATEWAY_SET_RATE_LIMIT: `${ADDON_PREFIX}:ai-gateway:set-rate-limit`,
  AI_GATEWAY_CHECK_RATE_LIMIT: `${ADDON_PREFIX}:ai-gateway:check-rate-limit`,
  AI_GATEWAY_USAGE_UPDATED: `${ADDON_PREFIX}:ai-gateway:usage-updated`,

  // AI Context File Generation
  AI_CONTEXT_GENERATE: `${ADDON_PREFIX}:ai-context:generate`,
  AI_CONTEXT_GET_STATUS: `${ADDON_PREFIX}:ai-context:get-status`,

  // Docked Chat Panel (Tasks 1-21)
  CHAT_SESSION_LIST: `${ADDON_PREFIX}:sessions:list`,
  CHAT_SESSION_GET: `${ADDON_PREFIX}:sessions:get`,
  CHAT_SESSION_SAVE: `${ADDON_PREFIX}:sessions:save`,
  CHAT_SESSION_DELETE: `${ADDON_PREFIX}:sessions:delete`,
  CHAT_SESSION_ACTION_RECORDED: `${ADDON_PREFIX}:sessions:action-recorded`,
  ACTIVITY_FILTER: `${ADDON_PREFIX}:activity:filter`,
  OPEN_CHAT_SESSION: `${ADDON_PREFIX}:open-session`,

  // WPE Site Sync (Phase 1)
  WPE_SYNC_ALL: `${ADDON_PREFIX}:wpe:sync-all`,
  WPE_SYNC_STOP: `${ADDON_PREFIX}:wpe:sync-stop`,
  WPE_DIAGNOSE: `${ADDON_PREFIX}:wpe:diagnose`,
  WPE_SYNC_STATUS: `${ADDON_PREFIX}:wpe:sync-status`,
  WPE_SYNC_STATS: `${ADDON_PREFIX}:wpe:sync-stats`,
  CLEANUP_EXCLUDED_TYPES: `${ADDON_PREFIX}:content:cleanup-excluded-types`,
  RESET_CONTENT_INDEX: `${ADDON_PREFIX}:content:reset-index`,
  FACTORY_RESET: `${ADDON_PREFIX}:data:factory-reset`,
  WPE_CAPI_SYNC: `${ADDON_PREFIX}:wpe:capi-sync`,
  RESET_AND_REFRESH: `${ADDON_PREFIX}:data:reset-and-refresh`,
  CLEANUP_GHOST_INSTALLS: `${ADDON_PREFIX}:wpe:cleanup-ghost-installs`,
  WPE_SYNC_SINGLE: `${ADDON_PREFIX}:wpe:sync-single`,
  WPE_GET_SYNCED_SITES: `${ADDON_PREFIX}:wpe:get-synced-sites`,
  WPE_GET_SITE_DETAILS: `${ADDON_PREFIX}:wpe:get-site-details`,
  WPE_DIAGNOSE_SITE: `${ADDON_PREFIX}:wpe:diagnose-site`,
  WPE_REMOVE_SITE: `${ADDON_PREFIX}:wpe:remove-site`,
  WPE_PULL_TO_LOCAL: `${ADDON_PREFIX}:wpe:pull-to-local`,

  // WPE API Credentials (for backup creation via basic auth)
  WPE_GET_API_CREDENTIALS: `${ADDON_PREFIX}:wpe:get-api-credentials`,
  WPE_SET_API_CREDENTIALS: `${ADDON_PREFIX}:wpe:set-api-credentials`,
  WPE_CLEAR_API_CREDENTIALS: `${ADDON_PREFIX}:wpe:clear-api-credentials`,
  WPE_GET_API_CREDENTIALS_STATUS: `${ADDON_PREFIX}:wpe:get-api-credentials-status`,

  // Database Scanner
  DB_SCAN_SITE: `${ADDON_PREFIX}:db:scan`,
  DB_SCAN_ALL: `${ADDON_PREFIX}:db:scan-all`,
  DB_GET_LAST_SCAN: `${ADDON_PREFIX}:db:get-last-scan`,

  // WPE Auth (fire-and-forget — keeps Express server alive in main process)
  WPE_LOGIN_START: `${ADDON_PREFIX}:wpe:login-start`,

  // Fleet Intelligence (Dashboard panels)
  GET_FLEET_SUMMARY: `${ADDON_PREFIX}:get-fleet-summary`,
  GET_FLEET_PLUGINS: `${ADDON_PREFIX}:get-fleet-plugins`,

  // WPE Backup
  WPE_CREATE_BACKUP: `${ADDON_PREFIX}:wpe:create-backup`,

  // Operation Audit Log (Phase 3)
  OPERATION_AUDIT_LIST: `${ADDON_PREFIX}:operation-audit:list`,
  OPERATION_AUDIT_EXPORT: `${ADDON_PREFIX}:operation-audit:export`,

  // WPE Account Filter
  GET_WPE_ACCOUNTS: `${ADDON_PREFIX}:wpe:get-accounts`,
  GET_WPE_INSTALLS_CACHE: `${ADDON_PREFIX}:wpe:get-installs-cache`,

  // External SSH Hosts
  GET_EXTERNAL_HOSTS: `${ADDON_PREFIX}:get-external-hosts`,
  // Renderer-only: never add a matching GraphQL mutation. See
  // docs/superpowers/specs/2026-08-07-host-key-trust-on-first-use-design.md
  // for why a GraphQL mutation here would not actually be CLI-inaccessible.
  TRUST_EXTERNAL_HOST_KEY: `${ADDON_PREFIX}:trust-external-host-key`,
  // Renderer-only, same reasoning as TRUST_EXTERNAL_HOST_KEY: never add a
  // matching GraphQL mutation or CLI command for either of these.
  WRITE_SSH_HOST_ENTRY: `${ADDON_PREFIX}:write-ssh-host-entry`,
  GENERATE_SSH_KEY: `${ADDON_PREFIX}:generate-ssh-key`,
  // Read-only. Same IPC-only precedent as WRITE_SSH_HOST_ENTRY/GENERATE_SSH_KEY
  // for consistency, even though read-only data is lower-risk over GraphQL.
  LIST_SSH_CONFIG_HOSTS: `${ADDON_PREFIX}:list-ssh-config-hosts`,
  PREVIEW_SSH_HOST_ENTRY: `${ADDON_PREFIX}:preview-ssh-host-entry`,
  // Renderer-only: lets a user flip --allow-root for an already-registered
  // connection from Settings/Manage, without re-running the onboarding
  // wizard. No GraphQL mutation or CLI command for this by design, matching
  // TRUST_EXTERNAL_HOST_KEY's precedent.
  SET_EXTERNAL_HOST_ROOT_MODE: `${ADDON_PREFIX}:set-external-host-root-mode`,

  // UI Navigation
  NAVIGATE_TO_PREFERENCES: `${ADDON_PREFIX}:ui:navigate-to-preferences`,

  // Fleet completeness (Overview widget)
  FLEET_COMPLETENESS: `${ADDON_PREFIX}:fleet:completeness`,

  // NexusStateManager — main process pushes partial state patches to renderer.
  // All components observe nexusStore instead of polling individually.
  NEXUS_STATE_UPDATE: `${ADDON_PREFIX}:state:update`,

  // Search intent classification
  SEARCH_CLASSIFY_INTENT: `${ADDON_PREFIX}:search:classify-intent`,

  // System tab — WPE sync summary
  SYSTEM_WPE_STATUS: `${ADDON_PREFIX}:system:wpe-status`,

  // AI Assistant (fleet panel, dashboard Ask tab, site tab)
  ASSISTANT_QUERY:   `${ADDON_PREFIX}:assistant:query`,
  ASSISTANT_CONTEXT: `${ADDON_PREFIX}:assistant:context`,

  // Agent Run Lifecycle — ad-hoc run triggering + progress push
  AGENT_RUN_NOW:        `${ADDON_PREFIX}:agent:run-now`,
  AGENT_RUN_CANCEL:     `${ADDON_PREFIX}:agent:run-cancel`,
  AGENT_RUN_STARTED:    `${ADDON_PREFIX}:agent:run-started`,
  AGENT_RUN_COMPLETE:   `${ADDON_PREFIX}:agent:run-complete`,
  AGENT_SETTINGS_UPDATE:`${ADDON_PREFIX}:agent:settings-update`,
  // Read the main process's persisted view. Without this the renderer had no way to learn
  // what was actually on disk, so it guessed from localStorage and pushed the guess back.
  AGENT_SETTINGS_GET:   `${ADDON_PREFIX}:agent:settings-get`,
  AGENT_REMOVE:         `${ADDON_PREFIX}:agent:remove`,
  AGENT_LOG_OPEN:       `${ADDON_PREFIX}:agent:log-open`,
  /** Sites already bound to a log source via log-processor's connect_log_source tool — the
   * site scope picker for this agent only offers these, since an unconnected site's presence
   * in scope would silently do nothing (see agents/log-processor/agent.ts's run()). */
  AGENT_LOG_PROCESSOR_CONNECTED_SITES: `${ADDON_PREFIX}:agent:log-processor:connected-sites`,

  // Agent Inbox — open items, decisions, resume
  GET_INBOX:      `${ADDON_PREFIX}:inbox:get`,
  INBOX_DECIDE:   `${ADDON_PREFIX}:inbox:decide`,
  INBOX_REOPEN:   `${ADDON_PREFIX}:inbox:reopen`,
  AGENT_RESUME:   `${ADDON_PREFIX}:agent:resume`,

  // Ad-hoc SELECT query against graph DB (for KPI rendering from agent manifest)
  FLEET_SQL_QUERY: `${ADDON_PREFIX}:fleet-sql-query`,

  // OAuth Credential Manager
  CREDENTIAL_CONNECT: `${ADDON_PREFIX}:credential:connect`,
  CREDENTIAL_DISCONNECT: `${ADDON_PREFIX}:credential:disconnect`,
  CREDENTIAL_STATUS: `${ADDON_PREFIX}:credential:status`,
  CREDENTIAL_EVENT: `${ADDON_PREFIX}:credential:event`,

  // API-Key Credential Manager
  CREDENTIAL_API_KEY_SET:    `${ADDON_PREFIX}:credential:api-key:set`,
  CREDENTIAL_API_KEY_STATUS: `${ADDON_PREFIX}:credential:api-key:status`,
  CREDENTIAL_API_KEY_CLEAR:  `${ADDON_PREFIX}:credential:api-key:clear`,

  // WPE Hub Integration (IW Phase 2)
  IW_GET_STATUS:  `${ADDON_PREFIX}:iw:get-status`,
  IW_CONNECT:     `${ADDON_PREFIX}:iw:connect`,
  IW_DISCONNECT:  `${ADDON_PREFIX}:iw:disconnect`,

  // Telemetry (fire-and-forget from renderer → main)
  TELEMETRY_TRACK: `${ADDON_PREFIX}:telemetry`,
} as const;

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export const UI_COLORS = {
  WPE_BRAND: '#0ECAD4',
  STATUS_RUNNING: '#51c356',
  STATUS_HALTED: '#999',
  STATUS_ERROR: '#ef4444',
  STATUS_WARNING: '#f59e0b',
} as const;

export const POLL_INTERVALS = {
  DASHBOARD_STATS_MS: 10_000,
  SITE_LIST_MS: 5_000,
} as const;

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export const MCP_PORT_RANGE_START = 10800;
export const MCP_PORT_RANGE_END = 10899;
export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_CONNECTION_INFO_FILE = 'nexus-ai-mcp-connection-info.json';

export const MCP_TOOL_NAMES = {
  SEARCH_SITE_CONTENT: 'search_site_content',
  GET_SITE_CONTEXT: 'get_site_context',
  LIST_INDEXED_SITES: 'list_indexed_sites',
  GET_INDEX_STATUS: 'get_index_status',
  REINDEX_SITE: 'reindex_site',
  ASK_OLLAMA: 'ask_ollama',
  LIST_OLLAMA_MODELS: 'list_ollama_models',
} as const;

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  INDEX_REGISTRY: `${ADDON_PREFIX}_index_registry`,
  SETTINGS: `${ADDON_PREFIX}_settings`,
  MCP_TOKEN: `${ADDON_PREFIX}_mcp_token`,
  API_KEYS: `${ADDON_PREFIX}_api_keys`,
  API_KEY_STATUS: `${ADDON_PREFIX}_api_key_status`,
  AI_SETUP_STATE: `${ADDON_PREFIX}_ai_setup_state`, // Track which sites have AI setup complete
  SITE_METADATA: `${ADDON_PREFIX}_site_metadata`, // Digital twin: cached site state (WP version, plugins, themes)
  SITE_AI_CONFIG: `${ADDON_PREFIX}_site_ai_config`, // Per-site AI provider configuration
  DB_SCAN_CACHE: `${ADDON_PREFIX}_db_scan_cache`,
  WPE_INSTALL_CACHE: `${ADDON_PREFIX}_wpe_install_cache`, // WPE install names/IDs cached after CAPI sync
  OAUTH_CONNECTIONS: `${ADDON_PREFIX}_oauth_connections`,
  OAUTH_GRANTS: `${ADDON_PREFIX}_oauth_grants`,
  OAUTH_VAULT: `${ADDON_PREFIX}_oauth_vault`,
  API_KEY_CONNECTIONS: `${ADDON_PREFIX}_api_key_connections`,
  IW_SITE_BINDINGS: `${ADDON_PREFIX}_iw_site_bindings`,
  EXTERNAL_SITE_PROFILES: `${ADDON_PREFIX}_external_site_profiles`,
} as const;

// ---------------------------------------------------------------------------
// Vector Store
// ---------------------------------------------------------------------------

/** Vector dimensions for the active embedding model. Use getVectorDimensions() for runtime lookups. */
export const VECTOR_DIMENSIONS = 384; // MiniLM default
export const VECTOR_DB_DIR = 'nexus-ai/vectors';
export const SITE_TABLE_PREFIX = 'site_';

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export const EMBEDDING_MODELS = {
  minilm: {
    dir: 'all-MiniLM-L6-v2-quantized',
    dimensions: 384,
    contextWindow: 256,
  },
  'bge-small': {
    dir: 'bge-small-en-v1.5',
    dimensions: 384,
    contextWindow: 512,
  },
} as const;

export const EMBEDDING_MODEL_FILE = 'model.onnx';
export const EMBEDDING_VOCAB_FILE = 'vocab.txt';
/** @deprecated Use EMBEDDING_MODELS[model].contextWindow */
export const EMBEDDING_MAX_SEQUENCE_LENGTH = 256;

// ---------------------------------------------------------------------------
// Content Extraction
// ---------------------------------------------------------------------------

/** Post types to exclude from indexing */
export const EXCLUDED_POST_TYPES = [
  'revision',
  'nav_menu_item',
  'attachment',
  'wp_template',
  'wp_template_part',
  'wp_global_styles',
  'wp_navigation',
  'wp_font_face',
  'wp_font_family',
  'oembed_cache',
  'custom_css',
  'customize_changeset',
  // Internal/system types that produce noise, not searchable content
  'wp_block',           // reusable blocks
  'user_request',       // GDPR data requests
  'wp_pattern',         // block patterns
  'scheduled-action',   // Action Scheduler
  'shop_order',         // WooCommerce orders (not content)
  'shop_order_refund',  // WooCommerce refunds
  'pm_pattern',         // Pattern Manager plugin
  // ACF internal config types — these are field/group definitions, not content
  'acf-field-group',
  'acf-field',
  'acf-taxonomy',
  'acf-post-type',
  'acf-ui-options-page',
];

/** Max words per chunk before splitting */
export const CHUNK_MAX_WORDS = 500;

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

export const OLLAMA_BASE_URL = 'http://localhost:11434';
export const OLLAMA_POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const CHAT_DEFAULTS = {
  DEFAULT_PROVIDER: 'ollama',
  MAX_AGENT_ITERATIONS: 25,
} as const;
