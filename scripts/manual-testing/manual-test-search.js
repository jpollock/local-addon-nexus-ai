const fs = require('fs');
const path = require('path');

async function searchContent() {
  const siteName = process.argv[2] || 'the-curated-shelf';
  const query = process.argv[3] || 'Live Event Test';

  const connPath = path.join(process.env.HOME, 'Library/Application Support/Local/nexus-ai-mcp-connection-info.json');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf-8'));

  const res = await fetch(conn.url + '/mcp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.authToken}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'search_site_content',
        arguments: {
          site: siteName,
          query: query,
          limit: 5
        }
      },
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

  console.log(`\n=== Search Results for "${query}" in "${siteName}" ===`);
  console.log(json.result.content[0].text);
  console.log('');
}

searchContent().catch(console.error);
