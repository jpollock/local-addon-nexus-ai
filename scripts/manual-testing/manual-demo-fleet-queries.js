const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

async function demoFleetQueries() {
  // Open the graph database directly
  const dbPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-knowledge-graph.db');
  const db = new Database(dbPath, { readonly: true });

  console.log('\n=== PLUGIN FLEET INTELLIGENCE ===\n');

  // Query 1: All plugins across all sites
  console.log('1. ALL PLUGINS IN YOUR FLEET:');
  const allPlugins = db.prepare(`
    SELECT
      s.name as site_name,
      p.name as plugin_name,
      p.slug,
      p.version,
      CASE WHEN p.is_active = 1 THEN 'active' ELSE 'inactive' END as status
    FROM plugins p
    JOIN sites s ON p.site_id = s.id
    ORDER BY p.name, s.name
  `).all();

  if (allPlugins.length === 0) {
    console.log('  No plugins found in graph database yet.');
    console.log('  Try activating/deactivating plugins via WordPress admin UI.\n');
  } else {
    allPlugins.forEach(p => {
      console.log(`  - ${p.plugin_name} v${p.version || 'unknown'} on ${p.site_name} [${p.status}]`);
    });
    console.log();
  }

  // Query 2: Plugin distribution
  console.log('2. MOST COMMON PLUGINS:');
  const pluginDist = db.prepare(`
    SELECT
      name,
      COUNT(DISTINCT site_id) as site_count,
      COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_count
    FROM plugins
    GROUP BY slug, name
    ORDER BY site_count DESC
    LIMIT 10
  `).all();

  if (pluginDist.length > 0) {
    pluginDist.forEach(p => {
      console.log(`  ${p.name}: ${p.active_count}/${p.site_count} sites (active/total)`);
    });
  } else {
    console.log('  No plugin data yet.');
  }
  console.log();

  // Query 3: Sites by plugin count
  console.log('3. SITES BY PLUGIN COUNT:');
  const sitePluginCounts = db.prepare(`
    SELECT
      s.name as site_name,
      COUNT(p.id) as total_plugins,
      COUNT(CASE WHEN p.is_active = 1 THEN 1 END) as active_plugins
    FROM sites s
    LEFT JOIN plugins p ON s.id = p.site_id
    WHERE s.is_active = 1
    GROUP BY s.id, s.name
    ORDER BY total_plugins DESC
  `).all();

  if (sitePluginCounts.length > 0) {
    sitePluginCounts.forEach(s => {
      console.log(`  ${s.site_name}: ${s.active_plugins} active, ${s.total_plugins} total`);
    });
  } else {
    console.log('  No sites in graph yet.');
  }
  console.log();

  // Query 4: Recent plugin events
  console.log('4. RECENT PLUGIN EVENTS (Last 10):');
  const recentEvents = db.prepare(`
    SELECT
      event_type,
      created_at,
      payload
    FROM event_queue
    WHERE event_type LIKE 'plugin_%'
    ORDER BY created_at DESC
    LIMIT 10
  `).all();

  if (recentEvents.length > 0) {
    recentEvents.forEach(e => {
      const payload = JSON.parse(e.payload);
      const date = new Date(e.created_at).toLocaleString();
      console.log(`  [${date}] ${e.event_type}: ${payload.name || payload.slug}`);
    });
  } else {
    console.log('  No plugin events yet.');
  }
  console.log();

  // Query 5: Content stats
  console.log('5. CONTENT ACROSS SITES:');
  const contentStats = db.prepare(`
    SELECT
      s.name as site_name,
      COUNT(CASE WHEN c.post_type = 'post' THEN 1 END) as posts,
      COUNT(CASE WHEN c.post_type = 'page' THEN 1 END) as pages,
      COUNT(*) as total_content
    FROM sites s
    LEFT JOIN content c ON s.id = c.site_id
    WHERE s.is_active = 1
    GROUP BY s.id, s.name
    ORDER BY total_content DESC
  `).all();

  if (contentStats.length > 0) {
    contentStats.forEach(s => {
      if (s.total_content > 0) {
        console.log(`  ${s.site_name}: ${s.posts} posts, ${s.pages} pages`);
      }
    });
  } else {
    console.log('  No content tracked yet.');
  }
  console.log();

  // Query 6: Overall stats
  console.log('6. GRAPH DATABASE STATS:');
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sites WHERE is_active = 1) as active_sites,
      (SELECT COUNT(*) FROM content) as total_content,
      (SELECT COUNT(*) FROM plugins) as total_plugins,
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM event_queue WHERE status = 'completed') as events_processed
  `).get();

  console.log(`  Active sites: ${stats.active_sites}`);
  console.log(`  Total content: ${stats.total_content}`);
  console.log(`  Total plugins: ${stats.total_plugins}`);
  console.log(`  Total users: ${stats.total_users}`);
  console.log(`  Events processed: ${stats.events_processed}`);
  console.log();

  db.close();

  console.log('=== WHAT YOU CAN DO NOW ===\n');
  console.log('Via WordPress Admin UI:');
  console.log('  1. Activate/deactivate plugins → Track plugin adoption');
  console.log('  2. Update plugins → Track version distribution');
  console.log('  3. Delete plugins → Track plugin removals');
  console.log('  4. Create users → Track user accounts');
  console.log('  5. Update user roles → Security auditing');
  console.log('  6. Delete users → User lifecycle tracking');
  console.log();
  console.log('Via SQL Queries (see examples above):');
  console.log('  - Find all sites with a specific plugin');
  console.log('  - Track plugin versions across fleet');
  console.log('  - Monitor plugin activation/deactivation trends');
  console.log('  - Audit user accounts and roles');
  console.log('  - Generate compliance reports');
  console.log();
}

demoFleetQueries().catch(console.error);
