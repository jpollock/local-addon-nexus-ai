import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentRegistry } from '../../../src/main/agent-runtime/AgentRegistry';

function makeTempAgentsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agents-test-'));
  return dir;
}

function writeAgent(dir: string, name: string, code: string) {
  const agentDir = path.join(dir, name);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.js'), code);
}

const validAgentCode = `
const { defineAgent, cron } = require('${path.resolve('lib/main/agent-sdk')}');
module.exports = { default: defineAgent({ name: 'test-agent', version: '1.0.0', triggers: [cron('* * * * *')], run: async () => {} }) };
`;

describe('AgentRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempAgentsDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('load() with empty directory registers no agents', async () => {
    const registry = new AgentRegistry(tmpDir);
    await registry.load();
    expect(registry.list()).toHaveLength(0);
  });

  it('load() discovers and registers a valid agent', async () => {
    writeAgent(tmpDir, 'test-agent', validAgentCode);
    const registry = new AgentRegistry(tmpDir);
    await registry.load();
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe('test-agent');
  });

  it('get() returns the agent by name', async () => {
    writeAgent(tmpDir, 'test-agent', validAgentCode);
    const registry = new AgentRegistry(tmpDir);
    await registry.load();
    const agent = registry.get('test-agent');
    expect(agent?.name).toBe('test-agent');
  });

  it('get() returns undefined for unknown agent', async () => {
    const registry = new AgentRegistry(tmpDir);
    await registry.load();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('skips subdirectories without agent.ts or agent.js', async () => {
    const emptyDir = path.join(tmpDir, 'empty-package');
    fs.mkdirSync(emptyDir);
    writeAgent(tmpDir, 'valid-agent', validAgentCode);
    const registry = new AgentRegistry(tmpDir);
    await registry.load();
    expect(registry.list()).toHaveLength(1);
  });

  it('skips agents that fail to load (logs error, continues)', async () => {
    writeAgent(tmpDir, 'bad-agent', 'throw new Error("syntax error")');
    writeAgent(tmpDir, 'good-agent', validAgentCode);
    const registry = new AgentRegistry(tmpDir);
    await registry.load();
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe('test-agent');
  });
});
