import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition } from '../agent-sdk/types';
import type { ContributedToolRegistry, ContributedManifestEntry } from './ContributedToolRegistry';

const logger = createLogger('AgentRegistry');

// Same regex as AgentDispatcher — bans double-underscore so MCP name 'agent__<name>__<tool>' splits cleanly
const VALID_AGENT_NAME = /^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$|^[a-z0-9]$/;

type AgentManifestWithContributes = {
  name: string;
  version?: string;
  contributes?: {
    tools?: ContributedManifestEntry[];
  };
  permissions?: { tier?: number };
};

export const AGENTS_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Local',
  'nexus-ai',
  'agents',
);

const SDK_PATH = path.resolve(__dirname, '..', 'agent-sdk', 'index.js');

let tsNodeRegistered = false;

function ensureTsNodeRegistered(): void {
  if (tsNodeRegistered) return;
  tsNodeRegistered = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tsNode = require('ts-node') as typeof import('ts-node');
    tsNode.register({
      transpileOnly: true,
      compilerOptions: {
        module: 'CommonJS',
        target: 'ES2020',
        strict: true,
        esModuleInterop: true,
        paths: { '@nexus-ai/agent-sdk': [SDK_PATH] },
      },
    });
  } catch (err: any) {
    logger.warn(`AgentRegistry: ts-node not available — .ts agents will fail to load: ${err.message}`);
  }
}

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private agentsDir: string;

  constructor(
    agentsDir: string = AGENTS_DIR,
    private readonly contributedRegistry?: ContributedToolRegistry,
    private readonly dispatcher?: { clearCache(name: string): void },
  ) {
    this.agentsDir = agentsDir;
  }

  /**
   * Synchronously scan all agent directories for `nexus.agent.yaml` manifests
   * and register any `contributes.tools` into the ContributedToolRegistry.
   * Agents without a manifest are silently skipped.
   * Does NOT load agent code — use load() for that.
   */
  scan(): void {
    if (!fs.existsSync(this.agentsDir)) return;

    const entries = fs.readdirSync(this.agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      this.loadManifest(path.join(this.agentsDir, entry.name));
    }
  }

  private loadManifest(agentDir: string): void {
    if (!this.contributedRegistry) return;

    const manifestPath = path.join(agentDir, 'nexus.agent.yaml');
    if (!fs.existsSync(manifestPath)) return;

    let manifest: AgentManifestWithContributes;
    try {
      manifest = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as AgentManifestWithContributes;
    } catch (err: any) {
      logger.warn(`AgentRegistry: failed to parse manifest at ${manifestPath}: ${err.message}`);
      return;
    }

    if (!manifest?.name) {
      logger.warn(`AgentRegistry: manifest at ${manifestPath} is missing required "name" field`);
      return;
    }

    if (!VALID_AGENT_NAME.test(manifest.name)) {
      logger.warn(`AgentRegistry: manifest name "${manifest.name}" is invalid — skipping (double underscore and uppercase are not allowed)`);
      return;
    }

    const tools = manifest.contributes?.tools;
    if (!tools?.length) return;

    this.contributedRegistry.unregisterAgent(manifest.name);
    const tier = manifest.permissions?.tier ?? 1;
    for (const tool of tools) {
      this.contributedRegistry.register(manifest.name, tool, tier);
    }
    this.dispatcher?.clearCache(manifest.name);
    logger.info(`AgentRegistry: registered ${tools.length} contributed tool(s) for "${manifest.name}"`);
  }

  async load(): Promise<void> {
    this.agents.clear();
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });
      return;
    }

    // Scan direct subdirectories
    const entries = fs.readdirSync(this.agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      await this.loadAgent(path.join(this.agentsDir, entry.name));
    }

    // Scan node_modules for published agent packages
    const nodeModulesDir = path.join(this.agentsDir, 'node_modules');
    if (fs.existsSync(nodeModulesDir)) {
      const pkgs = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
      for (const pkg of pkgs) {
        if (!pkg.isDirectory()) continue;
        const pkgDir = path.join(nodeModulesDir, pkg.name);
        const pkgJsonPath = path.join(pkgDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as { main?: string };
          const main = pkgJson.main ?? '';
          if (path.basename(main) === 'agent.ts' || path.basename(main) === 'agent.js') {
            await this.loadAgent(pkgDir);
          }
        } catch { /* skip malformed packages */ }
      }
    }

    logger.info(`AgentRegistry: loaded ${this.agents.size} agent(s)`);
  }

  private async loadAgent(agentDir: string): Promise<void> {
    const tsEntry = path.join(agentDir, 'agent.ts');
    const jsEntry = path.join(agentDir, 'agent.js');
    const entryPath = fs.existsSync(tsEntry) ? tsEntry : fs.existsSync(jsEntry) ? jsEntry : null;
    if (!entryPath) return;

    if (entryPath.endsWith('.ts')) {
      ensureTsNodeRegistered();
    }

    try {
      // Delete cached module so reload picks up fresh source
      delete require.cache[require.resolve(entryPath)];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      let def: AgentDefinition = require(entryPath);
      if ((def as any)?.default) def = (def as any).default;
      if (!def?.name || !def?.run) {
        logger.warn(`AgentRegistry: ${agentDir} does not export a valid AgentDefinition`);
        return;
      }
      this.agents.set(def.name, def);
      logger.info(`AgentRegistry: registered "${def.name}" v${def.version}`);
      // Also load contributed tools from YAML manifest if present
      this.loadManifest(agentDir);
    } catch (err: any) {
      logger.error(`AgentRegistry: failed to load agent at ${agentDir}: ${err.message}`);
    }
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  watch(
    onUnload: (name: string) => void,
    onReload: (def: AgentDefinition) => void,
  ): void {
    const debounceTimers = new Map<string, NodeJS.Timeout>();

    const handler = (_eventType: string, filename: string | null) => {
      if (!filename) return;
      // Extract the agent name — first path segment under agentsDir
      const segments = filename.split(path.sep);
      const agentName = segments[0];
      if (!agentName || agentName === 'node_modules') return;

      if (debounceTimers.has(agentName)) {
        clearTimeout(debounceTimers.get(agentName)!);
      }
      debounceTimers.set(agentName, setTimeout(async () => {
        debounceTimers.delete(agentName);
        logger.info(`AgentRegistry: change detected in "${agentName}" — reloading`);

        const agentDir = path.join(this.agentsDir, agentName);
        if (!fs.existsSync(agentDir)) {
          // Directory removed — just unload
          if (this.agents.has(agentName)) {
            this.agents.delete(agentName);
            onUnload(agentName);
          }
          this.contributedRegistry?.unregisterAgent(agentName);
          return;
        }

        // Unload first if previously registered
        const existing = this.agents.get(agentName);
        if (existing) {
          this.agents.delete(agentName);
          onUnload(agentName);
        }

        await this.loadAgent(agentDir);

        const reloaded = this.agents.get(agentName);
        if (reloaded) {
          onReload(reloaded);
        } else {
          logger.warn(`AgentRegistry: "${agentName}" failed to reload — agent remains unloaded`);
        }
      }, 300));
    };

    try {
      fs.watch(this.agentsDir, { persistent: false, recursive: true }, handler);
    } catch (err: any) {
      logger.warn(`AgentRegistry: fs.watch not available on this platform: ${err.message}`);
    }
  }
}
