const fs = require('fs');
const path = require('path');

async function reinstallPlugin() {
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));

  console.log('\n=== Reinstalling nexus-ai-connector plugin ===\n');

  // Step 1: Get site info to find path
  console.log('Step 1: Getting site info...');
  let res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'local_get_site', arguments: { site: 'nexus-e2e-test' } },
      id: 1
    })
  });
  let json = await res.json();

  if (json.error) {
    console.error('Error:', json.error);
    return;
  }

  // Extract site path from response
  const siteInfo = json.result.content[0].text;
  const pathMatch = siteInfo.match(/\*\*Path:\*\* (.+)/);
  if (!pathMatch) {
    console.error('Could not find site path in response:', siteInfo);
    return;
  }

  const sitePath = pathMatch[1].trim();
  const pluginDest = path.join(sitePath, 'app/public/wp-content/plugins/nexus-ai-connector');
  const pluginSource = path.resolve(__dirname, 'lib/wp-plugins/nexus-ai-connector');

  console.log(`Site path: ${sitePath}`);
  console.log(`Plugin source: ${pluginSource}`);
  console.log(`Plugin destination: ${pluginDest}`);

  // Step 2: Copy plugin files
  console.log('\nStep 2: Copying updated plugin files...');
  const { execSync } = require('child_process');

  try {
    // Remove old plugin
    if (fs.existsSync(pluginDest)) {
      console.log('  Removing old plugin files...');
      execSync(`rm -rf "${pluginDest}"`);
    }

    // Copy new plugin
    console.log('  Copying new plugin files...');
    execSync(`cp -r "${pluginSource}" "${pluginDest}"`);

    console.log('  ✅ Plugin files updated!');

    // Step 3: Deactivate and reactivate plugin
    console.log('\nStep 3: Reactivating plugin...');

    // Deactivate
    res = await fetch(conn.url + '/mcp/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'wp_plugin_deactivate', arguments: { site: 'nexus-e2e-test', slug: 'nexus-ai-connector' } },
        id: 2
      })
    });
    json = await res.json();
    console.log('  Deactivated:', json.result ? json.result.content[0].text : 'OK');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Activate
    res = await fetch(conn.url + '/mcp/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'wp_plugin_activate', arguments: { site: 'nexus-e2e-test', slug: 'nexus-ai-connector' } },
        id: 3
      })
    });
    json = await res.json();
    console.log('  Activated:', json.result ? json.result.content[0].text : 'OK');

    console.log('\n✅ Plugin reinstalled successfully!');
    console.log('\nNow test with:');
    console.log('  node manual-test-plugin-event.js');

  } catch (error) {
    console.error('Error copying files:', error.message);
  }
}

reinstallPlugin().catch(console.error);
