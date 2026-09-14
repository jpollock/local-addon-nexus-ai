import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as validation from '../../../src/main/agent-runtime/agentToolValidation';
import { AgentRegistry } from '../../../src/main/agent-runtime/AgentRegistry';

function makeTempAgentsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agents-toolval-'));
}

function writeAgent(dir: string, name: string, code: string) {
  const agentDir = path.join(dir, name);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.js'), code);
}

const stubToolRegistry = { allToolNames: () => ['local_list_sites', 'wp_eval'] };
const stubContributed = {
  list: () => [{ toolName: 'get_log_aggregates' }],
} as never;

describe('agentToolValidation (GH-47)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempAgentsDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('unresolvedTools', () => {
    const universe = validation.buildToolUniverse(stubToolRegistry, stubContributed);

    it('flags names in neither registry', () => {
      expect(validation.unresolvedTools(['local_list_sites', 'fleet_sqll'], universe))
        .toEqual(['fleet_sqll']);
    });

    it('accepts contributed tools', () => {
      expect(validation.unresolvedTools(['get_log_aggregates'], universe)).toEqual([]);
    });

    it('returns empty for undefined/empty declarations', () => {
      expect(validation.unresolvedTools(undefined, universe)).toEqual([]);
      expect(validation.unresolvedTools([], universe)).toEqual([]);
    });
  });

  describe('load()-time warning', () => {
    it('warns once per unknown declared tool after all agents load', async () => {
      writeAgent(tmpDir, 'typo-agent', `
        module.exports = { default: {
          name: 'typo-agent', version: '1.0.0', triggers: [],
          tools: ['local_list_sites', 'fleet_sqll', 'wp_evall'],
          run: async () => {},
        } };
      `);
      const spy = jest.spyOn(validation, 'collectAgentToolWarnings');
      const registry = new AgentRegistry(
        tmpDir, undefined, undefined, undefined, stubToolRegistry,
      );
      await registry.load();
      expect(spy).toHaveBeenCalledTimes(1);
      const warnings = spy.mock.results[0].value as string[];
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('typo-agent');
      expect(warnings[0]).toContain('fleet_sqll');
      spy.mockRestore();
    });

    it('no warnings when every declared tool resolves', async () => {
      writeAgent(tmpDir, 'clean-agent', `
        module.exports = { default: {
          name: 'clean-agent', version: '1.0.0', triggers: [],
          tools: ['local_list_sites', 'get_log_aggregates'],
          run: async () => {},
        } };
      `);
      const spy = jest.spyOn(validation, 'collectAgentToolWarnings');
      const registry = new AgentRegistry(
        tmpDir, stubContributed, undefined, undefined, stubToolRegistry,
      );
      await registry.load();
      expect(spy.mock.results[0]?.value ?? []).toEqual([]);
      spy.mockRestore();
    });

    it('skips validation entirely when no registry is wired', async () => {
      writeAgent(tmpDir, 'lonely-agent', `
        module.exports = { default: {
          name: 'lonely-agent', version: '1.0.0', triggers: [],
          tools: ['anything_at_all'],
          run: async () => {},
        } };
      `);
      const registry = new AgentRegistry(tmpDir);
      await registry.load();
      expect(registry.list()).toHaveLength(1); // loads fine — warn-only by design
    });
  });
});
