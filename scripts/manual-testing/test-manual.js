#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Simple MCP client
class SimpleClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.requestId = 1;
  }

  async callTool(name, args) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: this.requestId++
      })
    });

    const json = await res.json();
    
    if (json.error) {
      throw new Error(`MCP Error: ${json.error.message || json.error}`);
    }

    return json.result;
  }
}

async function main() {
  // Load connection info
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));
  
  const client = new SimpleClient(conn.url, conn.authToken);
  const command = process.argv[2];

  if (!command || command === 'help') {
    console.log(`
📝 Manual Testing Helper

Commands:
  node test-manual.js list                        # List all sites
  node test-manual.js stats                       # Event processor stats
  node test-manual.js search <site> <query>       # Search content
  
Examples:
  node test-manual.js list
  node test-manual.js stats
  node test-manual.js search nexus-e2e-test "Hello world"
  node test-manual.js search "the-curated-shelf" "Live Event Test"
`);
    return;
  }

  try {
    switch (command) {
      case 'list': {
        const result = await client.callTool('local_list_sites', {});
        console.log(result.content[0].text);
        break;
      }

      case 'stats': {
        const result = await client.callTool('get_event_processor_stats', {});
        console.log('\n📊 Event Processor Stats');
        console.log('─'.repeat(40));
        const stats = JSON.parse(result.content[0].text);
        console.log(`Total events:     ${stats.total_events}`);
        console.log(`Pending:          ${stats.pending_events}`);
        console.log(`Failed:           ${stats.failed_events}`);
        console.log(`Processed today:  ${stats.processed_today}`);
        console.log('');
        break;
      }

      case 'search': {
        const site = process.argv[3];
        const query = process.argv[4];

        if (!site || !query) {
          console.error('❌ Usage: node test-manual.js search <site> <query>');
          console.error('   Example: node test-manual.js search nexus-e2e-test "Hello"');
          process.exit(1);
        }

        const result = await client.callTool('search_site_content', { site, query, limit: 5 });
        console.log(`\n🔍 Search: "${query}" in "${site}"`);
        console.log('─'.repeat(50));
        console.log(result.content[0].text);
        console.log('');
        break;
      }

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('   Run "node test-manual.js help" for usage');
        process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
