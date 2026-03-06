/**
 * Manual testing helper - uses the E2E test infrastructure
 */
const { McpClient } = require('./tests/e2e/helpers/client');
const fs = require('fs');
const path = require('path');

async function loadConnectionInfo() {
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  return JSON.parse(fs.readFileSync(connPath, 'utf-8'));
}

async function main() {
  const conn = await loadConnectionInfo();
  const client = new McpClient(conn.url, conn.authToken);
  await client.initialize();

  const command = process.argv[2];

  if (!command || command === 'help') {
    console.log(`
Manual Testing Commands:

  node manual-test.js list              # List all sites
  node manual-test.js stats             # Show event processor stats
  node manual-test.js search <site> <query>   # Search for content
  node manual-test.js health            # Check HTTP server health

Examples:
  node manual-test.js list
  node manual-test.js stats
  node manual-test.js search "nexus-e2e-test" "Hello"
  node manual-test.js search "the-curated-shelf" "Live Event Test"
`);
    return;
  }

  switch (command) {
    case 'list': {
      const result = await client.callTool('local_list_sites', {});
      console.log(result.content[0].text);
      break;
    }

    case 'stats': {
      const result = await client.callTool('get_event_processor_stats', {});
      console.log('\n=== Event Processor Stats ===');
      const stats = JSON.parse(result.content[0].text);
      console.log(`Total events: ${stats.total_events}`);
      console.log(`Pending: ${stats.pending_events}`);
      console.log(`Failed: ${stats.failed_events}`);
      console.log(`Processed today: ${stats.processed_today}\n`);
      break;
    }

    case 'search': {
      const site = process.argv[3];
      const query = process.argv[4];

      if (!site || !query) {
        console.error('Usage: node manual-test.js search <site> <query>');
        console.error('Example: node manual-test.js search "nexus-e2e-test" "Hello world"');
        process.exit(1);
      }

      const result = await client.callTool('search_site_content', {
        site: site,
        query: query,
        limit: 5
      });

      console.log(`\n=== Search Results for "${query}" in "${site}" ===`);
      console.log(result.content[0].text);
      console.log('');
      break;
    }

    case 'health': {
      try {
        await client.health();
        console.log('✅ MCP server is healthy');
        console.log(`   URL: ${conn.url}`);
      } catch (err) {
        console.error('❌ MCP server health check failed:', err.message);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "node manual-test.js help" for usage');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
