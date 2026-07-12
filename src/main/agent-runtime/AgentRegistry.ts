import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../logging/Logger';
import type { AgentDefinition } from '../agent-sdk/types';

const logger = createLogger('AgentRegistry');

export const AGENTS_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Local',
  'nexus-ai',
  'agents',
);

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private agentsDir: string;

  constructor(agentsDir: string = AGENTS_DIR) {
    this.agentsDir = agentsDir;
  }

  async load(): Promise<void> {
    this.agents.clear();
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(this.agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agentDir = path.join(this.agentsDir, entry.name);
      await this.loadAgent(agentDir);
    }
    logger.info(`AgentRegistry: loaded ${this.agents.size} agent(s)`);
  }

  private async loadAgent(agentDir: string): Promise<void> {
    const tsEntry = path.join(agentDir, 'agent.ts');
    const jsEntry = path.join(agentDir, 'agent.js');
    const entryPath = fs.existsSync(tsEntry) ? tsEntry : fs.existsSync(jsEntry) ? jsEntry : null;
    if (!entryPath) return;

    try {
      // Dynamic import — supports both ESM default exports and CJS module.exports.default
      const mod = await import(entryPath);
      let def: AgentDefinition = mod.default ?? mod;
      // CJS module.exports = { default: ... } gets double-wrapped by dynamic import
      if ((def as any)?.default && !(def as any)?.name && !(def as any)?.run) {
        def = (def as any).default;
      }
      if (!def?.name || !def?.run) {
        logger.warn(`AgentRegistry: ${agentDir} does not export a valid AgentDefinition`);
        return;
      }
      this.agents.set(def.name, def);
      logger.info(`AgentRegistry: registered "${def.name}" v${def.version}`);
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

  watch(): void {
    fs.watch(this.agentsDir, { persistent: false }, async () => {
      logger.info('AgentRegistry: change detected — reloading agents');
      try {
        await this.load();
      } catch (err: any) {
        logger.error(`AgentRegistry: reload failed: ${err.message}`);
      }
    });
  }
}
