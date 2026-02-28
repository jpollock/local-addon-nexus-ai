#!/usr/bin/env node
/**
 * Standalone test harness for Nexus AI MCP server.
 *
 * Boots all services outside of Electron/Local, starts the MCP server,
 * and optionally indexes a running site.
 *
 * Usage:
 *   node bin/test-harness.js                         # Start server only
 *   node bin/test-harness.js --index <siteId>        # Index a site then serve
 *   node bin/test-harness.js --index-all             # Index all running sites
 *
 * Requires:
 *   - npm run build     (compile TypeScript first)
 *   - A running Local site (for indexing)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// --------------------------------------------------------------------------
// Resolve paths
// --------------------------------------------------------------------------

const projectRoot = path.join(__dirname, '..');
const libDir = path.join(projectRoot, 'lib');
const modelsDir = path.join(projectRoot, 'models', 'all-MiniLM-L6-v2-quantized');
const vectorDbDir = path.join(projectRoot, '.data', 'vectors');
const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
const sitesJsonPath = path.join(localDataDir, 'sites.json');

// --------------------------------------------------------------------------
// Validate build exists
// --------------------------------------------------------------------------

if (!fs.existsSync(path.join(libDir, 'main', 'vector-store', 'VectorStore.js'))) {
  console.error('Build not found. Run "npm run build" first.');
  process.exit(1);
}

if (!fs.existsSync(path.join(modelsDir, 'model.onnx'))) {
  console.error('ONNX model not found. Run "npm run download-model" first.');
  process.exit(1);
}

// --------------------------------------------------------------------------
// Load compiled modules
// --------------------------------------------------------------------------

const { VectorStore } = require(path.join(libDir, 'main', 'vector-store', 'VectorStore'));
const { EmbeddingService } = require(path.join(libDir, 'main', 'embeddings', 'EmbeddingService'));
const { ContentPipeline } = require(path.join(libDir, 'main', 'content', 'ContentPipeline'));
const { MySQLExtractor } = require(path.join(libDir, 'main', 'content', 'MySQLExtractor'));
const { FileScanner } = require(path.join(libDir, 'main', 'content', 'FileScanner'));
const { IndexRegistry } = require(path.join(libDir, 'main', 'content', 'IndexRegistry'));
const { ToolRegistry } = require(path.join(libDir, 'main', 'mcp', 'tool-registry'));
const { McpServer } = require(path.join(libDir, 'main', 'mcp', 'McpServer'));
const { registerContentTools } = require(path.join(libDir, 'main', 'mcp', 'modules', 'content', 'index'));
const { registerSiteContextTools } = require(path.join(libDir, 'main', 'mcp', 'modules', 'site-context', 'index'));
const { registerOllamaTools } = require(path.join(libDir, 'main', 'mcp', 'modules', 'ollama', 'index'));
const { saveConnectionInfo, deleteConnectionInfo } = require(path.join(libDir, 'main', 'mcp', 'connection-info'));

// --------------------------------------------------------------------------
// Logger
// --------------------------------------------------------------------------

const logger = {
  info: (...args) => console.log('[NexusAI]', ...args),
  error: (...args) => console.error('[NexusAI]', ...args),
};

// --------------------------------------------------------------------------
// Load Local's sites.json to build SiteDataAccessor
// --------------------------------------------------------------------------

function loadSiteData() {
  if (!fs.existsSync(sitesJsonPath)) {
    logger.error(`sites.json not found at ${sitesJsonPath}`);
    logger.error('Is Local installed?');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(sitesJsonPath, 'utf-8'));
  const sites = {};

  for (const [id, data] of Object.entries(raw)) {
    sites[id] = {
      id,
      name: data.name || id,
      path: data.path || '',
      domain: data.domain || '',
      status: data.status || 'unknown',
    };
  }

  return {
    getSite: (id) => sites[id] || null,
    getSites: () => sites,
  };
}

// --------------------------------------------------------------------------
// Registry storage (file-backed for persistence across harness runs)
// --------------------------------------------------------------------------

const registryFilePath = path.join(projectRoot, '.data', 'index-registry.json');

function createFileStorage() {
  return {
    get: (key) => {
      try {
        const data = JSON.parse(fs.readFileSync(registryFilePath, 'utf-8'));
        return data[key] || null;
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      let data = {};
      try {
        data = JSON.parse(fs.readFileSync(registryFilePath, 'utf-8'));
      } catch {
        // Fresh file
      }
      data[key] = value;
      fs.mkdirSync(path.dirname(registryFilePath), { recursive: true });
      fs.writeFileSync(registryFilePath, JSON.stringify(data, null, 2));
    },
  };
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const indexSiteId = args.includes('--index') ? args[args.indexOf('--index') + 1] : null;
  const indexAll = args.includes('--index-all');

  logger.info('Starting standalone test harness...');
  logger.info(`Vector DB: ${vectorDbDir}`);
  logger.info(`Models: ${modelsDir}`);

  // 1. Initialize services
  logger.info('Initializing VectorStore...');
  const vectorStore = new VectorStore(vectorDbDir);
  await vectorStore.initialize();

  logger.info('Initializing EmbeddingService (loading ONNX model)...');
  const embeddingService = new EmbeddingService(modelsDir);
  await embeddingService.initialize();
  logger.info('EmbeddingService ready');

  const fileScanner = new FileScanner();
  const mysqlExtractor = new MySQLExtractor();
  const indexRegistry = new IndexRegistry(createFileStorage());

  const contentPipeline = new ContentPipeline({
    vectorStore,
    embeddingService,
    mysqlExtractor,
    fileScanner,
    indexRegistry,
    onStatusChange: (siteId, status) => {
      if (status.state === 'indexing') {
        logger.info(`  [${siteId}] ${status.message} (${status.progress}%)`);
      }
    },
  });

  // 2. Load site data
  const siteData = loadSiteData();
  const allSites = siteData.getSites();
  logger.info(`Loaded ${Object.keys(allSites).length} sites from Local`);

  // 3. Build NexusServices
  const services = {
    vectorStore,
    embeddingService,
    contentPipeline,
    indexRegistry,
    fileScanner,
    siteData,
    logger,
  };

  // 4. Register MCP tools
  const registry = new ToolRegistry();
  registerContentTools(registry);
  registerSiteContextTools(registry);
  registerOllamaTools(registry);

  logger.info(`Registered tools: ${registry.allToolNames().join(', ')}`);

  // 5. Index sites if requested
  if (indexSiteId) {
    await indexSite(indexSiteId, siteData, contentPipeline);
  }

  if (indexAll) {
    await indexAllRunning(siteData, contentPipeline);
  }

  // 6. Start MCP server
  const server = new McpServer({ services, registry });
  const connectionInfo = await server.start();

  logger.info('');
  logger.info('='.repeat(60));
  logger.info('MCP Server running!');
  logger.info(`  URL:   ${connectionInfo.url}`);
  logger.info(`  Token: ${connectionInfo.authToken.substring(0, 20)}...`);
  logger.info(`  Port:  ${connectionInfo.port}`);
  logger.info(`  Tools: ${connectionInfo.tools.join(', ')}`);
  logger.info('='.repeat(60));
  logger.info('');

  // Save connection info so stdio bridge can find it
  saveConnectionInfo(connectionInfo);
  logger.info(`Connection info saved to: ${path.join(localDataDir, 'nexus-ai-mcp-connection-info.json')}`);
  logger.info('');
  logger.info('Test with curl:');
  logger.info(`  curl -s http://127.0.0.1:${connectionInfo.port}/health`);
  logger.info('');
  logger.info('Test MCP tools/list:');
  logger.info(`  curl -s -X POST http://127.0.0.1:${connectionInfo.port}/mcp/messages \\`);
  logger.info(`    -H "Content-Type: application/json" \\`);
  logger.info(`    -H "Authorization: Bearer ${connectionInfo.authToken}" \\`);
  logger.info(`    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`);
  logger.info('');
  logger.info('Press Ctrl+C to stop');

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('');
    logger.info('Shutting down...');
    deleteConnectionInfo();
    await server.stop();
    await vectorStore.close();
    await embeddingService.close();
    logger.info('Stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function indexSite(siteId, siteData, pipeline) {
  const site = siteData.getSite(siteId);
  if (!site) {
    logger.error(`Site "${siteId}" not found in Local's sites.json`);
    // List available sites
    const all = siteData.getSites();
    logger.info('Available sites:');
    for (const [id, s] of Object.entries(all)) {
      logger.info(`  ${id} -> ${s.name} (${s.path})`);
    }
    return;
  }

  logger.info(`Indexing site: ${site.name} (${siteId})...`);

  const info = {
    siteId: site.id,
    siteName: site.name,
    sitePath: site.path,
    domain: site.domain || undefined,
  };

  try {
    const result = await pipeline.indexSite(info);
    logger.info(`Indexed ${site.name}: ${result.documentsIndexed} docs, ${result.chunksIndexed} chunks in ${result.durationMs}ms`);
    if (result.errors.length > 0) {
      logger.error('Warnings:', result.errors);
    }
  } catch (err) {
    logger.error(`Indexing failed for ${site.name}:`, err.message);
  }
}

async function indexAllRunning(siteData, pipeline) {
  const runDir = path.join(localDataDir, 'run');
  const all = siteData.getSites();
  let indexed = 0;

  for (const [id, site] of Object.entries(all)) {
    const socketPath = path.join(runDir, id, 'mysql', 'mysqld.sock');
    if (fs.existsSync(socketPath)) {
      logger.info(`Found running site: ${site.name} (${id})`);
      await indexSite(id, siteData, pipeline);
      indexed++;
    }
  }

  if (indexed === 0) {
    logger.info('No running sites found with MySQL sockets');
  }
}

main().catch((err) => {
  logger.error('Fatal:', err.message);
  logger.error(err.stack);
  process.exit(1);
});
