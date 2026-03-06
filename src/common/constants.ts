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
