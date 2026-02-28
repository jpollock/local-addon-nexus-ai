#!/usr/bin/env node
/**
 * Fleet tools test runner.
 *
 * Exercises all 6 fleet tools directly against IndexRegistry data —
 * no MCP server, no ONNX model, no VectorStore required.
 *
 * Usage:
 *   node bin/test-fleet.js                    # Run against persisted index data
 *   node bin/test-fleet.js --synthetic        # Generate synthetic sites for demo
 *   node bin/test-fleet.js --tool fleet_summary       # Run a single tool
 *   node bin/test-fleet.js --tool compare_sites       # Run with interactive prompts
 *   node bin/test-fleet.js --curl                     # Print curl commands for MCP server
 *
 * Requires:
 *   npm run build
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

// --------------------------------------------------------------------------
// Resolve paths
// --------------------------------------------------------------------------

const projectRoot = path.join(__dirname, '..');
const libDir = path.join(projectRoot, 'lib');
const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
const sitesJsonPath = path.join(localDataDir, 'sites.json');
const registryFilePath = path.join(projectRoot, '.data', 'index-registry.json');
const connectionInfoPath = path.join(localDataDir, 'nexus-ai-mcp-connection-info.json');

// --------------------------------------------------------------------------
// Validate build exists (fleet tools only — no ONNX needed)
// --------------------------------------------------------------------------

if (!fs.existsSync(path.join(libDir, 'main', 'mcp', 'modules', 'fleet', 'index.js'))) {
  console.error('Build not found. Run "npm run build" first.');
  process.exit(1);
}

// --------------------------------------------------------------------------
// Load compiled modules
// --------------------------------------------------------------------------

const { IndexRegistry } = require(path.join(libDir, 'main', 'content', 'IndexRegistry'));
const { ToolRegistry } = require(path.join(libDir, 'main', 'mcp', 'tool-registry'));
const { registerFleetTools } = require(path.join(libDir, 'main', 'mcp', 'modules', 'fleet', 'index'));

// --------------------------------------------------------------------------
// Logger
// --------------------------------------------------------------------------

const logger = {
  info: (...args) => console.log('[Fleet]', ...args),
  error: (...args) => console.error('[Fleet]', ...args),
};

// --------------------------------------------------------------------------
// Site data loader
// --------------------------------------------------------------------------

function loadSiteData() {
  if (!fs.existsSync(sitesJsonPath)) {
    logger.info('sites.json not found — using synthetic data');
    return null;
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
// Registry storage (file-backed, same as test-harness)
// --------------------------------------------------------------------------

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
// Synthetic data generator
// --------------------------------------------------------------------------

function makePlugin(slug, name, version, active = true) {
  return { slug, name, version, isActive: active, description: `${name} plugin` };
}

function makeTheme(slug, name, version, active = false, child = false, parent) {
  return { slug, name, version, isActive: active, isChildTheme: child, parentTheme: parent };
}

function createSyntheticSetup() {
  const sites = {
    'synth-prod': { id: 'synth-prod', name: 'Production Store', path: '/tmp/prod', domain: 'store.local' },
    'synth-staging': { id: 'synth-staging', name: 'Staging Store', path: '/tmp/staging', domain: 'staging.local' },
    'synth-blog': { id: 'synth-blog', name: 'Company Blog', path: '/tmp/blog', domain: 'blog.local' },
    'synth-dev': { id: 'synth-dev', name: 'Dev Sandbox', path: '/tmp/dev', domain: 'dev.local' },
  };

  const siteData = {
    getSite: (id) => sites[id] || null,
    getSites: () => sites,
  };

  // In-memory registry storage for synthetic mode
  const memStore = {};
  const storage = {
    get: (key) => memStore[key] || null,
    set: (key, value) => { memStore[key] = value; },
  };

  const indexRegistry = new IndexRegistry(storage);

  // Production Store — fully loaded WooCommerce site
  indexRegistry.update('synth-prod', {
    siteName: 'Production Store',
    state: 'indexed',
    documentCount: 342,
    chunkCount: 512,
    lastIndexed: Date.now() - 3600000, // 1 hour ago
    durationMs: 4500,
    structure: {
      themes: [
        makeTheme('storefront-child', 'Storefront Child', '1.3.0', true, true, 'storefront'),
        makeTheme('storefront', 'Storefront', '4.5.0'),
        makeTheme('twentytwentyfour', 'Twenty Twenty-Four', '1.2'),
      ],
      plugins: [
        makePlugin('woocommerce', 'WooCommerce', '10.0.4'),
        makePlugin('advanced-custom-fields', 'Advanced Custom Fields', '6.4.3'),
        makePlugin('woocommerce-subscriptions', 'WooCommerce Subscriptions', '6.1.0'),
        makePlugin('yoast-seo', 'Yoast SEO', '24.1'),
        makePlugin('wordfence', 'Wordfence Security', '8.0.2'),
        makePlugin('wp-mail-smtp', 'WP Mail SMTP', '4.1.0'),
      ],
      phpVersion: '8.2',
      wpVersion: '6.9.1',
      isMultisite: false,
      hasWooCommerce: true,
      hasACF: true,
      users: { totalUsers: 12, roleBreakdown: { administrator: 2, shop_manager: 3, customer: 7 }, customRoles: ['shop_manager'] },
      customTables: [
        { name: 'wp_wc_orders', prefix: 'wp_', rowCount: 4521, pluginGuess: 'WooCommerce' },
        { name: 'wp_wc_order_items', prefix: 'wp_', rowCount: 8340, pluginGuess: 'WooCommerce' },
      ],
      restApi: { namespaces: ['wp/v2', 'wc/v3', 'yoast/v1'], customNamespaces: ['wc/v3', 'yoast/v1'], routeCount: 142 },
      permalinks: { structure: '/%postname%/', totalRewriteRules: 87 },
      health: { searchEngineVisibility: false, language: 'en_US', timezone: 'America/New_York', defaultRole: 'customer' },
    },
  });

  // Staging Store — slightly behind production
  indexRegistry.update('synth-staging', {
    siteName: 'Staging Store',
    state: 'indexed',
    documentCount: 310,
    chunkCount: 480,
    lastIndexed: Date.now() - 86400000, // 1 day ago
    durationMs: 3800,
    structure: {
      themes: [
        makeTheme('storefront-child', 'Storefront Child', '1.2.0', true, true, 'storefront'),
        makeTheme('storefront', 'Storefront', '4.5.0'),
      ],
      plugins: [
        makePlugin('woocommerce', 'WooCommerce', '9.8.2'),       // outdated
        makePlugin('advanced-custom-fields', 'Advanced Custom Fields', '6.4.3'),
        makePlugin('woocommerce-subscriptions', 'WooCommerce Subscriptions', '6.0.1'), // outdated
        makePlugin('yoast-seo', 'Yoast SEO', '24.1'),
        makePlugin('wordfence', 'Wordfence Security', '8.0.2'),
        makePlugin('query-monitor', 'Query Monitor', '3.16.4'),  // extra: dev tool
      ],
      phpVersion: '8.2',
      wpVersion: '6.9.1',
      isMultisite: false,
      hasWooCommerce: true,
      hasACF: true,
      users: { totalUsers: 5, roleBreakdown: { administrator: 2, shop_manager: 1, customer: 2 }, customRoles: ['shop_manager'] },
    },
  });

  // Company Blog — different stack
  indexRegistry.update('synth-blog', {
    siteName: 'Company Blog',
    state: 'indexed',
    documentCount: 567,
    chunkCount: 890,
    lastIndexed: Date.now() - 7200000, // 2 hours ago
    durationMs: 6200,
    structure: {
      themes: [
        makeTheme('twentytwentyfive', 'Twenty Twenty-Five', '1.0', true),
      ],
      plugins: [
        makePlugin('advanced-custom-fields', 'Advanced Custom Fields', '6.4.3'),
        makePlugin('yoast-seo', 'Yoast SEO', '24.0'),            // slightly behind
        makePlugin('jetpack', 'Jetpack', '14.0.1'),
        makePlugin('akismet', 'Akismet Anti-spam', '5.3.5'),
        makePlugin('wp-mail-smtp', 'WP Mail SMTP', '4.1.0'),
      ],
      phpVersion: '8.3',
      wpVersion: '6.9.1',
      isMultisite: false,
      hasWooCommerce: false,
      hasACF: true,
      users: { totalUsers: 8, roleBreakdown: { administrator: 1, editor: 3, author: 4 }, customRoles: [] },
    },
  });

  // Dev Sandbox — old everything, stale index
  indexRegistry.update('synth-dev', {
    siteName: 'Dev Sandbox',
    state: 'stale',
    documentCount: 23,
    chunkCount: 23,
    lastIndexed: Date.now() - 604800000, // 1 week ago
    durationMs: 1200,
    structure: {
      themes: [
        makeTheme('twentytwentyfour', 'Twenty Twenty-Four', '1.1', true),
      ],
      plugins: [
        makePlugin('woocommerce', 'WooCommerce', '9.5.0'),       // very outdated
        makePlugin('query-monitor', 'Query Monitor', '3.16.4'),
        makePlugin('debug-bar', 'Debug Bar', '1.1.6'),
      ],
      phpVersion: '8.1',
      wpVersion: '6.8.0',
      isMultisite: false,
      hasWooCommerce: true,
      hasACF: false,
      users: { totalUsers: 2, roleBreakdown: { administrator: 2 }, customRoles: [] },
    },
  });

  return { siteData, indexRegistry };
}

// --------------------------------------------------------------------------
// Tool runner
// --------------------------------------------------------------------------

function buildServices(indexRegistry, siteData) {
  return {
    vectorStore: {},
    embeddingService: {},
    contentPipeline: {},
    indexRegistry,
    fileScanner: {},
    siteData,
    logger,
  };
}

async function runTool(registry, services, toolName, args) {
  console.log('');
  console.log('─'.repeat(70));
  console.log(`  ${toolName}(${JSON.stringify(args)})`);
  console.log('─'.repeat(70));
  console.log('');

  const result = await registry.call(toolName, args, services);
  const text = result.content[0].text;

  if (result.isError) {
    console.error('ERROR:', text);
  } else {
    console.log(text);
  }

  console.log('');
  return result;
}

// --------------------------------------------------------------------------
// Curl command generator
// --------------------------------------------------------------------------

function printCurlCommands() {
  let connInfo;
  try {
    connInfo = JSON.parse(fs.readFileSync(connectionInfoPath, 'utf-8'));
  } catch {
    console.error('No running MCP server found.');
    console.error(`Expected connection info at: ${connectionInfoPath}`);
    console.error('Start the test harness first: node bin/test-harness.js --index-all');
    process.exit(1);
  }

  const base = `http://127.0.0.1:${connInfo.port}/mcp/messages`;
  const headers = `-H "Content-Type: application/json" -H "Authorization: Bearer ${connInfo.authToken}"`;

  function curlCmd(id, toolName, args) {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });
    return `curl -s -X POST ${base} ${headers} -d '${body}' | jq .`;
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('  Fleet Tools — curl commands for running MCP server');
  console.log(`  Server: ${connInfo.url}`);
  console.log('='.repeat(70));
  console.log('');

  console.log('# 1. List all tools (verify fleet tools are registered)');
  console.log(`curl -s -X POST ${base} ${headers} \\`);
  console.log(`  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[] | .name'`);
  console.log('');

  console.log('# 2. Fleet Summary');
  console.log(curlCmd(10, 'fleet_summary', {}));
  console.log('');

  console.log('# 3. Find Sites with Plugin');
  console.log(curlCmd(11, 'find_sites_with_plugin', { plugin: 'woocommerce' }));
  console.log('');

  console.log('# 4. Find Sites with Theme');
  console.log(curlCmd(12, 'find_sites_with_theme', { theme: 'Twenty Twenty' }));
  console.log('');

  console.log('# 5. Find Outdated Sites');
  console.log(curlCmd(13, 'find_outdated_sites', {}));
  console.log('');

  console.log('# 6. Find Outdated Sites (WordPress only)');
  console.log(curlCmd(14, 'find_outdated_sites', { component: 'wordpress' }));
  console.log('');

  // For compare_sites and detect_drift, we need real site names
  const entries = getIndexedSiteNames();
  if (entries.length >= 2) {
    console.log(`# 7. Compare Sites ("${entries[0]}" vs "${entries[1]}")`);
    console.log(curlCmd(15, 'compare_sites', { site_a: entries[0], site_b: entries[1] }));
    console.log('');

    console.log(`# 8. Detect Drift (baseline = "${entries[0]}")`);
    console.log(curlCmd(16, 'detect_drift', { baseline_site: entries[0] }));
    console.log('');
  } else {
    console.log('# 7-8. Compare Sites / Detect Drift — need 2+ indexed sites');
    console.log('#   Index more sites first: node bin/test-harness.js --index-all');
    console.log('');
  }
}

function getIndexedSiteNames() {
  try {
    const data = JSON.parse(fs.readFileSync(registryFilePath, 'utf-8'));
    const registry = data['nexus-ai_index_registry'] || {};
    return Object.values(registry)
      .filter((e) => e.structure)
      .map((e) => e.siteName || e.siteId);
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// Interactive prompt helper
// --------------------------------------------------------------------------

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const useSynthetic = args.includes('--synthetic');
  const singleTool = args.includes('--tool') ? args[args.indexOf('--tool') + 1] : null;
  const curlMode = args.includes('--curl');

  if (curlMode) {
    printCurlCommands();
    return;
  }

  // Set up services
  let indexRegistry, siteData;

  if (useSynthetic) {
    logger.info('Using synthetic site data (4 sites)');
    const synth = createSyntheticSetup();
    indexRegistry = synth.indexRegistry;
    siteData = synth.siteData;
  } else {
    const realSiteData = loadSiteData();
    if (!realSiteData) {
      logger.info('Falling back to synthetic data');
      const synth = createSyntheticSetup();
      indexRegistry = synth.indexRegistry;
      siteData = synth.siteData;
    } else {
      siteData = realSiteData;
      indexRegistry = new IndexRegistry(createFileStorage());
    }
  }

  const registry = new ToolRegistry();
  registerFleetTools(registry);
  const services = buildServices(indexRegistry, siteData);

  logger.info(`Registered fleet tools: ${registry.allToolNames().join(', ')}`);

  const entries = indexRegistry.listAll();
  const withStructure = entries.filter((e) => e.structure);
  logger.info(`Index has ${entries.length} entries (${withStructure.length} with structure data)`);

  if (withStructure.length === 0) {
    logger.error('No indexed sites with structure data.');
    logger.error('Either:');
    logger.error('  1. Run: node bin/test-harness.js --index-all');
    logger.error('  2. Use: node bin/test-fleet.js --synthetic');
    process.exit(1);
  }

  // List indexed sites
  console.log('');
  console.log('Indexed sites:');
  for (const entry of entries) {
    const icon = entry.state === 'indexed' ? '✓' : entry.state === 'stale' ? '⚠' : '✗';
    console.log(`  ${icon} ${entry.siteName || entry.siteId} (${entry.documentCount} docs, ${entry.state})`);
  }

  // Run tools
  if (singleTool) {
    await runSingleTool(registry, services, singleTool, withStructure);
  } else {
    await runAllTools(registry, services, withStructure);
  }
}

async function runSingleTool(registry, services, toolName, entries) {
  const validTools = registry.allToolNames();
  if (!validTools.includes(toolName)) {
    logger.error(`Unknown tool: ${toolName}`);
    logger.error(`Available: ${validTools.join(', ')}`);
    process.exit(1);
  }

  switch (toolName) {
    case 'fleet_summary':
      await runTool(registry, services, 'fleet_summary', {});
      break;

    case 'find_sites_with_plugin': {
      const plugin = await prompt('Plugin name or slug to search: ');
      await runTool(registry, services, 'find_sites_with_plugin', { plugin });
      break;
    }

    case 'find_sites_with_theme': {
      const theme = await prompt('Theme name or slug to search: ');
      await runTool(registry, services, 'find_sites_with_theme', { theme });
      break;
    }

    case 'find_outdated_sites': {
      const component = await prompt('Component (wordpress/php/plugins, or blank for all): ');
      const args = component ? { component } : {};
      await runTool(registry, services, 'find_outdated_sites', args);
      break;
    }

    case 'compare_sites': {
      console.log('Available sites:', entries.map((e) => e.siteName || e.siteId).join(', '));
      const site_a = await prompt('First site name: ');
      const site_b = await prompt('Second site name: ');
      await runTool(registry, services, 'compare_sites', { site_a, site_b });
      break;
    }

    case 'detect_drift': {
      console.log('Available sites:', entries.map((e) => e.siteName || e.siteId).join(', '));
      const baseline = await prompt('Baseline site name: ');
      await runTool(registry, services, 'detect_drift', { baseline_site: baseline });
      break;
    }
  }
}

async function runAllTools(registry, services, entries) {
  const siteNames = entries.map((e) => e.siteName || e.siteId);

  // 1. Fleet Summary
  await runTool(registry, services, 'fleet_summary', {});

  // 2. Find sites with a popular plugin
  await runTool(registry, services, 'find_sites_with_plugin', { plugin: 'woocommerce' });
  await runTool(registry, services, 'find_sites_with_plugin', { plugin: 'yoast' });

  // 3. Find sites with a theme
  await runTool(registry, services, 'find_sites_with_theme', { theme: 'Twenty Twenty' });

  // 4. Outdated sites — all components
  await runTool(registry, services, 'find_outdated_sites', {});

  // 5. Outdated sites — plugins only
  await runTool(registry, services, 'find_outdated_sites', { component: 'plugins' });

  // 6. Compare first two sites
  if (siteNames.length >= 2) {
    await runTool(registry, services, 'compare_sites', {
      site_a: siteNames[0],
      site_b: siteNames[1],
    });
  }

  // 7. Drift from first site
  if (siteNames.length >= 2) {
    await runTool(registry, services, 'detect_drift', {
      baseline_site: siteNames[0],
    });
  }

  // 8. Edge cases
  await runTool(registry, services, 'find_sites_with_plugin', { plugin: 'nonexistent-plugin-xyz' });

  // Summary
  console.log('='.repeat(70));
  console.log('  All fleet tools executed successfully');
  console.log('='.repeat(70));
}

main().catch((err) => {
  logger.error('Fatal:', err.message);
  logger.error(err.stack);
  process.exit(1);
});
