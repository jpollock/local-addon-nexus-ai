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
});
