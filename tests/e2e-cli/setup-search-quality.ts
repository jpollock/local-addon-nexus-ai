/**
 * Minimal global setup for search quality e2e tests.
 *
 * Only checks that Local is running and the CLI can reach it.
 * Does NOT create or start nexus-e2e-cli-test-site — the search
 * quality tests manage their own fixture sites via ensureIndexed().
 */

import * as path from 'path';
import * as fs from 'fs';

function loadGraphQLConnectionInfo(): { url: string; port: number; authToken: string } | null {
  const searchPaths = [
    path.join(process.env.HOME || '', 'Library', 'Application Support', 'Local', 'nexus-ai-mcp-connection-info.json'),
    path.join(process.env.HOME || '', 'Library', 'Application Support', 'Local', 'addons', 'nexus-ai', 'nexus-ai-mcp-connection-info.json'),
  ];
  for (const p of searchPaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const info = JSON.parse(raw);
        if (info.graphqlUrl || info.url) {
          return {
            url: info.graphqlUrl || info.url,
            port: info.port || 4000,
            authToken: info.authToken || '',
          };
        }
      }
    } catch { /* try next path */ }
  }
  // Fallback: try the default GraphQL port
  return { url: 'http://127.0.0.1:4000/graphql', port: 4000, authToken: '' };
}

async function testCliConnectivity(): Promise<boolean> {
  const { spawn } = require('child_process');
  const cliBin = path.resolve(__dirname, '..', '..', 'bin', 'nexus.js');
  return new Promise(resolve => {
    const child = spawn(cliBin, ['sites', 'list', '--json'], { timeout: 15000 });
    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('close', (code: number) => resolve(code === 0 && stdout.includes('local')));
    child.on('error', () => resolve(false));
    setTimeout(() => { child.kill(); resolve(false); }, 15000);
  });
}

export default async function globalSetup() {
  console.log('\n[Search Quality Setup] Checking Local connectivity...');

  const info = loadGraphQLConnectionInfo();
  if (info) {
    process.env.CLI_E2E_GRAPHQL_URL = info.url;
    process.env.CLI_E2E_GRAPHQL_PORT = String(info.port);
    process.env.CLI_E2E_GRAPHQL_TOKEN = info.authToken;
    console.log(`[Search Quality Setup] GraphQL: ${info.url}`);
  }

  const connected = await testCliConnectivity();
  if (!connected) {
    console.warn('[Search Quality Setup] ⚠ Cannot reach Local — all tests will skip gracefully');
  } else {
    console.log('[Search Quality Setup] ✅ Local is running');
  }

  console.log('[Search Quality Setup] Ready — fixture sites started per test suite\n');
}
