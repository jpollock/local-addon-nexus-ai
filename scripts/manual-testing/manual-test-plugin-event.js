const fs = require('fs');
const path = require('path');

async function testPluginEvent() {
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));

  console.log('\n=== Testing Plugin Activation Event ===\n');

  // Step 1: Get current event stats
  console.log('Step 1: Getting current event stats...');
  let res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_event_processor_stats', arguments: {} },
      id: 1
    })
  });
  let json = await res.json();
  const beforeStats = JSON.parse(json.result.content[0].text);
  console.log(`  Total events: ${beforeStats.total_events}`);
  console.log(`  Processed today: ${beforeStats.processed_today}\n`);

  // Step 2: Manually trigger activated_plugin hook using wp_eval
  console.log('Step 2: Triggering activated_plugin hook manually...');
  const phpCode = `
    // Manually fire the activated_plugin hook
    do_action('activated_plugin', 'ai/ai.php', false);
    echo "activated_plugin hook fired for ai/ai.php";
  `;

  res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'wp_eval',
        arguments: {
          site: 'nexus-e2e-test',
          code: phpCode
        }
      },
      id: 2
    })
  });
  json = await res.json();
  console.log(`  Result: ${json.result ? json.result.content[0].text : JSON.stringify(json)}\n`);

  // Step 3: Wait for event processing
  console.log('Step 3: Waiting 3 seconds for event processing...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 4: Check event stats again
  console.log('Step 4: Checking event stats after activation...');
  res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_event_processor_stats', arguments: {} },
      id: 3
    })
  });
  json = await res.json();
  const afterStats = JSON.parse(json.result.content[0].text);
  console.log(`  Total events: ${afterStats.total_events} (+${afterStats.total_events - beforeStats.total_events})`);
  console.log(`  Processed today: ${afterStats.processed_today} (+${afterStats.processed_today - beforeStats.processed_today})\n`);

  // Step 5: Query graph for plugin
  console.log('Step 5: Querying graph for ai plugin...');
  res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_graph_plugin', arguments: { site: 'nexus-e2e-test', slug: 'ai' } },
      id: 4
    })
  });
  json = await res.json();
  const pluginData = JSON.parse(json.result.content[0].text);
  console.log('  Plugin data:', JSON.stringify(pluginData, null, 2));
  console.log();

  // Summary
  if (afterStats.total_events > beforeStats.total_events) {
    console.log('✅ SUCCESS! Plugin activation event was sent and processed!');
    if (pluginData && pluginData.is_active) {
      console.log('✅ Plugin is now in graph database with is_active: true');
    }
  } else {
    console.log('❌ FAILED: No new events were processed');
    console.log('Check WordPress debug.log for hook firing confirmation');
  }
}

testPluginEvent().catch(console.error);
