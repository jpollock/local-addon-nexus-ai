/**
 * CLI E2E Test Setup
 *
 * Verifies production Local is running with Nexus AI addon enabled.
 * Does NOT start Local - user must have it running before running tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface GraphQLConnectionInfo {
  port: number;
  authToken: string;
  url: string;
  subscriptionUrl: string;
}

function getGraphQLConnectionInfoPath(): string {
  const platform = os.platform();
  let dataDir: string;

  if (platform === 'darwin') {
    dataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  } else if (platform === 'win32') {
    dataDir = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Local');
  } else {
    dataDir = path.join(os.homedir(), '.config', 'Local');
  }

  return path.join(dataDir, 'graphql-connection-info.json');
}

function loadGraphQLConnectionInfo(): GraphQLConnectionInfo | null {
  const filePath = getGraphQLConnectionInfoPath();
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function testGraphQLConnection(info: GraphQLConnectionInfo): Promise<boolean> {
  try {
    const response = await fetch(info.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${info.authToken}`,
      },
      body: JSON.stringify({ query: '{ __typename }' }),
    });

    // Accept any response that reached the server (even auth errors mean server is up)
    return response.status < 600;
  } catch {
    return false;
  }
}

async function testCliConnectivity(): Promise<boolean> {
  // Use the nexus CLI itself as the connectivity probe — it handles token discovery
  const { spawn } = require('child_process');
  const CLI_BIN = require('path').resolve(__dirname, '..', '..', 'bin', 'nexus.js');
  return new Promise((resolve) => {
    const child = spawn(CLI_BIN, ['sites', 'list', '--json'], { timeout: 10000 });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('close', (code: number) => {
      // If we got JSON back (even empty), server is up
      try { JSON.parse(stdout); resolve(true); } catch { resolve(code === 0); }
    });
    child.on('error', () => resolve(false));
    setTimeout(() => { child.kill(); resolve(false); }, 10000);
  });
}

export default async function globalSetup() {
  console.log('\n[CLI E2E Setup] Checking production Local...');

  // Check for GraphQL connection info
  const connectionInfo = loadGraphQLConnectionInfo();
  if (!connectionInfo) {
    console.error('\n❌ GraphQL connection info not found.');
    console.error('   Expected: ' + getGraphQLConnectionInfoPath());
    console.error('\n   This means production Local is not running.');
    console.error('   Please start Local from /Applications/Local.app and try again.\n');
    throw new Error('Production Local is not running');
  }

  console.log(`[CLI E2E Setup] Found GraphQL connection: ${connectionInfo.url}`);

  // Verify via the CLI binary itself — it handles stale tokens/ports internally
  const cliConnected = await testCliConnectivity();
  if (!cliConnected) {
    console.error('\n❌ nexus CLI cannot reach Local GraphQL server.');
    console.error('   Ensure Local is running with the Nexus AI addon enabled.\n');
    throw new Error('Cannot connect to Local GraphQL');
  }
  console.log('[CLI E2E Setup] ✅ CLI connectivity verified');

  console.log('[CLI E2E Setup] ✅ Connected to Local GraphQL');

  // Store connection info for tests
  process.env.CLI_E2E_GRAPHQL_URL = connectionInfo.url;
  process.env.CLI_E2E_GRAPHQL_PORT = String(connectionInfo.port);
  process.env.CLI_E2E_GRAPHQL_TOKEN = connectionInfo.authToken;

  console.log('[CLI E2E Setup] ✅ Ready to run CLI tests\n');
}
