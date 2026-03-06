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
  User,
  Relationship,
  GraphStats,
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
CREATE INDEX IF NOT EXISTS idx_event_site_created ON event_queue(site_id, created_at);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  wp_version TEXT,
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

  constructor(dbPath: string) {
    this.dbPath = dbPath;
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
      INSERT INTO sites (id, name, domain, wp_version, last_sync_at, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        domain = excluded.domain,
        wp_version = excluded.wp_version,
        last_sync_at = excluded.last_sync_at,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      site.id,
      site.name,
      site.domain,
      site.wp_version ?? null,
      site.last_sync_at ?? null,
      site.is_active ? 1 : 0,
      site.created_at,
      site.updated_at
    );
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
      last_sync_at: row.last_sync_at,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async listSites(options?: { active_only?: boolean }): Promise<Site[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT * FROM sites';
    if (options?.active_only) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY name';

    const rows = this.db.prepare(query).all() as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      wp_version: row.wp_version,
      last_sync_at: row.last_sync_at,
      is_active: row.is_active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
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

    const row = this.db
      .prepare('SELECT * FROM content WHERE site_id = ? AND post_id = ?')
      .get(siteId, postId) as any;

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

    let query = 'SELECT * FROM content WHERE site_id = ?';
    const params: any[] = [siteId];

    if (options?.post_type) {
      query += ' AND post_type = ?';
      params.push(options.post_type);
    }

    query += ' ORDER BY updated_at DESC';

    const rows = this.db.prepare(query).all(...params) as any[];

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

  // ===== Cleanup =====

  async cleanupOldData(retentionDays: number): Promise<{ sites: number; content: number }> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

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
    };
  }
}
