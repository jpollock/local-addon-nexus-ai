const { McpClient } = require('./lib/test/e2e/helpers/client.js');
const fs = require('fs');
const path = require('path');

async function checkEvents() {
  // Load connection info
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));

  const client = new McpClient(conn.url, conn.authToken);
  await client.initialize();

  // Check event processor stats
  console.log('\n=== Event Processor Stats ===');
  const stats = await client.callTool('get_event_processor_stats', {});
  console.log(stats.content[0].text);

  // Search for test content
  console.log('\n=== Search Results ===');
  const search = await client.callTool('search_site_content', {
    site: 'nexus-e2e-test',
    query: 'E2E Event Test',
    limit: 5
  });
  console.log(search.content[0].text);
}

checkEvents().catch(console.error);
