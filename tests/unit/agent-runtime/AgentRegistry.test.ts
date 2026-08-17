import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentRegistry } from '../../../src/main/agent-runtime/AgentRegistry';
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';

function makeTempAgentsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agents-test-'));
  return dir;
}

function writeAgent(dir: string, name: string, code: string) {
  const agentDir = path.join(dir, name);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.js'), code);
}

// The fixture agent is written to a temp dir and loaded by AgentRegistry's own
// `require()`, which runs inside jest — so it resolves through jest's transform.
// Point it at the SDK SOURCE, not `lib/main/agent-sdk`: a compiled-tree path made
// these four tests fail in any worktree that had not run `npm run compile`, which
// read as a phantom agent-runtime regression and burned three packets (WP-19b,
// WP-20 phase 1, WP-22b — see WP-23). `__dirname`-relative, not cwd-relative, so
// the jest invocation directory cannot move it either.
const AGENT_SDK_SOURCE = path.resolve(__dirname, '..', '..', '..', 'src', 'main', 'agent-sdk');

const validAgentCode = `
const { defineAgent, cron } = require('${AGENT_SDK_SOURCE}');
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

describe('AgentRegistry — contributed tools', () => {
  it('registers contributes.tools from manifest via scan()', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reg-'));
    const agentDir = path.join(dir, 'my-agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), `
name: my-agent
version: 1.0.0
contributes:
  tools:
    - name: ping
      description: Ping
      inputSchema:
        type: object
`);
    const reg = new ContributedToolRegistry();
    const registry = new AgentRegistry(dir, reg);
    registry.scan();
    const tool = reg.get('my-agent', 'ping');
    expect(tool?.toolName).toBe('ping');
    fs.rmSync(dir, { recursive: true });
  });

  it('rejects agent name with double underscore', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reg-'));
    const agentDir = path.join(dir, 'my__agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), `name: my__agent\nversion: 1.0.0\n`);
    const reg = new ContributedToolRegistry();
    const registry = new AgentRegistry(dir, reg);
    registry.scan();
    expect(reg.list()).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it('calls dispatcher.clearCache() when tools are registered', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reg-'));
    const agentDir = path.join(dir, 'my-agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), `
name: my-agent
version: 1.0.0
contributes:
  tools:
    - name: check
      description: Check something
      inputSchema:
        type: object
`);
    const reg = new ContributedToolRegistry();
    const cleared: string[] = [];
    const dispatcher = { clearCache: (name: string) => cleared.push(name) };
    const registry = new AgentRegistry(dir, reg, dispatcher);
    registry.scan();
    expect(cleared).toContain('my-agent');
    fs.rmSync(dir, { recursive: true });
  });

  it('skips manifest with missing name field', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reg-'));
    const agentDir = path.join(dir, 'no-name-agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), `version: 1.0.0\n`);
    const reg = new ContributedToolRegistry();
    const registry = new AgentRegistry(dir, reg);
    registry.scan();
    expect(reg.list()).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it('uses permissions.tier when registering tools', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reg-'));
    const agentDir = path.join(dir, 'sec-agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), `
name: sec-agent
version: 1.0.0
permissions:
  tier: 3
contributes:
  tools:
    - name: delete-stuff
      description: Dangerous
      inputSchema:
        type: object
`);
    const reg = new ContributedToolRegistry();
    const registry = new AgentRegistry(dir, reg);
    registry.scan();
    const tool = reg.get('sec-agent', 'delete-stuff');
    expect(tool?.permissionTier).toBe(3);
    fs.rmSync(dir, { recursive: true });
  });
});
