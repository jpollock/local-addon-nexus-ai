#!/usr/bin/env node
/**
 * stdio ↔ HTTP bridge for MCP protocol.
 *
 * Reads JSON-RPC messages from stdin, forwards them to the Nexus AI MCP server
 * over HTTP, and writes responses to stdout.
 *
 * Usage in ~/.claude.json:
 *   {
 *     "mcpServers": {
 *       "local-nexus-ai": {
 *         "command": "node",
 *         "args": ["/path/to/local-addon-nexus-ai/bin/mcp-stdio.js"]
 *       }
 *     }
 *   }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

function getConnectionInfoPath() {
  const platform = os.platform();
  let dir;
  if (platform === 'darwin') {
    dir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  } else if (platform === 'win32') {
    dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Local');
  } else {
    dir = path.join(os.homedir(), '.config', 'Local');
  }
  return path.join(dir, 'nexus-ai-mcp-connection-info.json');
}

function loadConnectionInfo() {
  const filePath = getConnectionInfoPath();
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function sendRequest(url, token, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url + '/mcp/messages');
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        timeout: 120000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const info = loadConnectionInfo();
  if (!info) {
    process.stderr.write(
      'Nexus AI MCP server is not running. Start Local with the Nexus AI addon enabled.\n' +
        `Looked for: ${getConnectionInfoPath()}\n`,
    );
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const request = JSON.parse(line);
      const response = await sendRequest(info.url, info.authToken, request);
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch (err) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: err.message },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
