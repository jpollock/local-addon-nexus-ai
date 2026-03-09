#!/usr/bin/env node
/**
 * Direct test of SearchService to bypass UI
 * Run from addon root: node test-search.js
 */

const path = require('path');
const os = require('os');

async function testSearch() {
  console.log('=== Testing Search Service ===\n');
  
  // Import the compiled modules
  const { VectorStore } = require('./lib/main/vector-store/VectorStore');
  const { IndexRegistry } = require('./lib/main/content/IndexRegistry');
  const { SearchService } = require('./lib/main/search/SearchService');
  const { EmbeddingService } = require('./lib/main/embedding/EmbeddingService');
  
  // Setup paths
  const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const vectorDbDir = path.join(localDataDir, 'nexus-ai', 'vectors');
  const modelsDir = path.resolve(__dirname, 'models', 'all-MiniLM-L6-v2-quantized');
  
  // Mock storage for registry - but load from actual Local storage
  // We can't easily access userData from outside Electron, so we'll use a mock
  const storage = {
    _data: {},
    get(key) { return this._data[key]; },
    set(key, val) { this._data[key] = val; }
  };
  
  // Initialize services
  console.log('1. Initializing VectorStore...');
  const vectorStore = new VectorStore(vectorDbDir);
  await vectorStore.initialize();
  
  console.log('2. Initializing IndexRegistry...');
  const indexRegistry = new IndexRegistry(storage);
  
  console.log('3. Checking index registry...');
  const allEntries = indexRegistry.listAll();
  console.log(`   Total entries: ${allEntries.length}`);
  console.log(`   ⚠️  Note: Using empty mock storage - registry is empty`);
  console.log(`   ⚠️  This test shows vector store is accessible, but can't see indexed sites`);
  
  console.log('\n4. Initializing EmbeddingService...');
  const embeddingService = new EmbeddingService(modelsDir);
  await embeddingService.initialize();
  
  // Mock graph service (minimal)
  const graphService = {
    async searchPlugins() { return []; },
    async searchThemes() { return []; },
    async searchUsers() { return []; },
  };
  
  console.log('5. Initializing SearchService...');
  const searchService = new SearchService(vectorStore, graphService, embeddingService, indexRegistry);
  
  console.log('\n6. Testing search with query "hello"...');
  const results = await searchService.searchFleet('hello', {}, { limit: 10, vectorSearch: true });
  
  console.log('\n=== RESULTS ===');
  console.log('Total:', results.total);
  console.log('Results count:', results.results.length);
  
  if (results.results.length > 0) {
    console.log('\nFirst 3 results:');
    results.results.slice(0, 3).forEach((r, i) => {
      console.log(`${i+1}. ${r.title} (${r.type}) - Score: ${(r.score * 100).toFixed(1)}%`);
      console.log(`   Site: ${r.siteName}`);
      if (r.excerpt) console.log(`   Excerpt: ${r.excerpt.slice(0, 100)}...`);
    });
  } else {
    console.log('❌ No results found (expected - registry is empty in this test).');
  }
  
  console.log('\n7. Checking what tables exist in vector store...');
  const db = vectorStore['db'];
  if (db) {
    const tableNames = await db.tableNames();
    console.log(`   Found ${tableNames.length} tables in vector DB:`);
    tableNames.slice(0, 10).forEach(name => console.log(`   - ${name}`));
    if (tableNames.length > 10) {
      console.log(`   ... and ${tableNames.length - 10} more`);
    }
  }
  
  console.log('\n=== Test Complete ===');
  console.log('✅ Services initialized successfully');
  console.log('✅ Vector store accessible');
  console.log(`✅ Found ${(await db.tableNames()).length} indexed site tables`);
  console.log('⚠️  Registry empty (expected - can\'t access Electron userData from Node)');
}

testSearch().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
