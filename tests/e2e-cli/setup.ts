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

const E2E_SITE_NAME = 'nexus-e2e-cli-test-site';
const CLI_BIN_PATH = require('path').resolve(__dirname, '..', '..', 'bin', 'nexus.js');

async function runCliSetup(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const child = spawn(CLI_BIN_PATH, args, { timeout: 60000 });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('close', (code: number) => resolve({ stdout, exitCode: code ?? 1 }));
    child.on('error', () => resolve({ stdout, exitCode: 1 }));
    setTimeout(() => { child.kill(); resolve({ stdout, exitCode: 1 }); }, 60000);
  });
}

async function ensureE2ESiteRunning(): Promise<void> {
  console.log(`[CLI E2E Setup] Ensuring ${E2E_SITE_NAME} is running...`);

  const listResult = await runCliSetup(['sites', 'list', '--json']);
  let sites: any[] = [];
  try { sites = JSON.parse(listResult.stdout)?.local ?? []; } catch { /* ignore */ }

  const site = sites.find((s: any) => s.name === E2E_SITE_NAME);

  if (!site) {
    console.log(`[CLI E2E Setup] ${E2E_SITE_NAME} not found — creating it...`);
    const createResult = await runCliSetup(['sites', 'create', E2E_SITE_NAME]);
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create ${E2E_SITE_NAME}: ${createResult.stdout}`);
    }
    console.log(`[CLI E2E Setup] ✅ Created ${E2E_SITE_NAME}`);
  }

  if (!site || site.status !== 'running') {
    console.log(`[CLI E2E Setup] Starting ${E2E_SITE_NAME}...`);
    const startResult = await runCliSetup(['sites', 'start', `${E2E_SITE_NAME}@local`]);
    if (startResult.exitCode !== 0) {
      throw new Error(`Failed to start ${E2E_SITE_NAME}: ${startResult.stdout}`);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(`[CLI E2E Setup] ✅ ${E2E_SITE_NAME} started`);
  } else {
    console.log(`[CLI E2E Setup] ✅ ${E2E_SITE_NAME} already running`);
  }

  process.env.CLI_E2E_TEST_SITE = E2E_SITE_NAME;
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

  // Ensure the dedicated e2e test site is running
  await ensureE2ESiteRunning();

  console.log('[CLI E2E Setup] ✅ Ready to run CLI tests\n');
}
