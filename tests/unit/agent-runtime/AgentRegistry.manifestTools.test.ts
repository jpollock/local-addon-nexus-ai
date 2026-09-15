import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import * as validation from '../../../src/main/agent-runtime/agentToolValidation';
import { AgentRegistry } from '../../../src/main/agent-runtime/AgentRegistry';
import { handleAgentToolsBuild } from '../../../src/cli/commands/agent';

function makeTempAgentsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agents-manifest-'));
}

function writeAgent(dir: string, name: string, code: string) {
  const agentDir = path.join(dir, name);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.js'), code);
}

describe('manifest tools: drift (GH-48)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempAgentsDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('manifestToolsDrift (pure)', () => {
    it('null when lists match', () => {
      expect(validation.manifestToolsDrift(['a', 'b'], ['b', 'a'])).toBeNull();
    });

    it('null when the yaml list is absent (legacy manifest)', () => {
      expect(validation.manifestToolsDrift(undefined, ['a'])).toBeNull();
    });

    it('reports both directions of drift', () => {
      const drift = validation.manifestToolsDrift(['a', 'ghost'], ['a', 'b']);
      expect(drift).toEqual({ missingInYaml: ['b'], extraInYaml: ['ghost'] });
    });

    it('empty yaml list against undeclared source is not drift', () => {
      expect(validation.manifestToolsDrift([], undefined)).toBeNull();
    });
  });

  describe('AgentRegistry load-time warning', () => {
    it('warns when yaml tools: drifts from def.tools', async () => {
      writeAgent(tmpDir, 'drift-agent', `
        module.exports = { default: {
          name: 'drift-agent', version: '1.0.0', triggers: [],
          tools: ['local_list_sites', 'wp_eval'],
          run: async () => {},
        } };
      `);
      const stubToolRegistry = { allToolNames: () => ['local_list_sites', 'wp_eval'] };
      const stubContributed = { list: () => [], unregisterAgent: () => {}, register: () => {} };
      fs.writeFileSync(path.join(tmpDir, 'drift-agent', 'nexus.agent.yaml'), yaml.dump({
        name: 'drift-agent',
        version: '1.0.0',
        tools: ['local_list_sites', 'ghost_tool'],
      }), 'utf8');

      const spy = jest.spyOn(validation, 'manifestToolsDrift');
      const registry = new AgentRegistry(
        tmpDir, stubContributed as never, undefined, undefined, stubToolRegistry,
      );
      await registry.load();

      const diff = spy.mock.results[0]?.value;
      expect(diff).toEqual({ missingInYaml: ['wp_eval'], extraInYaml: ['ghost_tool'] });
      spy.mockRestore();
    });
  });

  describe('nexus agent tools build', () => {
    it('regenerates the top-level tools: list from def.tools', async () => {
      const agentDir = path.join(tmpDir, 'build-agent');
      writeAgent(tmpDir, 'build-agent', `
        module.exports = { default: {
          name: 'build-agent', version: '1.0.0', triggers: [],
          tools: ['local_list_sites', 'wp_eval'],
          run: async () => {},
        } };
      `);
      fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), yaml.dump({
        name: 'build-agent',
        version: '1.0.0',
        tools: ['stale_only'],
      }), 'utf8');

      await handleAgentToolsBuild(agentDir, false);

      const manifest = yaml.load(
        fs.readFileSync(path.join(agentDir, 'nexus.agent.yaml'), 'utf8'),
      ) as { tools?: string[] };
      expect(manifest.tools).toEqual(['local_list_sites', 'wp_eval']);
    });

    it('--check exits non-zero when tools: drifts, and passes when reconciled', async () => {
      const agentDir = path.join(tmpDir, 'check-agent');
      writeAgent(tmpDir, 'check-agent', `
        module.exports = { default: {
          name: 'check-agent', version: '1.0.0', triggers: [],
          tools: ['wp_eval'],
          run: async () => {},
        } };
      `);
      fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), yaml.dump({
        name: 'check-agent',
        version: '1.0.0',
        tools: ['stale_only'],
      }), 'utf8');

      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit called');
      }) as never);
      await expect(handleAgentToolsBuild(agentDir, true)).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1); // drift detected — the check wanted a failure exit
      exitSpy.mockRestore();

      await handleAgentToolsBuild(agentDir, false); // reconcile
      await expect(handleAgentToolsBuild(agentDir, true)).resolves.toBeUndefined();
    });
  });

  describe('QA follow-ups (codex round 1 on PR #54)', () => {
    it('F4: drift warning fires even with NO contributed registry wired', async () => {
      writeAgent(tmpDir, 'noreg-agent', `
        module.exports = { default: {
          name: 'noreg-agent', version: '1.0.0', triggers: [],
          tools: ['wp_eval'],
          run: async () => {},
        } };
      `);
      fs.writeFileSync(path.join(tmpDir, 'noreg-agent', 'nexus.agent.yaml'), yaml.dump({
        name: 'noreg-agent', version: '1.0.0', tools: ['stale_only'],
      }), 'utf8');
      const spy = jest.spyOn(validation, 'manifestToolsDrift');
      const registry = new AgentRegistry(tmpDir); // no registries at all
      await registry.load();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.results[0].value).toEqual({ missingInYaml: ['wp_eval'], extraInYaml: ['stale_only'] });
      spy.mockRestore();
    });

    it('F5: --check on a MISSING manifest exits 1 without creating it', async () => {
      const agentDir = path.join(tmpDir, 'ghost-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'agent.js'), 'module.exports = { default: { name: "ghost-agent", version: "1", triggers: [], run: async () => {} } };');
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit called');
      }) as never);
      await expect(handleAgentToolsBuild(agentDir, true)).rejects.toThrow('process.exit called');
      exitSpy.mockRestore();
      expect(fs.existsSync(path.join(agentDir, 'nexus.agent.yaml'))).toBe(false);
    });

    it('F1: build carries per-tool permissionTier into the manifest', async () => {
      const agentDir = path.join(tmpDir, 'tiered-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'agent.js'), `
        module.exports = { default: {
          name: 'tiered-agent', version: '1.0.0', triggers: [],
          run: async () => {},
          contributes: { tools: {
            check_tiered_thing: { description: 'd', inputSchema: { type: 'object' }, permissionTier: 2 },
          } },
        } };
      `);
      fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), yaml.dump({
        name: 'tiered-agent', version: '1.0.0', tools: [],
      }), 'utf8');
      await handleAgentToolsBuild(agentDir, false);
      const manifest = yaml.load(fs.readFileSync(path.join(agentDir, 'nexus.agent.yaml'), 'utf8')) as {
        contributes?: { tools?: Array<{ name: string; permissionTier?: number }> };
      };
      const entry = manifest.contributes?.tools?.find((t) => t.name === 'check_tiered_thing');
      expect(entry?.permissionTier).toBe(2);
    });

    it('F7: --check survives comment/key-order changes but fails on numeric-vs-string drift', async () => {
      const agentDir = path.join(tmpDir, 'semantics-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'agent.js'), `
        module.exports = { default: {
          name: 'semantics-agent', version: '1.0.0', triggers: [],
          run: async () => {},
          contributes: { tools: {
            probe_tool: { description: 'd', inputSchema: { type: 'object', properties: { n: { type: 'number', default: 48 } } } },
          } },
        } };
      `);
      fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), yaml.dump({
        name: 'semantics-agent', version: '1.0.0', tools: [],
      }), 'utf8');
      await handleAgentToolsBuild(agentDir, false); // write canonical form
      const manifestPath = path.join(agentDir, 'nexus.agent.yaml');

      // hand edits that are NOT drift: header comments + key order are not owned by the builder
      const raw = fs.readFileSync(manifestPath, 'utf8');
      fs.writeFileSync(manifestPath, '# hand-written header comment\n' + raw, 'utf8');
      await expect(handleAgentToolsBuild(agentDir, true)).resolves.toBeUndefined();

      // semantic drift: numeric default changed to string in the yaml
      const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;
      manifest.contributes.tools[0].inputSchema.properties.n.default = '48';
      fs.writeFileSync(manifestPath, yaml.dump(manifest), 'utf8');
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit called');
      }) as never);
      await expect(handleAgentToolsBuild(agentDir, true)).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

});
