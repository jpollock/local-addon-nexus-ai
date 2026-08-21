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
  // One row per site across Local, WP Engine and external SSH hosts, for the
  // Sites table. Distinct from GET_SITES, which is local-only.
  GET_SITE_ROWS: `${ADDON_PREFIX}:sites:rows`,
  // WP-22b: what the record says about where a Local copy's content came from and
  // how far behind it is. Read-only, one Local site id in. Distinct from every other
  // site channel here, which carry INDEX ages (`created_at`, `content_indexed_at`) —
  // when Nexus last read the site, not when the site last pulled from the live one.
  GET_SITE_CONTENT_STATUS: `${ADDON_PREFIX}:site:content-status`,
  /**
   * WP-41 · the comparator surface's four channels — three reads and one
   * arming.
   *
   * Three channels rather than one with a mode flag, because exactly one of
   * them has a side effect. `COMPARATOR_PREVIEW_SCOPE` runs on every click as a
   * user builds a selection; `COMPARATOR_ARM_SELECTION` records an arming. A
   * boolean that switches between them is the shape that eventually gets passed
   * the wrong way round, and the failure would be silent: an arming queued per
   * keystroke, delivered to whichever turn came next.
   */
  COMPARATOR_FACTS: `${ADDON_PREFIX}:comparator:facts`,
  COMPARATOR_MATRIX: `${ADDON_PREFIX}:comparator:matrix`,
  COMPARATOR_PREVIEW_SCOPE: `${ADDON_PREFIX}:comparator:preview-scope`,
  COMPARATOR_ARM_SELECTION: `${ADDON_PREFIX}:comparator:arm-selection`,
  /**
   * WP-44 · the Govern matrix's two channels — one read, one act.
   *
   * SPLIT FOR THE SAME MEASURED REASON WP-41 SPLIT THE COMPARATOR'S: exactly one
   * of them has a side effect. `GOVERN_MATRIX` runs on every open of the
   * Settings section and on every act's completion; `GOVERN_SET_GRANT` widens or
   * narrows what agents may do and writes a control event to the ledger. A
   * single channel with a mode flag is the shape that eventually gets passed the
   * wrong way round, and here the failure would be a permission change nobody
   * asked for.
   *
   * THE ACT'S PAYLOAD IS `{ capability: string; grant: boolean }` AND CARRIES NO
   * LIST. One capability per call, because a widening is one capability at a
   * time — that is the unit a person can weigh, and a plural parameter is the
   * seed of a bulk enable even with no caller for one.
   *
   * NEITHER IS EVER A TOOL. These are ipcMain/ipcRenderer channels with no
   * GraphQL mutation and no caller in src/cli — the same boundary
   * TRUST_EXTERNAL_HOST_KEY uses, and for the same reason: the renderer and the
   * CLI hit one endpoint with one token, so a mutation the CLI merely does not
   * call is not a boundary. XD-8's rule that consent recorded is made at a
   * control and never elicited in chat is kept by there being no path.
   */
  GOVERN_MATRIX: `${ADDON_PREFIX}:govern:matrix`,
  GOVERN_SET_GRANT: `${ADDON_PREFIX}:govern:set-grant`,
  /**
   * WP-46 · M6's FOUR READS. The arrival and the re-entry, and nothing else.
   *
   * ALL FOUR ARE READS. There is no fifth channel with a side effect, because
   * the return has no act of its own: XD-26's re-entry does not re-arm, does not
   * ask for a second approval and does not confirm you are back. The acts a
   * resumed session can reach are the ones it already had, at the gate card,
   * through the channels that already carry them. A `RETURN_RESUME` that "picks
   * the session back up" would be the resume button XD-26 names as an absence.
   *
   * THEY ARE PASS-THROUGHS ONTO `createSessionRegistry`'s FOUR METHODS and they
   * are four rather than one because the registry's own query surface is four:
   * `triage()`, `session(id)`, `changedSince(cursor)`, `snapshot()`. A single
   * channel taking a method name would put a router in the bridge, and the one
   * property this bridge must have is that it holds no logic at all — the host
   * folds, the surface reads, and nothing in between derives anything.
   *
   * `RETURN_SNAPSHOT` overlaps the other three by design; it is the whole fold
   * for a caller that wants all four answers from one read, and it is the only
   * one that reports the horizon, the concurrency limit and the deadline source.
   */
  RETURN_TRIAGE: `${ADDON_PREFIX}:return:triage`,
  RETURN_SESSION: `${ADDON_PREFIX}:return:session`,
  RETURN_CHANGED_SINCE: `${ADDON_PREFIX}:return:changed-since`,
  RETURN_SNAPSHOT: `${ADDON_PREFIX}:return:snapshot`,
  /**
   * WP-56 · The deferral affordance — the only two WRITES on this surface.
   *
   * The four reads above are a thin bridge over one fold. These are not reads,
   * and they are separate channels rather than one taking an action name for
   * the reason stated above: a channel taking a method name would put a router
   * in the bridge.
   *
   * **THEY ARE IPC, NEVER GRAPHQL, AND THAT IS THE ENFORCEMENT OF "ONLY THE USER
   * DEFERS."** The CLI and the renderer hit the identical GraphQL endpoint with
   * the identical bearer token, so a mutation the CLI merely "does not call"
   * would not be a boundary at all — the same reasoning that keeps
   * `TRUST_EXTERNAL_HOST_KEY` off the schema. An agent reaches tools and
   * GraphQL; it does not reach `ipcMain`. So an agent cannot quiet its own gate,
   * which is the self-promotion power inverted and the thing cycle two forbade.
   */
  RETURN_DEFER: `${ADDON_PREFIX}:return:defer`,
  RETURN_END_DEFERRAL: `${ADDON_PREFIX}:return:end-deferral`,
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
  CHAT_CLEAR_ALL: `${ADDON_PREFIX}:chat-clear-all`,
  CHAT_ALL_CLEARED: `${ADDON_PREFIX}:chat-all-cleared`,

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
  /** How many sessions are waiting on the user — drives the collapsed panel tab's badge. */
  CHAT_UNREAD_COUNT: `${ADDON_PREFIX}:sessions:unread-count`,
  /** Stamp a session as seen, clearing it from the unread count. */
  CHAT_SESSION_MARK_READ: `${ADDON_PREFIX}:sessions:mark-read`,
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

  // Database Scanner
  DB_SCAN_SITE: `${ADDON_PREFIX}:db:scan`,
  DB_SCAN_ALL: `${ADDON_PREFIX}:db:scan-all`,
  DB_GET_LAST_SCAN: `${ADDON_PREFIX}:db:get-last-scan`,

  // WPE Auth (fire-and-forget — keeps Express server alive in main process)
  WPE_LOGIN_START: `${ADDON_PREFIX}:wpe:login-start`,

  // Fleet Intelligence (Dashboard panels)
  GET_FLEET_SUMMARY: `${ADDON_PREFIX}:get-fleet-summary`,
  GET_FLEET_PLUGINS: `${ADDON_PREFIX}:get-fleet-plugins`,
  GET_FLEET_LIST: `${ADDON_PREFIX}:get-fleet-list`,

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

  // Job run data (background work scheduler telemetry)
  GET_JOB_RUN_DATA: `${ADDON_PREFIX}:get-job-run-data`,

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
  /** Installs with apache-style objects in log-processor's connected bucket. Run Now offers only
   * these — an install with nothing to read cannot be a run target (BEHAVIOR.md §5). */
  AGENT_LOG_PROCESSOR_CONNECTED_SITES: `${ADDON_PREFIX}:agent:log-processor:connected-sites`,
  /** The Sites tab's whole payload: the account's one bucket, plus every install found in it
   * with object counts, date range and last sync. */
  AGENT_LOG_PROCESSOR_STATE: `${ADDON_PREFIX}:agent:log-processor:state`,
  /** web-analytics' Sites tab payload: which site is bound to which GA4 property. */
  AGENT_WEB_ANALYTICS_STATE: `${ADDON_PREFIX}:agent:web-analytics:state`,
  /** Generic contributed-tool invocation from the renderer — routes through the same
   * AgentDispatcher.dispatch() chokepoint chat/MCP calls use (audited, settings-aware), so a
   * UI-driven call (e.g. the Connect a log source modal) is indistinguishable in the audit log
   * from an equivalent chat command. */
  AGENT_TOOL_INVOKE: `${ADDON_PREFIX}:agent:tool-invoke`,

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

  // Logging stats (Preferences → Logging panel)
  LOGGING_STATS: `${ADDON_PREFIX}:logging-stats`,
  LOGGING_REVEAL: `${ADDON_PREFIX}:logging-reveal`,
  LOGGING_CLEAR: `${ADDON_PREFIX}:logging-clear`,
  LOGGING_PLAN_CLEAR: `${ADDON_PREFIX}:logging-plan-clear`,
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
  /** Nexus mark fill. Pairs with WPE_BRAND, so it is fixed in both themes — see docs/planning/2026-08-10-nexus-panel-insights-design.md */
  NEXUS_MARK: '#05262e',
  /** Disabled foreground on a brand-filled control. Fixed for the same reason. */
  ON_BRAND_DISABLED: '#23272f',
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
