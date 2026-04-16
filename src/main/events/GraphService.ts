/**
 * GraphService - Knowledge graph storage and queries using SQLite
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  Site,
  Content,
  Plugin,
  Theme,
  User,
  Relationship,
  GraphStats,
  EventQueueEntry,
  EventStatsData,
  EventType,
  StorageHealthData,
  IssueData,
} from './types';

export interface GraphServiceOptions {
  dbPath: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  error TEXT,
  retry_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_event_status ON event_queue(status);
CREATE INDEX IF NOT EXISTS idx_event_type ON event_queue(event_type);
CREATE INDEX IF NOT EXISTS idx_event_site_created ON event_queue(site_id, created_at);

CREATE TABLE IF NOT EXISTS wpe_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  wp_version TEXT,
  php_version TEXT,
  account_id TEXT,
  last_sync_at INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sites_active ON sites(is_active);

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
  UNIQUE(site_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_content_site_type ON content(site_id, post_type);
CREATE INDEX IF NOT EXISTS idx_content_updated ON content(site_id, updated_at);

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
  UNIQUE(site_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_plugins_site_active ON plugins(site_id, is_active);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  is_active INTEGER DEFAULT 0,
  author TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(site_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_themes_site_active ON themes(site_id, is_active);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  roles TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(site_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_users_site ON users(site_id);

CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(site_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(site_id, to_type, to_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(site_id, relationship_type);

CREATE TABLE IF NOT EXISTS event_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export class GraphService {
  private db: Database.Database | null = null;
  private dbPath: string;
  private logger: any;

  constructor(dbPath: string, logger?: any) {
    this.dbPath = dbPath;
    this.logger = logger || console;
  }

  async initialize(): Promise<void> {
    // Create directory if needed
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(this.dbPath);

    // Execute schema
    this.db.exec(SCHEMA);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Run migrations
    await this.runMigrations();
  }

  /**
   * Run database migrations for schema updates
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) return;

    this.logger.info('[GraphService] Running migrations...');

    // Check if source column exists
    const tableInfo = this.db.pragma('table_info(sites)') as Array<{ name: string }>;
    this.logger.info('[GraphService] Table info columns:', tableInfo.map(c => c.name).join(', '));
    const hasSourceColumn = tableInfo.some(col => col.name === 'source');

    this.logger.info(`[GraphService] Has source column: ${hasSourceColumn}`);

    if (!hasSourceColumn) {
      this.logger.info('[GraphService] Adding WPE columns to sites table...');
      try {
        this.db.exec('ALTER TABLE sites ADD COLUMN source TEXT DEFAULT "local"');
        this.logger.info('[GraphService]   - Added source column');
        this.db.exec('ALTER TABLE sites ADD COLUMN remote_install_id TEXT');
        this.logger.info('[GraphService]   - Added remote_install_id column');
        this.db.exec('ALTER TABLE sites ADD COLUMN remote_domain TEXT');
        this.logger.info('[GraphService]   - Added remote_domain column');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_sites_source ON sites(source)');
        this.logger.info('[GraphService]   - Created source index');
        this.logger.info('[GraphService] ✓ WPE columns migration completed');
      } catch (err) {
        this.logger.error('[GraphService] Migration failed:', err);
        throw err;
      }
    } else {
      this.logger.info('[GraphService] WPE columns already exist, skipping migration');
    }

    // Migration: add php_version column if missing
    const hasPhpVersion = this.db
      .prepare("SELECT COUNT(*) as c FROM pragma_table_info('sites') WHERE name='php_version'")
      .get() as { c: number };
    if (!hasPhpVersion.c) {
      this.logger.info('[GraphService] Adding php_version column to sites table...');
      this.db.exec('ALTER TABLE sites ADD COLUMN php_version TEXT');
      this.logger.info('[GraphService] ✓ php_version column added');
    }

    // Migration: add account_id column if missing
    const hasAccountId = this.db
      .prepare("SELECT COUNT(*) as c FROM pragma_table_info('sites') WHERE name='account_id'")
      .get() as { c: number };
    if (!hasAccountId.c) {
      this.logger.info('[GraphService] Adding account_id column to sites table...');
      this.db.exec('ALTER TABLE sites ADD COLUMN account_id TEXT');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_sites_account ON sites(account_id)');
      this.logger.info('[GraphService] ✓ account_id column added');
    }

    // Migration: create wpe_accounts table if missing
    const hasAccountsTable = this.db
      .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='wpe_accounts'")
      .get() as { c: number };
    if (!hasAccountsTable.c) {
      this.logger.info('[GraphService] Creating wpe_accounts table...');
      this.db.exec('CREATE TABLE IF NOT EXISTS wpe_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT)');
      this.logger.info('[GraphService] ✓ wpe_accounts table created');
    }

    // Migration: create site_usage table if missing
    const hasSiteUsage = this.db
      .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='site_usage'")
      .get() as { c: number };
    if (!hasSiteUsage.c) {
      this.logger.info('[GraphService] Creating site_usage table...');
      this.db.exec(`
        CREATE TABLE site_usage (
          site_id      TEXT    NOT NULL,
          period       TEXT    NOT NULL,
          source       TEXT    NOT NULL DEFAULT 'wpe-capi',
          visits       INTEGER,
          bandwidth_bytes INTEGER,
          storage_bytes   INTEGER,
          raw_json     TEXT,
          recorded_at  INTEGER NOT NULL,
          PRIMARY KEY (site_id, period, source)
        );
        CREATE INDEX idx_site_usage_site ON site_usage(site_id);
        CREATE INDEX idx_site_usage_period ON site_usage(period);
      `);
      this.logger.info('[GraphService] ✓ site_usage table created');
    }
  }

  /** Expose the underlying database for shared use (e.g., HealthTrendTracker). */
  getDb(): Database.Database | null {
    return this.db;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async listTables(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    return rows.map(r => r.name);
  }

  // ===== Site Operations =====

  async upsertSite(site: Site): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO sites (id, name, domain, wp_version, php_version, account_id, last_sync_at, is_active, created_at, updated_at, source, remote_install_id, remote_domain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        domain = excluded.domain,
        wp_version = COALESCE(excluded.wp_version, wp_version),
        php_version = COALESCE(excluded.php_version, php_version),
        account_id = COALESCE(excluded.account_id, account_id),
        last_sync_at = excluded.last_sync_at,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at,
        source = excluded.source,
        remote_install_id = excluded.remote_install_id,
        remote_domain = excluded.remote_domain
    `);

    stmt.run(
      site.id,
      site.name,
      site.domain,
      site.wp_version ?? null,
      site.php_version ?? null,
      site.account_id ?? null,
      site.last_sync_at ?? null,
      site.is_active ? 1 : 0,
      site.created_at,
      site.updated_at,
      site.source ?? 'local',
      site.remote_install_id ?? null,
      site.remote_domain ?? null
    );
  }

  async upsertAccount(account: { id: string; name: string; nickname?: string }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare(`
      INSERT INTO wpe_accounts (id, name, nickname)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        nickname = COALESCE(excluded.nickname, nickname)
    `).run(account.id, account.name, account.nickname ?? null);
  }

  async getAccounts(): Promise<Array<{ id: string; name: string; nickname: string | null }>> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.prepare('SELECT id, name, nickname FROM wpe_accounts ORDER BY name').all() as any[];
  }

  async getSite(id: string): Promise<Site | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db
      .prepare('SELECT * FROM sites WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      wp_version: row.wp_version,
      php_version: row.php_version,
      last_sync_at: row.last_sync_at,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: row.source ?? 'local',
      remote_install_id: row.remote_install_id,
      remote_domain: row.remote_domain,
      account_id: row.account_id,
    };
  }

  async listSites(options?: { active_only?: boolean; source?: 'local' | 'wpe' }): Promise<Site[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT * FROM sites';
    const conditions: string[] = [];
    const params: any[] = [];

    if (options?.active_only) {
      conditions.push('is_active = 1');
    }

    if (options?.source) {
      conditions.push('source = ?');
      params.push(options.source);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY name';

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      wp_version: row.wp_version,
      php_version: row.php_version,
      last_sync_at: row.last_sync_at,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: row.source ?? 'local',
      remote_install_id: row.remote_install_id,
      remote_domain: row.remote_domain,
      account_id: row.account_id,
    }));
  }

  // ===== Content Operations =====

  async upsertContent(content: Omit<Content, 'id'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO content (site_id, post_id, post_type, title, status, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, post_id) DO UPDATE SET
        post_type = excluded.post_type,
        title = excluded.title,
        status = excluded.status,
        author_id = excluded.author_id,
        updated_at = excluded.updated_at
      RETURNING id
    `);

    const result = stmt.get(
      content.site_id,
      content.post_id,
      content.post_type,
      content.title,
      content.status,
      content.author_id ?? null,
      content.created_at,
      content.updated_at
    ) as { id: number };

    return result.id;
  }

  async getContent(siteId: string, postId: number): Promise<Content | null> {
    if (!this.db) throw new Error('Database not initialized');

    this.logger.info(`[GraphService] getContent: siteId="${siteId}", postId=${postId}`);
    const row = this.db
      .prepare('SELECT * FROM content WHERE site_id = ? AND post_id = ?')
      .get(siteId, postId) as any;

    this.logger.info(`[GraphService] getContent result: ${row ? 'FOUND' : 'NULL'}`);
    if (!row) return null;

    return {
      id: row.id,
      site_id: row.site_id,
      post_id: row.post_id,
      post_type: row.post_type,
      title: row.title,
      status: row.status,
      author_id: row.author_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async listContent(siteId: string, options?: { post_type?: string }): Promise<Content[]> {
    if (!this.db) throw new Error('Database not initialized');

    this.logger.info(`[GraphService] listContent: siteId="${siteId}", options=${JSON.stringify(options)}`);
    let query = 'SELECT * FROM content WHERE site_id = ?';
    const params: any[] = [siteId];

    if (options?.post_type) {
      query += ' AND post_type = ?';
      params.push(options.post_type);
    }

    query += ' ORDER BY updated_at DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    this.logger.info(`[GraphService] listContent result: ${rows.length} rows`);

    return rows.map(row => ({
      id: row.id,
      site_id: row.site_id,
      post_id: row.post_id,
      post_type: row.post_type,
      title: row.title,
      status: row.status,
      author_id: row.author_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async deleteContent(siteId: string, postId: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare('DELETE FROM content WHERE site_id = ? AND post_id = ?')
      .run(siteId, postId);
  }

  // ===== Plugin Operations =====

  async upsertPlugin(plugin: Omit<Plugin, 'id'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO plugins (site_id, slug, name, version, is_active, author, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, slug) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        is_active = excluded.is_active,
        author = excluded.author,
        updated_at = excluded.updated_at
      RETURNING id
    `);

    const result = stmt.get(
      plugin.site_id,
      plugin.slug,
      plugin.name,
      plugin.version ?? null,
      plugin.is_active ? 1 : 0,
      plugin.author ?? null,
      plugin.created_at,
      plugin.updated_at
    ) as { id: number };

    return result.id;
  }

  async getPlugin(siteId: string, slug: string): Promise<Plugin | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db
      .prepare('SELECT * FROM plugins WHERE site_id = ? AND slug = ?')
      .get(siteId, slug) as any;

    if (!row) return null;

    return {
      id: row.id,
      site_id: row.site_id,
      slug: row.slug,
      name: row.name,
      version: row.version,
      is_active: row.is_active === 1,
      author: row.author,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async listPlugins(siteId: string, options?: { active_only?: boolean }): Promise<Plugin[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT * FROM plugins WHERE site_id = ?';
    const params: any[] = [siteId];

    if (options?.active_only) {
      query += ' AND is_active = 1';
    }

    query += ' ORDER BY name';

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      site_id: row.site_id,
      slug: row.slug,
      name: row.name,
      version: row.version,
      is_active: row.is_active === 1,
      author: row.author,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async deletePlugin(siteId: string, slug: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare('DELETE FROM plugins WHERE site_id = ? AND slug = ?')
      .run(siteId, slug);
  }

  async deletePlugins(siteId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare('DELETE FROM plugins WHERE site_id = ?')
      .run(siteId);
  }

  // ===== Theme Operations =====

  async upsertTheme(theme: Omit<Theme, 'id'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO themes (site_id, slug, name, version, is_active, author, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, slug) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        is_active = excluded.is_active,
        author = excluded.author,
        updated_at = excluded.updated_at
      RETURNING id
    `);

    const result = stmt.get(
      theme.site_id,
      theme.slug,
      theme.name,
      theme.version ?? null,
      theme.is_active ? 1 : 0,
      theme.author ?? null,
      theme.created_at,
      theme.updated_at
    ) as { id: number };

    return result.id;
  }

  async getThemes(siteId: string): Promise<Theme[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db
      .prepare('SELECT * FROM themes WHERE site_id = ?')
      .all(siteId) as Theme[];

    return rows.map((row) => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));
  }

  async getTheme(siteId: string, slug: string): Promise<Theme | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db
      .prepare('SELECT * FROM themes WHERE site_id = ? AND slug = ?')
      .get(siteId, slug) as Theme | undefined;

    if (!row) return null;

    return {
      ...row,
      is_active: Boolean(row.is_active),
    };
  }

  async deleteTheme(siteId: string, slug: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare('DELETE FROM themes WHERE site_id = ? AND slug = ?')
      .run(siteId, slug);
  }

  async deleteThemes(siteId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare('DELETE FROM themes WHERE site_id = ?')
      .run(siteId);
  }

  // ===== User Operations =====

  async upsertUser(user: Omit<User, 'id'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO users (site_id, user_id, username, email, roles, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, user_id) DO UPDATE SET
        username = excluded.username,
        email = excluded.email,
        roles = excluded.roles,
        updated_at = excluded.updated_at
      RETURNING id
    `);

    const result = stmt.get(
      user.site_id,
      user.user_id,
      user.username,
      user.email ?? null,
      user.roles,
      user.created_at,
      user.updated_at
    ) as { id: number };

    return result.id;
  }

  async deleteUser(siteId: string, userId: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare('DELETE FROM users WHERE site_id = ? AND user_id = ?')
      .run(siteId, userId);
  }

  // ===== Relationship Operations =====

  async createRelationship(rel: Omit<Relationship, 'id'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db
      .prepare(`
        INSERT INTO relationships (site_id, from_type, from_id, to_type, to_id, relationship_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `)
      .get(
        rel.site_id,
        rel.from_type,
        rel.from_id,
        rel.to_type,
        rel.to_id,
        rel.relationship_type,
        rel.created_at
      ) as { id: number };

    return result.id;
  }

  async getRelationships(
    siteId: string,
    fromType: 'content' | 'plugin' | 'user',
    fromId: number,
    options?: { relationship_type?: string }
  ): Promise<Relationship[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT * FROM relationships WHERE site_id = ? AND from_type = ? AND from_id = ?';
    const params: any[] = [siteId, fromType, fromId];

    if (options?.relationship_type) {
      query += ' AND relationship_type = ?';
      params.push(options.relationship_type);
    }

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      site_id: row.site_id,
      from_type: row.from_type,
      from_id: row.from_id,
      to_type: row.to_type,
      to_id: row.to_id,
      relationship_type: row.relationship_type,
      created_at: row.created_at,
    }));
  }

  // ===== Statistics =====

  async getStats(): Promise<GraphStats> {
    if (!this.db) throw new Error('Database not initialized');

    const contentCount = this.db.prepare('SELECT COUNT(*) as count FROM content').get() as { count: number };
    const pluginCount = this.db.prepare('SELECT COUNT(*) as count FROM plugins').get() as { count: number };
    const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const relCount = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number };

    // Get database file size
    let storageSize = 0;
    if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
      storageSize = fs.statSync(this.dbPath).size;
    }

    return {
      total_content: contentCount.count,
      total_plugins: pluginCount.count,
      total_users: userCount.count,
      total_relationships: relCount.count,
      storage_size_bytes: storageSize,
    };
  }

  async getSiteStats(siteId: string): Promise<GraphStats> {
    if (!this.db) throw new Error('Database not initialized');

    const contentCount = this.db
      .prepare('SELECT COUNT(*) as count FROM content WHERE site_id = ?')
      .get(siteId) as { count: number };

    const pluginCount = this.db
      .prepare('SELECT COUNT(*) as count FROM plugins WHERE site_id = ?')
      .get(siteId) as { count: number };

    const userCount = this.db
      .prepare('SELECT COUNT(*) as count FROM users WHERE site_id = ?')
      .get(siteId) as { count: number };

    const relCount = this.db
      .prepare('SELECT COUNT(*) as count FROM relationships WHERE site_id = ?')
      .get(siteId) as { count: number };

    return {
      total_content: contentCount.count,
      total_plugins: pluginCount.count,
      total_users: userCount.count,
      total_relationships: relCount.count,
      storage_size_bytes: 0, // Not site-specific
    };
  }

  // ===== Event Queue Queries (Sprint 1) =====

  /**
   * Get recent events from event_queue with optional filtering
   */
  async getRecentEvents(options?: {
    limit?: number;
    filter?: EventType;
    status?: 'pending' | 'processed' | 'failed';
    siteId?: string;
  }): Promise<EventQueueEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const limit = options?.limit ?? 50;
    const params: any[] = [];
    let query = 'SELECT * FROM event_queue WHERE 1=1';

    if (options?.filter) {
      query += ' AND event_type = ?';
      params.push(options.filter);
    }

    if (options?.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    if (options?.siteId) {
      query += ' AND site_id = ?';
      params.push(options.siteId);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      site_id: row.site_id,
      event_type: row.event_type,
      payload: JSON.parse(row.payload),
      status: row.status,
      created_at: row.created_at,
      processed_at: row.processed_at,
      error: row.error,
      retry_count: row.retry_count,
    }));
  }

  /**
   * Get event statistics for dashboard
   */
  async getEventStats(timeRange?: {
    startTimestamp?: number;
    endTimestamp?: number;
  }): Promise<EventStatsData> {
    if (!this.db) throw new Error('Database not initialized');

    // Total events
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM event_queue').get() as { count: number };

    // Pending and failed
    const pendingRow = this.db.prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ?').get('pending') as { count: number };
    const failedRow = this.db.prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ?').get('failed') as { count: number };

    // Today and yesterday
    const now = Date.now();
    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);
    const yesterdayEnd = todayStart;

    const todayRow = this.db
      .prepare('SELECT COUNT(*) as count FROM event_queue WHERE created_at >= ?')
      .get(todayStart) as { count: number };

    const yesterdayRow = this.db
      .prepare('SELECT COUNT(*) as count FROM event_queue WHERE created_at >= ? AND created_at < ?')
      .get(yesterdayStart, yesterdayEnd) as { count: number };

    // Group by type
    const byTypeRows = this.db
      .prepare('SELECT event_type, COUNT(*) as count FROM event_queue GROUP BY event_type')
      .all() as Array<{ event_type: EventType; count: number }>;

    const byType: Record<EventType, number> = {} as any;
    for (const row of byTypeRows) {
      byType[row.event_type] = row.count;
    }

    return {
      total: totalRow.count,
      today: todayRow.count,
      yesterday: yesterdayRow.count,
      pending: pendingRow.count,
      failed: failedRow.count,
      by_type: byType,
    };
  }

  // ===== Cleanup =====

  async cleanupOldData(retentionDays: number): Promise<{ sites: number; content: number; events: number }> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    // Delete old processed events from event_queue
    const deletedEventsResult = this.db
      .prepare('DELETE FROM event_queue WHERE status = ? AND created_at < ?')
      .run('processed', cutoffTime);
    const deletedEvents = deletedEventsResult.changes;

    // Only delete inactive sites
    const deletedSites = this.db
      .prepare('DELETE FROM sites WHERE is_active = 0 AND updated_at < ? RETURNING id')
      .all(cutoffTime) as Array<{ id: string }>;

    const siteIds = deletedSites.map(s => s.id);

    // Delete related content
    let deletedContent = 0;
    for (const siteId of siteIds) {
      const result = this.db
        .prepare('DELETE FROM content WHERE site_id = ?')
        .run(siteId);
      deletedContent += result.changes;

      // Also delete plugins, users, and relationships
      this.db.prepare('DELETE FROM plugins WHERE site_id = ?').run(siteId);
      this.db.prepare('DELETE FROM users WHERE site_id = ?').run(siteId);
      this.db.prepare('DELETE FROM relationships WHERE site_id = ?').run(siteId);
    }

    return {
      sites: deletedSites.length,
      content: deletedContent,
      events: deletedEvents,
    };
  }

  /**
   * Get storage health metrics
   */
  async getStorageHealth(vectorDbPath: string): Promise<StorageHealthData> {
    if (!this.db) throw new Error('Database not initialized');

    // Graph DB stats
    const eventCountRow = this.db.prepare('SELECT COUNT(*) as count FROM event_queue').get() as { count: number };
    
    const oldestRow = this.db.prepare('SELECT MIN(created_at) as oldest FROM event_queue').get() as { oldest: number | null };
    const newestRow = this.db.prepare('SELECT MAX(created_at) as newest FROM event_queue').get() as { newest: number | null };

    const pendingRow = this.db.prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ?').get('pending') as { count: number };
    const failedRow = this.db.prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ?').get('failed') as { count: number };

    // Get graph DB file size
    let graphDbSize = 0;
    if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
      graphDbSize = fs.statSync(this.dbPath).size;
    }

    // Get vector DB directory size
    let vectorDbSize = 0;
    let vectorTableCount = 0;
    if (fs.existsSync(vectorDbPath)) {
      const getDirectorySize = (dirPath: string): number => {
        let size = 0;
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            size += getDirectorySize(filePath);
            if (file.startsWith('site_')) vectorTableCount++;
          } else {
            size += stats.size;
          }
        }
        return size;
      };
      vectorDbSize = getDirectorySize(vectorDbPath);
    }

    return {
      graph_db: {
        size_bytes: graphDbSize,
        path: this.dbPath,
        event_count: eventCountRow.count,
        oldest_event: oldestRow.oldest,
        newest_event: newestRow.newest,
      },
      vector_db: {
        size_bytes: vectorDbSize,
        path: vectorDbPath,
        table_count: vectorTableCount,
      },
      pending_events: pendingRow.count,
      failed_events: failedRow.count,
    };
  }

  /**
   * Detect issues requiring attention
   */
  async detectIssues(): Promise<IssueData[]> {
    if (!this.db) throw new Error('Database not initialized');

    const issues: IssueData[] = [];

    // Check for failed events
    const failedRow = this.db.prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ?').get('failed') as { count: number };
    if (failedRow.count > 0) {
      issues.push({
        id: 'failed_events',
        type: 'failed_events',
        severity: 'error',
        title: `${failedRow.count} Failed Event${failedRow.count > 1 ? 's' : ''}`,
        description: 'Events failed to process and may need retry',
        count: failedRow.count,
      });
    }

    // Check for stale sites (not synced in 7+ days)
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const staleSitesRows = this.db
      .prepare('SELECT COUNT(*) as count FROM sites WHERE is_active = 1 AND last_sync_at IS NOT NULL AND last_sync_at < ?')
      .get(sevenDaysAgo) as { count: number };

    if (staleSitesRows.count > 0) {
      issues.push({
        id: 'stale_sites',
        type: 'stale_sites',
        severity: 'warning',
        title: `${staleSitesRows.count} Stale Site${staleSitesRows.count > 1 ? 's' : ''}`,
        description: 'Sites not synced in over 7 days',
        count: staleSitesRows.count,
      });
    }

    return issues;
  }

  /**
   * Search plugins by name or slug across all sites
   */
  async searchPlugins(query: string): Promise<Array<{
    siteId: string;
    siteName: string;
    type: 'plugin';
    title: string;
    excerpt: string;
    metadata: Record<string, any>;
    score: number;
    lastUpdated: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const lowerQuery = query.toLowerCase();

    const rows = this.db.prepare(`
      SELECT p.*, s.name as site_name
      FROM plugins p
      JOIN sites s ON p.site_id = s.id
      WHERE LOWER(p.name) LIKE ? OR LOWER(p.slug) LIKE ?
      ORDER BY p.updated_at DESC
      LIMIT 50
    `).all(`%${lowerQuery}%`, `%${lowerQuery}%`) as any[];

    return rows.map(row => ({
      siteId: row.site_id,
      siteName: row.site_name,
      type: 'plugin' as const,
      title: row.name,
      excerpt: `${row.slug} • Version ${row.version || 'unknown'} • ${row.is_active ? 'Active' : 'Inactive'}`,
      metadata: {
        slug: row.slug,
        version: row.version,
        is_active: row.is_active,
        author: row.author,
      },
      score: this.calculateTextScore(lowerQuery, row.name.toLowerCase(), row.slug.toLowerCase()),
      lastUpdated: row.updated_at,
    }));
  }

  /**
   * Search themes by name or slug across all sites
   * Note: Themes not currently tracked in GraphService, return empty for now
   */
  async searchThemes(query: string): Promise<Array<{
    siteId: string;
    siteName: string;
    type: 'theme';
    title: string;
    excerpt: string;
    metadata: Record<string, any>;
    score: number;
    lastUpdated: number;
  }>> {
    // Themes not yet tracked in graph database
    // Return empty array for now
    return [];
  }

  /**
   * Search users by username or email across all sites
   */
  async searchUsers(query: string): Promise<Array<{
    siteId: string;
    siteName: string;
    type: 'user';
    title: string;
    excerpt: string;
    metadata: Record<string, any>;
    score: number;
    lastUpdated: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const lowerQuery = query.toLowerCase();

    const rows = this.db.prepare(`
      SELECT u.*, s.name as site_name
      FROM users u
      JOIN sites s ON u.site_id = s.id
      WHERE LOWER(u.username) LIKE ? OR LOWER(u.email) LIKE ?
      ORDER BY u.updated_at DESC
      LIMIT 50
    `).all(`%${lowerQuery}%`, `%${lowerQuery}%`) as any[];

    return rows.map(row => ({
      siteId: row.site_id,
      siteName: row.site_name,
      type: 'user' as const,
      title: row.username,
      excerpt: `${row.email || 'No email'} • ${row.roles || 'No roles'}`,
      metadata: {
        user_id: row.user_id,
        username: row.username,
        email: row.email,
        roles: row.roles,
      },
      score: this.calculateTextScore(lowerQuery, row.username.toLowerCase(), row.email?.toLowerCase() || ''),
      lastUpdated: row.updated_at,
    }));
  }

  /**
   * Get plugins for a specific site
   * (Wrapper around existing listPlugins for consistency)
   */
  async getPlugins(siteId: string): Promise<Plugin[]> {
    return this.listPlugins(siteId);
  }

  /**
   * Get recent content for a site (last N days)
   */
  async getRecentContent(siteId: string, days: number): Promise<Content[]> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    const rows = this.db.prepare(`
      SELECT * FROM content
      WHERE site_id = ? AND updated_at > ?
      ORDER BY updated_at DESC
    `).all(siteId, cutoffTime) as Content[];

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Site usage (bandwidth / visits / storage)
  // ---------------------------------------------------------------------------

  /**
   * Upsert a usage record for one site + period combination.
   * @param siteId   Graph site id (e.g. "wpe-abc123")
   * @param period   "YYYY-MM" string
   * @param data     Raw CAPI response object — parsed for known fields,
   *                 stored verbatim as raw_json for future use
   */
  upsertSiteUsage(
    siteId: string,
    period: string,
    data: Record<string, unknown>,
    source = 'wpe-capi',
  ): void {
    if (!this.db) return;

    // Parse known CAPI fields — structure varies; extract what we can
    const visits         = extractNumber(data, ['visits', 'pageviews', 'visitor_count']);
    const bandwidthBytes = extractNumber(data, ['bandwidth', 'bandwidth_bytes', 'transfer_bytes']);
    const storageBytes   = extractNumber(data, ['storage', 'storage_bytes', 'disk_bytes']);

    this.db.prepare(`
      INSERT INTO site_usage (site_id, period, source, visits, bandwidth_bytes, storage_bytes, raw_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (site_id, period, source) DO UPDATE SET
        visits          = excluded.visits,
        bandwidth_bytes = excluded.bandwidth_bytes,
        storage_bytes   = excluded.storage_bytes,
        raw_json        = excluded.raw_json,
        recorded_at     = excluded.recorded_at
    `).run(siteId, period, source, visits, bandwidthBytes, storageBytes, JSON.stringify(data), Date.now());
  }

  /**
   * Get persisted usage for a site, optionally filtered to a specific period.
   * Returns rows ordered by period descending (newest first).
   */
  getSiteUsage(siteId: string, period?: string): Array<{
    siteId: string; period: string; source: string;
    visits: number | null; bandwidthBytes: number | null; storageBytes: number | null;
    recordedAt: number;
  }> {
    if (!this.db) return [];

    const rows = period
      ? this.db.prepare('SELECT * FROM site_usage WHERE site_id = ? AND period = ? ORDER BY period DESC').all(siteId, period)
      : this.db.prepare('SELECT * FROM site_usage WHERE site_id = ? ORDER BY period DESC').all(siteId);

    return (rows as any[]).map((r) => ({
      siteId: r.site_id,
      period: r.period,
      source: r.source,
      visits: r.visits,
      bandwidthBytes: r.bandwidth_bytes,
      storageBytes: r.storage_bytes,
      recordedAt: r.recorded_at,
    }));
  }

  /**
   * Get the most recent persisted usage period for each WPE site.
   * Useful for checking cache freshness before a CAPI call.
   */
  getLatestUsagePeriods(): Map<string, { period: string; recordedAt: number }> {
    if (!this.db) return new Map();

    const rows = this.db.prepare(`
      SELECT site_id, period, MAX(recorded_at) as recorded_at
      FROM site_usage
      GROUP BY site_id
    `).all() as Array<{ site_id: string; period: string; recorded_at: number }>;

    return new Map(rows.map((r) => [r.site_id, { period: r.period, recordedAt: r.recorded_at }]));
  }

  /**
   * Calculate text relevance score (0-1)
   * Higher score for exact matches, lower for partial
   */
  private calculateTextScore(query: string, ...fields: string[]): number {
    let score = 0;

    for (const field of fields) {
      if (field === query) {
        score = Math.max(score, 1.0); // Exact match
      } else if (field.startsWith(query)) {
        score = Math.max(score, 0.8); // Starts with query
      } else if (field.includes(query)) {
        score = Math.max(score, 0.5); // Contains query
      }
    }

    return score;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Try a list of key names (including nested dot-paths) against a data object
 * and return the first numeric value found, or null.
 */
function extractNumber(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    let val: unknown = data;
    for (const part of key.split('.')) {
      val = (val as any)?.[part];
    }
    if (typeof val === 'number') return val;
    if (typeof val === 'string' && !isNaN(Number(val))) return Number(val);
  }
  return null;
}
