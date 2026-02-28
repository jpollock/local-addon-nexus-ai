export const ADDON_NAME = 'NexusAI';
export const ADDON_PREFIX = 'nexus-ai';

// ---------------------------------------------------------------------------
// IPC Channels
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  GET_SITE_STATUS: `${ADDON_PREFIX}:get-site-status`,
  REINDEX_SITE: `${ADDON_PREFIX}:reindex-site`,
  GET_MCP_INFO: `${ADDON_PREFIX}:get-mcp-info`,
  GET_FLEET_STATUS: `${ADDON_PREFIX}:get-fleet-status`,
  GET_OLLAMA_STATUS: `${ADDON_PREFIX}:get-ollama-status`,
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
