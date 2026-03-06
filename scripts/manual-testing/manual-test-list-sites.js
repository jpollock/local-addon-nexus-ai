const fs = require('fs');
const path = require('path');

async function listSites() {
  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));

  const res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'local_list_sites', arguments: {} }, id: 1 })
  });
  const json = await res.json();

  // Handle errors
  if (json.error) {
    console.error('Error:', json.error);
    return;
  }

  // Check structure
  if (!json.result || !json.result.content || !json.result.content[0]) {
    console.error('Unexpected response structure:', JSON.stringify(json, null, 2));
    return;
  }

  console.log(json.result.content[0].text);
}

listSites().catch(console.error);
