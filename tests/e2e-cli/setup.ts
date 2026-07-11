/**
 * CLI E2E Test Setup
 *
 * Verifies production Local is running with Nexus AI addon enabled.
 * Does NOT create sites — fixture sites must exist before running tests.
 * Only starts sites that are halted.
 *
 * Required fixture sites (create once manually):
 *   nexus sites create nexus-e2e-cli-test-site@local  # used by 20-chat-agent export test
 *   nexus sites create nexus-e2e-test@local            # used by 15,17,18,19,22,23
 *
 * Tests skip gracefully when a fixture site is absent.
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

async function testCliConnectivity(): Promise<boolean> {
  const { spawn } = require('child_process');
  const CLI_BIN = require('path').resolve(__dirname, '..', '..', 'bin', 'nexus.js');
  return new Promise((resolve) => {
    const child = spawn(CLI_BIN, ['sites', 'list', '--json'], { timeout: 10000 });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('close', (code: number) => {
      try { JSON.parse(stdout); resolve(true); } catch { resolve(code === 0); }
    });
    child.on('error', () => resolve(false));
    setTimeout(() => { child.kill(); resolve(false); }, 10000);
  });
}

const CLI_BIN_PATH = require('path').resolve(__dirname, '..', '..', 'bin', 'nexus.js');

async function runCliSetup(args: string[], timeoutMs = 60_000): Promise<{ stdout: string; exitCode: number }> {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const child = spawn(CLI_BIN_PATH, args, { timeout: timeoutMs });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('close', (code: number) => resolve({ stdout, exitCode: code ?? 1 }));
    child.on('error', () => resolve({ stdout, exitCode: 1 }));
    setTimeout(() => { child.kill(); resolve({ stdout, exitCode: 1 }); }, timeoutMs);
  });
}

/** Parse the JSON site list. Output is {"local": [...], "wpe": [...]} — find { before [ to avoid
 *  slicing mid-object (slicing at [ gives "[...], wpe: [...]}" which fails JSON.parse). */
function parseSiteList(stdout: string): any[] {
  const bracketIdx = stdout.indexOf('[');
  const braceIdx = stdout.indexOf('{');
  let start: number;
  if (bracketIdx === -1) start = braceIdx;
  else if (braceIdx === -1) start = bracketIdx;
  else start = Math.min(bracketIdx, braceIdx);
  if (start === -1) return [];
  try {
    const parsed = JSON.parse(stdout.slice(start));
    return Array.isArray(parsed) ? parsed : (parsed?.local ?? []);
  } catch {
    return [];
  }
}

/**
 * Start a fixture site if it exists but is halted.
 * NEVER creates — this avoids race conditions when tests run concurrently.
 */
async function ensureFixtureSiteRunning(siteName: string, envKey?: string): Promise<void> {
  const listResult = await runCliSetup(['sites', 'list', '--json']);
  const sites = parseSiteList(listResult.stdout);

  // With potential duplicate sites (e.g. from a previous failed run), find the best one:
  // prefer a running instance over an errored one.
  const matching = sites.filter((s: any) => s.name === siteName);
  const site = matching.find((s: any) => s.status === 'running')
    ?? matching.find((s: any) => s.status !== 'wordpress_install_error')
    ?? matching[0];

  if (!site) {
    console.warn(`[CLI E2E Setup] ⚠ ${siteName} not found — create it first:`);
    console.warn(`[CLI E2E Setup]   nexus sites create ${siteName}@local`);
    console.warn(`[CLI E2E Setup]   nexus sites start ${siteName}@local`);
    return; // non-fatal — tests that need it will skip
  }

  if (site.status === 'wordpress_install_error') {
    console.warn(`[CLI E2E Setup] ⚠ ${siteName} has wordpress_install_error — delete it in Local UI and recreate.`);
    return;
  }

  if (site.status !== 'running') {
    console.log(`[CLI E2E Setup] Starting ${siteName}...`);
    const startResult = await runCliSetup(['sites', 'start', `${siteName}@local`], 120_000);
    if (startResult.exitCode !== 0) {
      console.warn(`[CLI E2E Setup] ⚠ Could not start ${siteName} — tests that need it will skip.`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(`[CLI E2E Setup] ✅ ${siteName} started`);
  } else {
    console.log(`[CLI E2E Setup] ✅ ${siteName} already running`);
  }

  // Validate WP-CLI can boot WordPress (requires DB access) — a site pulled from WPE
  // may have MU plugins that crash WP bootstrap in a local environment.
  // wp option-get requires a full DB-connected WP bootstrap (unlike wp core version
  // which only reads version.php from disk). Only set the env key if this passes.
  if (envKey) {
    const wpCliCheck = await runCliSetup(['wp', 'option-get', `${siteName}@local`, 'blogname'], 20_000);
    if (wpCliCheck.exitCode !== 0) {
      console.warn(`[CLI E2E Setup] ⚠ ${siteName} is running but WP-CLI cannot boot WordPress (exit ${wpCliCheck.exitCode}).`);
      console.warn(`[CLI E2E Setup]   This site may be a WPE pull with incompatible MU plugins or a broken DB.`);
      console.warn(`[CLI E2E Setup]   WP-CLI tests will be skipped. To fix: delete ${siteName} and recreate as a fresh local site.`);
      // Mark this site as broken so getRunningSite() won't fall back to it either.
      const prev = process.env.CLI_E2E_WP_BROKEN_SITES ?? '';
      process.env.CLI_E2E_WP_BROKEN_SITES = prev ? `${prev},${siteName}` : siteName;
      return;
    }
    process.env[envKey] = siteName;
  }
}

export default async function globalSetup() {
  console.log('\n[CLI E2E Setup] Checking production Local...');

  const connectionInfo = loadGraphQLConnectionInfo();
  if (!connectionInfo) {
    console.error('\n❌ GraphQL connection info not found.');
    console.error('   Expected: ' + getGraphQLConnectionInfoPath());
    console.error('\n   This means production Local is not running.');
    console.error('   Please start Local from /Applications/Local.app and try again.\n');
    throw new Error('Production Local is not running');
  }

  console.log(`[CLI E2E Setup] Found GraphQL connection: ${connectionInfo.url}`);

  const cliConnected = await testCliConnectivity();
  if (!cliConnected) {
    console.error('\n❌ nexus CLI cannot reach Local GraphQL server.');
    console.error('   Ensure Local is running with the Nexus AI addon enabled.\n');
    throw new Error('Cannot connect to Local GraphQL');
  }
  console.log('[CLI E2E Setup] ✅ CLI connectivity verified');

  process.env.CLI_E2E_GRAPHQL_URL = connectionInfo.url;
  process.env.CLI_E2E_GRAPHQL_PORT = String(connectionInfo.port);
  process.env.CLI_E2E_GRAPHQL_TOKEN = connectionInfo.authToken;

  // Start fixture sites if halted — never create them (avoids parallel-run disasters).
  await ensureFixtureSiteRunning('nexus-e2e-cli-test-site', 'CLI_E2E_TEST_SITE');
  await ensureFixtureSiteRunning('nexus-e2e-test');

  console.log('[CLI E2E Setup] ✅ Ready to run CLI tests\n');
}
