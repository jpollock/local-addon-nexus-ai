const fs = require('fs');
const path = require('path');

async function triggerProcessing() {
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));

  console.log('Creating a test post to trigger event processing...');
  
  const res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'wp_post_create',
        arguments: {
          site: 'nexus-e2e-test',
          title: 'Processing Test ' + Date.now(),
          content: 'This post triggers event processing for all pending events',
          status: 'publish'
        }
      },
      id: 1
    })
  });

  const json = await res.json();
  
  if (json.error) {
    console.error('Error:', json.error);
    return;
  }

  console.log('Post created successfully!');
  console.log('Waiting 5 seconds for processing...\n');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Check stats
  const statsRes = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_event_processor_stats', arguments: {} },
      id: 2
    })
  });

  const statsJson = await statsRes.json();
  const stats = JSON.parse(statsJson.result.content[0].text);
  
  console.log('=== Event Processor Stats ===');
  console.log(`Total events: ${stats.total_events}`);
  console.log(`Pending: ${stats.pending_events}`);
  console.log(`Failed: ${stats.failed_events}`);
  console.log(`Processed today: ${stats.processed_today}`);
}

triggerProcessing().catch(console.error);
