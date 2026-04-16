/**
 * Tests for GraphService - knowledge graph storage and queries
 */
import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';
import {
  Site,
  Content,
  Plugin,
  User,
  Relationship,
} from '../../../src/main/events/types';

describe('GraphService', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-graph-${Date.now()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();
  });

  afterEach(async () => {
    await graphService.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('initialization', () => {
    it('should create database file on initialize', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should create all required tables', async () => {
      const tables = await graphService.listTables();
      expect(tables).toContain('sites');
      expect(tables).toContain('content');
      expect(tables).toContain('plugins');
      expect(tables).toContain('users');
      expect(tables).toContain('relationships');
      expect(tables).toContain('event_queue');
    });

    it('should be idempotent (multiple initializations safe)', async () => {
      await graphService.initialize();
      await graphService.initialize();
      const tables = await graphService.listTables();
      expect(tables.length).toBeGreaterThan(0);
    });
  });

  describe('site operations', () => {
    const testSite: Site = {
      id: 'site-123',
      name: 'Test Site',
      domain: 'test.local',
      wp_version: '6.4.0',
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    it('should upsert a new site', async () => {
      await graphService.upsertSite(testSite);
      const site = await graphService.getSite('site-123');

      expect(site).not.toBeNull();
      expect(site?.name).toBe('Test Site');
      expect(site?.domain).toBe('test.local');
      expect(site?.wp_version).toBe('6.4.0');
    });

    it('should update existing site on upsert', async () => {
      await graphService.upsertSite(testSite);

      const updated = { ...testSite, name: 'Updated Site', updated_at: Date.now() };
      await graphService.upsertSite(updated);

      const site = await graphService.getSite('site-123');
      expect(site?.name).toBe('Updated Site');
    });

    it('should return null for non-existent site', async () => {
      const site = await graphService.getSite('nonexistent');
      expect(site).toBeNull();
    });

    it('should list all sites', async () => {
      await graphService.upsertSite(testSite);
      await graphService.upsertSite({ ...testSite, id: 'site-456', name: 'Site 2' });

      const sites = await graphService.listSites();
      expect(sites.length).toBe(2);
      expect(sites.map(s => s.id)).toContain('site-123');
      expect(sites.map(s => s.id)).toContain('site-456');
    });

    it('should filter inactive sites when requested', async () => {
      await graphService.upsertSite(testSite);
      await graphService.upsertSite({ ...testSite, id: 'site-456', is_active: false });

      const active = await graphService.listSites({ active_only: true });
      expect(active.length).toBe(1);
      expect(active[0].id).toBe('site-123');
    });
  });

  describe('content operations', () => {
    const testContent: Omit<Content, 'id'> = {
      site_id: 'site-123',
      post_id: 42,
      post_type: 'post',
      title: 'Test Post',
      status: 'publish',
      author_id: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'site-123',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    it('should upsert content', async () => {
      const id = await graphService.upsertContent(testContent);
      expect(id).toBeGreaterThan(0);

      const content = await graphService.getContent('site-123', 42);
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Test Post');
    });

    it('should update existing content on upsert', async () => {
      await graphService.upsertContent(testContent);

      const updated = { ...testContent, title: 'Updated Post' };
      await graphService.upsertContent(updated);

      const content = await graphService.getContent('site-123', 42);
      expect(content?.title).toBe('Updated Post');
    });

    it('should list content for a site', async () => {
      await graphService.upsertContent(testContent);
      await graphService.upsertContent({ ...testContent, post_id: 43, title: 'Post 2' });

      const content = await graphService.listContent('site-123');
      expect(content.length).toBe(2);
    });

    it('should filter content by post_type', async () => {
      await graphService.upsertContent(testContent);
      await graphService.upsertContent({ ...testContent, post_id: 43, post_type: 'page', title: 'Page' });

      const posts = await graphService.listContent('site-123', { post_type: 'post' });
      expect(posts.length).toBe(1);
      expect(posts[0].post_type).toBe('post');
    });

    it('should delete content', async () => {
      await graphService.upsertContent(testContent);
      await graphService.deleteContent('site-123', 42);

      const content = await graphService.getContent('site-123', 42);
      expect(content).toBeNull();
    });
  });

  describe('plugin operations', () => {
    const testPlugin: Omit<Plugin, 'id'> = {
      site_id: 'site-123',
      slug: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      is_active: true,
      author: 'Test Author',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'site-123',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    it('should upsert plugin', async () => {
      const id = await graphService.upsertPlugin(testPlugin);
      expect(id).toBeGreaterThan(0);

      const plugin = await graphService.getPlugin('site-123', 'test-plugin');
      expect(plugin).not.toBeNull();
      expect(plugin?.name).toBe('Test Plugin');
    });

    it('should list plugins for a site', async () => {
      await graphService.upsertPlugin(testPlugin);
      await graphService.upsertPlugin({ ...testPlugin, slug: 'plugin-2', name: 'Plugin 2' });

      const plugins = await graphService.listPlugins('site-123');
      expect(plugins.length).toBe(2);
    });

    it('should filter active plugins', async () => {
      await graphService.upsertPlugin(testPlugin);
      await graphService.upsertPlugin({ ...testPlugin, slug: 'plugin-2', is_active: false });

      const active = await graphService.listPlugins('site-123', { active_only: true });
      expect(active.length).toBe(1);
      expect(active[0].slug).toBe('test-plugin');
    });
  });

  describe('relationship operations', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'site-123',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      await graphService.upsertContent({
        site_id: 'site-123',
        post_id: 42,
        post_type: 'post',
        title: 'Test Post',
        status: 'publish',
        author_id: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      await graphService.upsertUser({
        site_id: 'site-123',
        user_id: 1,
        username: 'admin',
        email: 'admin@test.local',
        roles: JSON.stringify(['administrator']),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    it('should create relationship', async () => {
      const id = await graphService.createRelationship({
        site_id: 'site-123',
        from_type: 'content',
        from_id: 1,  // content.id
        to_type: 'user',
        to_id: 1,    // user.id
        relationship_type: 'authored_by',
        created_at: Date.now(),
      });

      expect(id).toBeGreaterThan(0);
    });

    it('should find relationships from an entity', async () => {
      await graphService.createRelationship({
        site_id: 'site-123',
        from_type: 'content',
        from_id: 1,
        to_type: 'user',
        to_id: 1,
        relationship_type: 'authored_by',
        created_at: Date.now(),
      });

      const rels = await graphService.getRelationships('site-123', 'content', 1);
      expect(rels.length).toBe(1);
      expect(rels[0].relationship_type).toBe('authored_by');
    });

    it('should filter relationships by type', async () => {
      await graphService.createRelationship({
        site_id: 'site-123',
        from_type: 'content',
        from_id: 1,
        to_type: 'user',
        to_id: 1,
        relationship_type: 'authored_by',
        created_at: Date.now(),
      });

      await graphService.createRelationship({
        site_id: 'site-123',
        from_type: 'content',
        from_id: 1,
        to_type: 'user',
        to_id: 1,
        relationship_type: 'edited_by',
        created_at: Date.now(),
      });

      const authored = await graphService.getRelationships('site-123', 'content', 1, {
        relationship_type: 'authored_by',
      });

      expect(authored.length).toBe(1);
      expect(authored[0].relationship_type).toBe('authored_by');
    });
  });

  describe('statistics', () => {
    it('should return graph statistics', async () => {
      await graphService.upsertSite({
        id: 'site-123',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      await graphService.upsertContent({
        site_id: 'site-123',
        post_id: 42,
        post_type: 'post',
        title: 'Test Post',
        status: 'publish',
        author_id: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      const stats = await graphService.getStats();
      expect(stats.total_content).toBe(1);
      expect(stats.storage_size_bytes).toBeGreaterThan(0);
    });

    it('should return per-site statistics', async () => {
      await graphService.upsertSite({
        id: 'site-123',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      await graphService.upsertContent({
        site_id: 'site-123',
        post_id: 42,
        post_type: 'post',
        title: 'Post 1',
        status: 'publish',
        author_id: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      await graphService.upsertContent({
        site_id: 'site-123',
        post_id: 43,
        post_type: 'post',
        title: 'Post 2',
        status: 'publish',
        author_id: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      const stats = await graphService.getSiteStats('site-123');
      expect(stats.total_content).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should delete old sites and related data', async () => {
      const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago

      await graphService.upsertSite({
        id: 'old-site',
        name: 'Old Site',
        domain: 'old.local',
        is_active: false,
        created_at: oldTimestamp,
        updated_at: oldTimestamp,
      });

      await graphService.upsertContent({
        site_id: 'old-site',
        post_id: 1,
        post_type: 'post',
        title: 'Old Post',
        status: 'publish',
        author_id: 1,
        created_at: oldTimestamp,
        updated_at: oldTimestamp,
      });

      const deleted = await graphService.cleanupOldData(30); // 30 days retention
      expect(deleted.sites).toBe(1);
      expect(deleted.content).toBe(1);

      const site = await graphService.getSite('old-site');
      expect(site).toBeNull();
    });

    it('should not delete active sites', async () => {
      const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000);

      await graphService.upsertSite({
        id: 'old-active-site',
        name: 'Old Active Site',
        domain: 'old.local',
        is_active: true,  // Still active
        created_at: oldTimestamp,
        updated_at: oldTimestamp,
      });

      const deleted = await graphService.cleanupOldData(30);
      expect(deleted.sites).toBe(0);

      const site = await graphService.getSite('old-active-site');
      expect(site).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // site_usage — bandwidth / visits / storage persistence
  // ---------------------------------------------------------------------------

  describe('site usage (upsertSiteUsage / getSiteUsage / getLatestUsagePeriods)', () => {
    const PERIOD = '2026-04';
    const SITE_ID = 'wpe-test-install';

    it('should insert a usage record', () => {
      graphService.upsertSiteUsage(SITE_ID, PERIOD, { visits: 4521 });
      const rows = graphService.getSiteUsage(SITE_ID, PERIOD);
      expect(rows).toHaveLength(1);
      expect(rows[0].siteId).toBe(SITE_ID);
      expect(rows[0].period).toBe(PERIOD);
      expect(rows[0].source).toBe('wpe-capi');
      expect(rows[0].recordedAt).toBeGreaterThan(0);
    });

    it('should upsert — overwrite existing record for same site+period+source', () => {
      graphService.upsertSiteUsage(SITE_ID, PERIOD, { visits: 100 });
      graphService.upsertSiteUsage(SITE_ID, PERIOD, { visits: 200 });
      const rows = graphService.getSiteUsage(SITE_ID, PERIOD);
      expect(rows).toHaveLength(1);
    });

    it('should extract known numeric fields from CAPI response', () => {
      graphService.upsertSiteUsage(SITE_ID, PERIOD, {
        visits: 4521,
        bandwidth: 1234567890,
        storage: 987654321,
      });
      const row = graphService.getSiteUsage(SITE_ID, PERIOD)[0];
      expect(row.visits).toBe(4521);
      expect(row.bandwidthBytes).toBe(1234567890);
      expect(row.storageBytes).toBe(987654321);
    });

    it('should store null for unknown field names', () => {
      graphService.upsertSiteUsage(SITE_ID, PERIOD, { some_unknown_field: 'hello' });
      const row = graphService.getSiteUsage(SITE_ID, PERIOD)[0];
      expect(row.visits).toBeNull();
      expect(row.bandwidthBytes).toBeNull();
    });

    it('getSiteUsage returns all periods when no filter', () => {
      graphService.upsertSiteUsage(SITE_ID, '2026-03', { visits: 100 });
      graphService.upsertSiteUsage(SITE_ID, '2026-04', { visits: 200 });
      expect(graphService.getSiteUsage(SITE_ID)).toHaveLength(2);
    });

    it('getSiteUsage filters to matching period', () => {
      graphService.upsertSiteUsage(SITE_ID, '2026-03', { visits: 100 });
      graphService.upsertSiteUsage(SITE_ID, '2026-04', { visits: 200 });
      const rows = graphService.getSiteUsage(SITE_ID, '2026-03');
      expect(rows).toHaveLength(1);
      expect(rows[0].period).toBe('2026-03');
    });

    it('getSiteUsage returns empty array for unknown site', () => {
      expect(graphService.getSiteUsage('unknown')).toHaveLength(0);
    });

    it('getLatestUsagePeriods returns most recent period per site', () => {
      graphService.upsertSiteUsage('site-a', '2026-03', { visits: 100 });
      graphService.upsertSiteUsage('site-a', '2026-04', { visits: 200 });
      graphService.upsertSiteUsage('site-b', '2026-02', { visits: 50 });

      const latest = graphService.getLatestUsagePeriods();
      expect(latest.size).toBe(2);
      expect(latest.get('site-a')?.period).toBe('2026-04');
      expect(latest.get('site-b')?.period).toBe('2026-02');
    });

    it('getLatestUsagePeriods returns empty map when no data', () => {
      expect(graphService.getLatestUsagePeriods().size).toBe(0);
    });
  });
});
