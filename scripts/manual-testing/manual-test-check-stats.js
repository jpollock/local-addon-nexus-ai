const fs = require('fs');
const path = require('path');

async function checkStats() {
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));

  const res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_event_processor_stats', arguments: {} },
      id: 1
    })
  });
  const json = await res.json();

  if (json.error) {
    console.error('MCP Error:', json.error);
    return;
  }

  if (!json.result || !json.result.content || !json.result.content[0]) {
    console.error('Unexpected response structure:', JSON.stringify(json, null, 2));
    return;
  }

  console.log('\n=== Event Processor Stats ===');
  const stats = JSON.parse(json.result.content[0].text);
  console.log(`Total events: ${stats.total_events}`);
  console.log(`Pending: ${stats.pending_events}`);
  console.log(`Failed: ${stats.failed_events}`);
  console.log(`Processed today: ${stats.processed_today}\n`);
}

checkStats().catch(console.error);
