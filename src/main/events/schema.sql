-- Event queue for reliable processing
CREATE TABLE IF NOT EXISTS event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'post_updated', 'plugin_activated', etc.
  payload TEXT NOT NULL,      -- JSON blob
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  INDEX idx_status (status),
  INDEX idx_site_created (site_id, created_at)
);

-- Site metadata cache
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  wp_version TEXT,
  last_sync_at INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  INDEX idx_active (is_active)
);

-- Content nodes (posts, pages)
CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  post_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  author_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(site_id, post_id),
  INDEX idx_site_type (site_id, post_type),
  INDEX idx_updated (site_id, updated_at)
);

-- Plugin nodes
CREATE TABLE IF NOT EXISTS plugins (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  is_active INTEGER DEFAULT 0,
  author TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(site_id, slug),
  INDEX idx_site_active (site_id, is_active)
);

-- User nodes
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  roles TEXT,  -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(site_id, user_id),
  INDEX idx_site (site_id)
);

-- Relationships between entities
CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  from_type TEXT NOT NULL,  -- 'content', 'plugin', 'user'
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,  -- 'authored_by', 'depends_on', 'references'
  created_at INTEGER NOT NULL,
  INDEX idx_from (site_id, from_type, from_id),
  INDEX idx_to (site_id, to_type, to_id),
  INDEX idx_type (site_id, relationship_type)
);

-- Event processing metadata
CREATE TABLE IF NOT EXISTS event_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
