import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { AgentDefinition } from '../../../src/main/agent-sdk/types';

/**
 * The manifest is the dispatch authority; agent.ts only supplies handlers.
 *
 * `AgentRegistry.loadManifest()` reads `nexus.agent.yaml` and registers its `contributes.tools`
 * into the ContributedToolRegistry, and `AgentDispatcher.dispatch()` refuses anything not in that
 * registry. So a tool present in code but absent from the manifest fails with
 * "Tool <agent>/<tool> not found" no matter how complete its implementation is — which is exactly
 * how a finished, fully-unit-tested set_log_bucket reached the UI dead on arrival. Nothing else in
 * the build compares the two files, so this test is the only thing that can catch the drift.
 *
 * `executionMode` is checked too, and it is not cosmetic: `dispatchRun` ignores the tool name
 * entirely and invokes the agent's `run()`, so a tool marked `run` in the manifest and `function`
 * in code silently performs a scheduled run instead of the operation that was asked for.
 */

const AGENTS_DIR = path.join(__dirname, '../../../agents');

type ManifestTool = { name: string; executionMode?: string; permissionTier?: number };
type Manifest = { name?: string; version?: string; contributes?: { tools?: ManifestTool[] } };

function agentDirs(): string[] {
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'node_modules')
    .map(e => e.name)
    .filter(name => fs.existsSync(path.join(AGENTS_DIR, name, 'nexus.agent.yaml')))
    .filter(name =>
      fs.existsSync(path.join(AGENTS_DIR, name, 'agent.ts')) ||
      fs.existsSync(path.join(AGENTS_DIR, name, 'agent.js')));
}

function loadManifest(name: string): Manifest {
  return yaml.load(fs.readFileSync(path.join(AGENTS_DIR, name, 'nexus.agent.yaml'), 'utf-8')) as Manifest;
}

function loadAgent(name: string): AgentDefinition {
  const dir = path.join(AGENTS_DIR, name);
  const file = fs.existsSync(path.join(dir, 'agent.ts')) ? 'agent.ts' : 'agent.js';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(path.join(dir, file));
  return (mod.default ?? mod) as AgentDefinition;
}

describe.each(agentDirs())('%s manifest', (agentName) => {
  const manifest = loadManifest(agentName);
  const agent = loadAgent(agentName);

  const manifestTools = manifest.contributes?.tools ?? [];
  const codeTools = Object.keys(agent.contributes?.tools ?? {});

  it('declares the same name and version as the code', () => {
    expect(manifest.name).toBe(agent.name);
    expect(manifest.version).toBe(agent.version);
  });

  it('declares exactly the tools the code implements', () => {
    expect(manifestTools.map(t => t.name).sort()).toEqual(codeTools.sort());
  });

  it.each(manifestTools.map(t => [t.name, t] as const))(
    '%s: executionMode agrees with the handler',
    (toolName, tool) => {
      const impl = (agent.contributes?.tools ?? {})[toolName] as { executionMode?: string } | undefined;
      expect(impl).toBeDefined();
      expect(tool.executionMode ?? 'function').toBe(impl?.executionMode ?? 'function');
    },
  );
});
