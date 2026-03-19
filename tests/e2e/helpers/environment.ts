import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChildProcess, spawn } from 'child_process';
import { McpClient, McpToolResult } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionInfo {
  url: string;
  authToken: string;
  port: number;
  version: string;
  tools: string[];
}

export interface SiteInfo {
  id: string;
  name: string;
  domain: string;
}

export interface E2EEnvironment {
  connectionInfo: ConnectionInfo;
  runningSites: SiteInfo[];
  haltedSites: SiteInfo[];
  testSiteId: string | null;
  testSiteName: string | null;
  capiAvailable: boolean;
  ollamaAvailable: boolean;
  availableTools: string[];
  createdTestSite: boolean; // true if we created a temporary site
}

// ---------------------------------------------------------------------------
// Connection Info Discovery
// ---------------------------------------------------------------------------

const MCP_CONNECTION_INFO_FILE = 'nexus-ai-mcp-connection-info.json';

function getConnectionInfoPath(): string {
  const platform = os.platform();
  let dataDir: string;
  if (platform === 'darwin') {
    dataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  } else if (platform === 'win32') {
    dataDir = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Local');
  } else {
    dataDir = path.join(os.homedir(), '.config', 'Local');
  }
  return path.join(dataDir, MCP_CONNECTION_INFO_FILE);
}

export function loadConnectionInfo(): ConnectionInfo | null {
  const filePath = getConnectionInfoPath();
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as ConnectionInfo;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Environment Discovery
// ---------------------------------------------------------------------------

/**
 * Parse the text output from local_list_sites into structured site info.
 *
 * Actual output format from the tool:
 *   ## Local Sites (2 total, 1 running)
 *   ### Running
 *   - **SiteName** (domain.local) [indexed: yes]
 *   ### Halted
 *   - SiteName (domain.local) [halted]
 *
 * Note: local_list_sites does NOT include site IDs — only names and domains.
 * We use names as identifiers since all tools accept site names.
 */
function parseSiteListOutput(text: string): { running: SiteInfo[]; halted: SiteInfo[] } {
  const running: SiteInfo[] = [];
  const halted: SiteInfo[] = [];

  let currentSection: 'running' | 'halted' | null = null;
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers
    if (trimmed.toLowerCase().includes('### running')) {
      currentSection = 'running';
      continue;
    }
    if (trimmed.toLowerCase().includes('### halted')) {
      currentSection = 'halted';
      continue;
    }

    // Parse site lines: "- **Name** (domain) [...]" or "- Name (domain) [...]"
    const boldMatch = trimmed.match(/^-\s+\*\*(.+?)\*\*\s+\(([^)]+)\)/);
    const plainMatch = !boldMatch ? trimmed.match(/^-\s+(.+?)\s+\(([^)]+)\)/) : null;
    const match = boldMatch || plainMatch;
    if (!match) continue;

    const name = match[1].trim();
    const domain = match[2].trim();
    // Use name as ID since local_list_sites doesn't include IDs
    const site: SiteInfo = { id: name, name, domain };

    if (currentSection === 'running') {
      running.push(site);
    } else if (currentSection === 'halted') {
      halted.push(site);
    } else {
      // No section header yet — infer from content
      halted.push(site);
    }
  }

  return { running, halted };
}

// ---------------------------------------------------------------------------
// Local App Lifecycle
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the Local repo's electron binary.
 *
 * Priority:
 *   1. NEXUS_E2E_LOCAL_PATH env var (explicit override)
 *   2. ../../../flywheel-local relative to the addon repo root (sibling checkout)
 */
function resolveLocalRepoPath(): string | null {
  if (process.env.NEXUS_E2E_LOCAL_PATH) {
    return process.env.NEXUS_E2E_LOCAL_PATH;
  }

  // Assume addon is at <workspace>/local-addon-nexus-ai and Local is at <workspace>/flywheel-local
  const addonRoot = path.resolve(__dirname, '..', '..', '..');
  const sibling = path.resolve(addonRoot, '..', 'flywheel-local');
  if (fs.existsSync(path.join(sibling, 'node_modules', '.bin', 'electron'))) {
    return sibling;
  }

  return null;
}

