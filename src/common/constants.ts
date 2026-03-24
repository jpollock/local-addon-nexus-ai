export const ADDON_NAME = 'NexusAI';
export const ADDON_PREFIX = 'nexus-ai';

// ---------------------------------------------------------------------------
// IPC Channels
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  GET_MCP_INFO: `${ADDON_PREFIX}:get-mcp-info`,
  GET_FLEET_STATUS: `${ADDON_PREFIX}:get-fleet-status`,
  GET_SITES: `${ADDON_PREFIX}:get-sites`,
  GET_WPE_SITE_IDS: `${ADDON_PREFIX}:get-wpe-site-ids`,
  GET_DASHBOARD_STATS: `${ADDON_PREFIX}:get-dashboard-stats`,
  START_SITE: `${ADDON_PREFIX}:start-site`,
  STOP_SITE: `${ADDON_PREFIX}:stop-site`,
  STATUS_CHANGE: `${ADDON_PREFIX}:status-change`,
  SEARCH: `${ADDON_PREFIX}:search`,
  INDEX_SITE: `${ADDON_PREFIX}:index-site`,
  GET_SETTINGS: `${ADDON_PREFIX}:get-settings`,
  UPDATE_SETTINGS: `${ADDON_PREFIX}:update-settings`,

  // AI Setup
  SETUP_AI: `${ADDON_PREFIX}:setup-ai`,
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

  // Graph Sync
  SYNC_GRAPH_ALL: `${ADDON_PREFIX}:sync-graph-all`,

  // Digital Twin (Site Metadata Cache)
  GET_SITE_METADATA: `${ADDON_PREFIX}:metadata:get`,
  REFRESH_SITE_METADATA: `${ADDON_PREFIX}:metadata:refresh`,

  // AI Gateway (Centralized AI Routing)
  AI_GATEWAY_GET_USAGE: `${ADDON_PREFIX}:ai-gateway:get-usage`,
  AI_GATEWAY_GET_COST: `${ADDON_PREFIX}:ai-gateway:get-cost`,
  AI_GATEWAY_GET_STATS: `${ADDON_PREFIX}:ai-gateway:get-stats`,
  AI_GATEWAY_CLEAR_USAGE: `${ADDON_PREFIX}:ai-gateway:clear-usage`,

  // WPE Site Sync (Phase 1)
  WPE_SYNC_ALL: `${ADDON_PREFIX}:wpe:sync-all`,
  WPE_SYNC_STATUS: `${ADDON_PREFIX}:wpe:sync-status`,
  WPE_SYNC_SINGLE: `${ADDON_PREFIX}:wpe:sync-single`,
  WPE_GET_SYNCED_SITES: `${ADDON_PREFIX}:wpe:get-synced-sites`,
  WPE_GET_SITE_DETAILS: `${ADDON_PREFIX}:wpe:get-site-details`,
  WPE_DIAGNOSE_SITE: `${ADDON_PREFIX}:wpe:diagnose-site`,
  WPE_REMOVE_SITE: `${ADDON_PREFIX}:wpe:remove-site`,
  WPE_PULL_TO_LOCAL: `${ADDON_PREFIX}:wpe:pull-to-local`,
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
} as const;

// ---------------------------------------------------------------------------
// Vector Store
// ---------------------------------------------------------------------------

export const VECTOR_DIMENSIONS = 384;
export const VECTOR_DB_DIR = 'nexus-ai/vectors';
export const SITE_TABLE_PREFIX = 'site_';

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export const EMBEDDING_MODEL_DIR = 'all-MiniLM-L6-v2-quantized';
export const EMBEDDING_MODEL_FILE = 'model.onnx';
export const EMBEDDING_VOCAB_FILE = 'vocab.txt';
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
  MAX_AGENT_ITERATIONS: 10,
} as const;
