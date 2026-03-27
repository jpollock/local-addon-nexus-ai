#!/usr/bin/env node
/**
 * Diagnostic: Check what vector tables exist and what site IDs they contain
 */
const lancedb = require('@lancedb/lancedb');
const path = require('path');
const os = require('os');

async function diagnose() {
  const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'vectors');

  console.log(`Connecting to LanceDB at: ${dbPath}\n`);

  try {
    const db = await lancedb.connect(dbPath);
    const tables = await db.tableNames();

    console.log(`Found ${tables.length} tables:`);
    tables.forEach(t => console.log(`  - ${t}`));
    console.log();

    // For each table, show sample data
    for (const tableName of tables) {
      if (!tableName.startsWith('site_')) continue;

      console.log(`\n=== Table: ${tableName} ===`);
      const table = await db.openTable(tableName);
      const count = await table.countRows();
      console.log(`Row count: ${count}`);

      if (count > 0) {
        // Get a few sample rows to show structure
        const samples = await table
          .search(new Array(384).fill(0))
          .limit(3)
          .toArray();

        console.log('\nSample documents:');
        samples.forEach((row, i) => {
          console.log(`\n  ${i + 1}. id: ${row.id}`);
          console.log(`     siteId: ${row.siteId}`);
          console.log(`     postId: ${row.postId}`);
          console.log(`     title: ${row.title}`);
          console.log(`     postType: ${row.postType}`);
        });
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Vector database not found. No sites have been indexed yet.');
    } else {
      throw err;
    }
  }
}

diagnose().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