/**
 * Check if the MCP server is already reachable (i.e. Local is already running).
 */
async function isMcpServerReachable(): Promise<boolean> {
  const connectionInfo = loadConnectionInfo();
  if (!connectionInfo) return false;

  try {
    const client = new McpClient(connectionInfo.url, connectionInfo.authToken);
    await client.health();
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the Local Electron app and wait for the MCP server to become reachable.
 * Returns the child process, or null if Local was already running.
 */
export async function startLocal(timeoutMs = 120000): Promise<ChildProcess | null> {
  // If MCP server is already up, Local is running — nothing to do
  if (await isMcpServerReachable()) {
    console.log('[E2E Local] MCP server already reachable — Local is running');
    return null;
  }

  const localPath = resolveLocalRepoPath();
  if (!localPath) {
    throw new Error(
      'Cannot find Local repo. Set NEXUS_E2E_LOCAL_PATH to the flywheel-local directory,\n' +
      'or ensure it exists as a sibling directory to this addon repo.',
    );
  }

  const electronBin = path.join(localPath, 'node_modules', '.bin', 'electron');
  const buildDir = path.join(localPath, 'build');

  if (!fs.existsSync(electronBin)) {
    throw new Error(`Electron binary not found at ${electronBin}. Run 'yarn' in ${localPath}.`);
  }
  if (!fs.existsSync(buildDir)) {
    throw new Error(`Build directory not found at ${buildDir}. Run 'nps build.dev' in ${localPath}.`);
  }

  console.log(`[E2E Local] Starting Local from ${localPath}...`);

  // Delete stale connection info so we can detect fresh startup
  const connInfoPath = getConnectionInfoPath();
  try { fs.unlinkSync(connInfoPath); } catch { /* file may not exist */ }

  const child = spawn(electronBin, ['--remote-debugging-port=9223', buildDir], {
    cwd: localPath,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env },
  });

  // Don't let the child keep the parent alive if something goes wrong
  child.unref();

  // Store PID for teardown
  if (child.pid) {
    process.env.NEXUS_E2E_LOCAL_PID = String(child.pid);
    console.log(`[E2E Local] Started Local (PID: ${child.pid})`);
  }

  // Wait for MCP server to become reachable
  console.log('[E2E Local] Waiting for MCP server...');
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < timeoutMs) {
    if (await isMcpServerReachable()) {
      console.log(`[E2E Local] MCP server ready (${Math.round((Date.now() - start) / 1000)}s)`);
      return child;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timed out — kill the process and fail
  stopLocal(child);
  throw new Error(
    `Local started but MCP server did not become reachable within ${timeoutMs / 1000}s.\n` +
    'Make sure the Nexus AI addon is installed and enabled.',
  );
}

/**
 * Stop a Local instance that we started.
 */
export function stopLocal(child?: ChildProcess | null): void {
  // Try the child process handle first
  if (child && !child.killed) {
    console.log(`[E2E Local] Stopping Local (PID: ${child.pid})...`);
    try {
      // Kill the process group (negative PID) since Electron spawns child processes
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    }
    return;
  }

  // Fallback: use stored PID from env var
  const pid = process.env.NEXUS_E2E_LOCAL_PID;
  if (pid) {
    console.log(`[E2E Local] Stopping Local (PID: ${pid} from env)...`);
    try {
      process.kill(-Number(pid), 'SIGTERM');
    } catch {
      try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already dead */ }
    }
    delete process.env.NEXUS_E2E_LOCAL_PID;
  }
}

/**
 * Discover the E2E test environment by connecting to the running addon.
 */
export async function discoverEnvironment(): Promise<E2EEnvironment> {
  const connectionInfo = loadConnectionInfo();
  if (!connectionInfo) {
    throw new Error(
      `Connection info not found at ${getConnectionInfoPath()}.\n` +
      'Make sure Local is running with the Nexus AI addon loaded.',
    );
  }

  const client = new McpClient(connectionInfo.url, connectionInfo.authToken);

  // Validate server is reachable
  try {
    await client.health();
  } catch (err) {
    throw new Error(
      `MCP server not reachable at ${connectionInfo.url}.\n` +
      'Make sure Local is running with the Nexus AI addon loaded.\n' +
      `Error: ${err}`,
    );
  }

  // Initialize the MCP session
  await client.initialize();

  // Discover sites
  let runningSites: SiteInfo[] = [];
  let haltedSites: SiteInfo[] = [];
  try {
    const result = await client.callTool('local_list_sites');
    if (!result.isError && result.content[0]?.text) {
      const text = result.content[0].text;
      console.log(`[E2E Setup] local_list_sites output:\n${text}`);
      const parsed = parseSiteListOutput(text);
      runningSites = parsed.running;
      haltedSites = parsed.halted;
    } else if (result.isError) {
      console.warn(`[E2E Setup] local_list_sites error: ${result.content[0]?.text}`);
    }
  } catch (err) {
    console.warn(`[E2E Setup] Site discovery failed: ${err}`);
  }

  // Determine test site
  let testSiteId: string | null = null;
  let testSiteName: string | null = null;
  let createdTestSite = false;

  const envTestSite = process.env.NEXUS_E2E_TEST_SITE;
  if (envTestSite) {
    // User specified a test site by name
    const match = [...runningSites, ...haltedSites].find(
      (s) => s.name.toLowerCase() === envTestSite.toLowerCase(),
    );
    if (match) {
      testSiteId = match.id;
      testSiteName = match.name;
    } else {
      console.warn(
        `NEXUS_E2E_TEST_SITE="${envTestSite}" not found among discovered sites. ` +
        'Mutation tests will attempt to create a temporary site.',
      );
    }
  }

  // If no test site designated, look for an existing "nexus-e2e-test" or create one
  if (!testSiteId && process.env.NEXUS_E2E_SKIP_MUTATIONS !== 'true') {
    // Check if "nexus-e2e-test" already exists (from a previous run)
    const existing = [...runningSites, ...haltedSites].find(
      (s) => s.name.toLowerCase() === 'nexus-e2e-test',
    );

    if (existing) {
      console.log(`[E2E Setup] Found existing test site: ${existing.name}`);

      // Start it if halted
      const isHalted = haltedSites.some((s) => s.name === existing.name);
      if (isHalted) {
        console.log('[E2E Setup] Starting halted test site...');
        try {
          await client.callTool('local_start_site', { site: existing.name });
          await waitForSiteRunning(client, existing.name, 120000);

          // Re-fetch site list to update runningSites array
          const result = await client.callTool('local_list_sites');
          if (!result.isError && result.content[0]?.text) {
            const parsed = parseSiteListOutput(result.content[0].text);
            runningSites = parsed.running;
            haltedSites = parsed.halted;
          }
        } catch (err) {
          console.warn(`[E2E Setup] Failed to start test site: ${err}`);
        }
      }

      // Validate the site has a working WordPress by running a simple WP-CLI command
      try {
        const versionResult = await client.callTool('wp_core_version', { site: existing.name });
        if (versionResult.isError) {
          console.warn(`[E2E Setup] Test site "${existing.name}" has broken WordPress — skipping as test site`);
          console.warn(`[E2E Setup] (${versionResult.content[0]?.text})`);
          // Don't use this site for mutations — WP-CLI won't work
        } else {
          testSiteId = existing.name;
          testSiteName = existing.name;
          console.log(`[E2E Setup] Test site validated (WP ${versionResult.content[0]?.text?.trim()})`);
        }
      } catch {
        console.warn('[E2E Setup] Could not validate test site — skipping as test site');
      }
    } else {
      // Create a new test site
      try {
        console.log('[E2E Setup] Creating temporary test site "nexus-e2e-test"...');
        const createResult = await client.callTool('local_create_site', { name: 'nexus-e2e-test' });
        if (!createResult.isError && createResult.content[0]?.text) {
          const text = createResult.content[0].text;
          // Output format: "- **ID:** abc123"
          const idMatch = text.match(/\*\*ID:\*\*\s*(\S+)/);
          testSiteId = idMatch ? idMatch[1] : 'nexus-e2e-test';
          testSiteName = 'nexus-e2e-test';
          createdTestSite = true;
          console.log(`[E2E Setup] Created test site (id: ${testSiteId})`);

          await waitForSiteRunning(client, testSiteName, 120000);
        } else if (createResult.isError) {
          console.warn(`[E2E Setup] Site creation failed: ${createResult.content[0]?.text}`);
        }
      } catch (err) {
        console.warn(`[E2E Setup] Failed to create temporary test site: ${err}`);
      }
    }
  }

  // If we created a test site, re-discover sites to include it
  if (createdTestSite && testSiteName) {
    try {
      const result = await client.callTool('local_list_sites');
      if (!result.isError && result.content[0]?.text) {
        const parsed = parseSiteListOutput(result.content[0].text);
        runningSites = parsed.running;
        haltedSites = parsed.halted;
      }
    } catch {
      // If re-discovery fails, add the test site manually
      runningSites.push({ id: testSiteId!, name: testSiteName, domain: `${testSiteName}.local` });
    }
  }

  // Check CAPI availability
  let capiAvailable = false;
  try {
    const capiResult = await client.callTool('wpe_get_accounts');
    capiAvailable = !capiResult.isError;
  } catch {
    // CAPI not available
  }

  // Check Ollama availability
  let ollamaAvailable = false;
  try {
    const ollamaResult = await client.callTool('list_ollama_models');
    ollamaAvailable = !ollamaResult.isError;
  } catch {
    // Ollama not available
  }

  return {
    connectionInfo,
    runningSites,
    haltedSites,
    testSiteId,
    testSiteName,
    capiAvailable,
    ollamaAvailable,
    availableTools: connectionInfo.tools,
    createdTestSite,
  };
}

/**
 * Poll local_get_site until the site status is "running" or timeout.
 */
async function waitForSiteRunning(client: McpClient, siteId: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  const pollInterval = 3000;

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await client.callTool('local_get_site', { site: siteId });
      if (!result.isError && result.content[0]?.text.toLowerCase().includes('running')) {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.warn(`Timed out waiting for site ${siteId} to be running after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Environment Serialization (for global setup → test files)
// ---------------------------------------------------------------------------

const ENV_KEY = 'NEXUS_E2E_ENV';

export function serializeEnvironment(env: E2EEnvironment): void {
  process.env[ENV_KEY] = JSON.stringify(env);
}

export function deserializeEnvironment(): E2EEnvironment {
  const raw = process.env[ENV_KEY];
  if (!raw) {
    throw new Error('E2E environment not initialized. Did global setup run?');
  }
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Helpers for test files
// ---------------------------------------------------------------------------

/**
 * Get a McpClient configured from the environment.
 */
export function getClient(): McpClient {
  const env = deserializeEnvironment();
  return new McpClient(env.connectionInfo.url, env.connectionInfo.authToken);
}

/**
 * Get the first running site, or throw if none available.
 */
export function getAnySite(): SiteInfo {
  const env = deserializeEnvironment();
  if (env.runningSites.length === 0) {
    throw new Error('No running sites available for E2E tests');
  }
  return env.runningSites[0];
}

/**
 * Get the designated test site for mutation tests, or throw if unavailable.
 */
export function getTestSite(): { id: string; name: string } {
  const env = deserializeEnvironment();
  if (!env.testSiteId || !env.testSiteName) {
    throw new Error(
      'No test site available for mutation tests. ' +
      'Set NEXUS_E2E_TEST_SITE or ensure Local can create sites.',
    );
  }
  return { id: env.testSiteId, name: env.testSiteName };
}

/**
 * Extract text from a tool result.
 */
export function resultText(result: McpToolResult): string {
  return result.content[0]?.text ?? '';
}

/**
 * Assert that a tool result is not an error.
 * Unlike `expect(result.isError).toBeFalsy()`, this shows the actual error text on failure.
 */
export function expectSuccess(result: McpToolResult): void {
  if (result.isError) {
    throw new Error(`Tool returned error: ${resultText(result)}`);
  }
}

/**
 * Poll a condition until it's true or timeout.
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
