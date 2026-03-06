#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const connectionInfoPath = path.join(
  process.env.HOME,
  'Library/Application Support/Local/nexus-ai-mcp-connection-info.json'
);

const connectionInfo = JSON.parse(fs.readFileSync(connectionInfoPath, 'utf8'));

function callTool(toolName, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(connectionInfo.url);
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params || {},
      },
    };

    const reqBody = JSON.stringify(request);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: '/mcp/messages',  // MCP endpoint
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': reqBody.length,
        'Authorization': `Bearer ${connectionInfo.authToken}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            console.error('MCP Error:', JSON.stringify(response.error, null, 2));
            reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else if (!response.result) {
            console.error('No result in response:', data);
            reject(new Error('No result in response'));
          } else {
            resolve(response.result);
          }
        } catch (err) {
          console.error('Failed to parse response:', data);
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(reqBody);
    req.end();
  });
}

async function initialize() {
  const url = new URL(connectionInfo.url);
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'manual-test', version: '1.0.0' },
    },
  };

  const reqBody = JSON.stringify(request);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: '/mcp/messages',  // MCP endpoint
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': reqBody.length,
        'Authorization': `Bearer ${connectionInfo.authToken}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            console.error('Initialize error:', JSON.stringify(response.error, null, 2));
            reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else if (!response.result) {
            console.error('No result in initialize response:', data);
            reject(new Error('No result in initialize response'));
          } else {
            resolve(response.result);
          }
        } catch (err) {
          console.error('Failed to parse initialize response:', data);
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(reqBody);
    req.end();
  });
}

async function main() {
  console.log('🔌 Initializing MCP connection...\n');
  await initialize();
  console.log('✅ Initialized\n');

  console.log('📋 Listing all Local sites...\n');

  const result = await callTool('local_list_sites');
  console.log(result.content[0].text);

  console.log('\n📋 Listing indexed sites...\n');
  const indexedResult = await callTool('list_indexed_sites');
  console.log(indexedResult.content[0].text);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
