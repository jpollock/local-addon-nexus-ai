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

    return response.ok;
  } catch {
    return false;
  }
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

  // Test connection
  const connected = await testGraphQLConnection(connectionInfo);
  if (!connected) {
    console.error('\n❌ Could not connect to Local GraphQL server.');
    console.error(`   URL: ${connectionInfo.url}`);
    console.error('\n   Local may be running but GraphQL is not responding.');
    console.error('   Try restarting Local and running tests again.\n');
    throw new Error('Cannot connect to Local GraphQL');
  }

  console.log('[CLI E2E Setup] ✅ Connected to Local GraphQL');

  // Store connection info for tests
  process.env.CLI_E2E_GRAPHQL_URL = connectionInfo.url;
  process.env.CLI_E2E_GRAPHQL_PORT = String(connectionInfo.port);
  process.env.CLI_E2E_GRAPHQL_TOKEN = connectionInfo.authToken;

  console.log('[CLI E2E Setup] ✅ Ready to run CLI tests\n');
}
