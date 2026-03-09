#!/usr/bin/env node
/**
 * Quick test: Check what's in the vector store
 */

const path = require('path');
const os = require('os');

async function checkVectorStore() {
  console.log('=== Checking Vector Store ===\n');
  
  const { VectorStore } = require('./lib/main/vector-store/VectorStore');
  
  const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const vectorDbDir = path.join(localDataDir, 'nexus-ai', 'vectors');
  
  console.log('Vector DB path:', vectorDbDir);
  console.log('\nInitializing...');
  
  const vectorStore = new VectorStore(vectorDbDir);
  await vectorStore.initialize();
  
  const db = vectorStore['db'];
  const tableNames = await db.tableNames();
  
  console.log(`\n✅ Found ${tableNames.length} indexed site tables:\n`);
  
  for (const name of tableNames.slice(0, 20)) {
    const table = await db.openTable(name);
    const count = await table.countRows();
    console.log(`   ${name}: ${count} rows`);
  }
  
  if (tableNames.length > 20) {
    console.log(`   ... and ${tableNames.length - 20} more tables`);
  }
  
  if (tableNames.length === 0) {
    console.log('   ❌ No tables found - sites not indexed yet');
  }
}

checkVectorStore().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
