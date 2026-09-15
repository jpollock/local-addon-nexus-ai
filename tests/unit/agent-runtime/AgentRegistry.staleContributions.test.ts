import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import * as validation from '../../../src/main/agent-runtime/agentToolValidation';
import { AgentRegistry } from '../../../src/main/agent-runtime/AgentRegistry';
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  watch: jest.fn(),
}));

function writeAgent(agentsDir: string, name: string, tools: string[] = []): string {
  const agentDir = path.join(agentsDir, name);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.js'), `
    module.exports = { default: {
      name: '${name}', version: '1.0.0', triggers: [],
      tools: ${JSON.stringify(tools)},
      run: async () => {},
    } };
  `);
  return agentDir;
}

function writeManifest(agentDir: string, name: string, toolNames: string[]): void {
  fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), yaml.dump({
    name,
    version: '1.0.0',
    contributes: {
      tools: toolNames.map(toolName => ({
        name: toolName,
        description: `${toolName} description`,
        inputSchema: { type: 'object' },
      })),
    },
  }));
}

describe('AgentRegistry stale contributed-tool reconciliation (GH-56)', () => {
  let agentsDir: string;
  let contributed: ContributedToolRegistry;

  beforeEach(() => {
    agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-stale-contributions-'));
    contributed = new ContributedToolRegistry();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (fs.watch as jest.MockedFunction<typeof fs.watch>).mockReset();
    jest.useRealTimers();
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  it('reconciles through unregisterAgent without requiring registry introspection', () => {
    const registeredAgents = new Set<string>();
    const minimalRegistry = {
      register: jest.fn((agentName: string) => registeredAgents.add(agentName)),
      unregisterAgent: jest.fn((agentName: string) => registeredAgents.delete(agentName)),
      list: jest.fn(() => []),
    } as unknown as ContributedToolRegistry;
    const agentDir = path.join(agentsDir, 'minimal-agent');
    fs.mkdirSync(agentDir);
    writeManifest(agentDir, 'minimal-agent', ['old_tool']);
    const registry = new AgentRegistry(agentsDir, minimalRegistry);

    registry.scan();
    expect(registeredAgents.has('minimal-agent')).toBe(true);

    writeManifest(agentDir, 'minimal-agent', []);
    expect(() => registry.scan()).not.toThrow();
    expect(registeredAgents.has('minimal-agent')).toBe(false);
    expect(minimalRegistry.unregisterAgent).toHaveBeenCalledWith('minimal-agent');
  });

  it('remove-tool + load() unregisters it and restores the consumer drift warning', async () => {
    const providerDir = writeAgent(agentsDir, 'provider-agent');
    writeManifest(providerDir, 'provider-agent', ['kept_tool', 'retired_tool']);
    writeAgent(agentsDir, 'consumer-agent', ['retired_tool']);

    const warningSpy = jest.spyOn(validation, 'collectAgentToolWarnings');
    const clearCache = jest.fn();
    const registry = new AgentRegistry(
      agentsDir,
      contributed,
      { clearCache },
      undefined,
      { allToolNames: () => [] },
    );

    await registry.load();
    expect(warningSpy.mock.results[0].value).toEqual([]);
    clearCache.mockClear();

    writeManifest(providerDir, 'provider-agent', ['kept_tool']);
    await registry.load();

    expect(contributed.get('provider-agent', 'retired_tool')).toBeUndefined();
    expect(contributed.get('provider-agent', 'kept_tool')).toBeDefined();
    expect(warningSpy.mock.results[1].value).toEqual([
      expect.stringContaining('consumer-agent'),
    ]);
    expect(warningSpy.mock.results[1].value[0]).toContain('retired_tool');
    expect(clearCache).toHaveBeenCalledWith('provider-agent');
  });

  it.each(['missing', 'corrupt'] as const)(
    '%s manifest + scan() unregisters the prior contribution',
    (manifestState) => {
      const agentDir = path.join(agentsDir, 'manifest-agent');
      fs.mkdirSync(agentDir);
      writeManifest(agentDir, 'manifest-agent', ['old_tool']);
      const registry = new AgentRegistry(agentsDir, contributed);
      registry.scan();

      const manifestPath = path.join(agentDir, 'nexus.agent.yaml');
      if (manifestState === 'missing') {
        fs.rmSync(manifestPath);
      } else {
        fs.writeFileSync(manifestPath, 'name: [unterminated');
      }
      registry.scan();

      expect(contributed.get('manifest-agent', 'old_tool')).toBeUndefined();
    },
  );

  it('empty contributes.tools + scan() unregisters the prior contribution and invalidates dispatch', () => {
    const agentDir = path.join(agentsDir, 'empty-agent');
    fs.mkdirSync(agentDir);
    writeManifest(agentDir, 'empty-agent', ['old_tool']);
    const clearCache = jest.fn();
    const registry = new AgentRegistry(agentsDir, contributed, { clearCache });
    registry.scan();
    clearCache.mockClear();

    writeManifest(agentDir, 'empty-agent', []);
    registry.scan();

    expect(contributed.get('empty-agent', 'old_tool')).toBeUndefined();
    expect(clearCache).toHaveBeenCalledWith('empty-agent');
  });

  it('removed agent directory + load() unregisters its prior contribution', async () => {
    const agentDir = writeAgent(agentsDir, 'removed-agent');
    writeManifest(agentDir, 'removed-agent', ['old_tool']);
    const clearCache = jest.fn();
    const registry = new AgentRegistry(agentsDir, contributed, { clearCache });
    await registry.load();
    expect(contributed.get('removed-agent', 'old_tool')).toBeDefined();
    clearCache.mockClear();

    fs.rmSync(agentDir, { recursive: true });
    await registry.load();

    expect(contributed.get('removed-agent', 'old_tool')).toBeUndefined();
    expect(clearCache).toHaveBeenCalledWith('removed-agent');
  });

  it.each(['missing', 'corrupt', 'empty'] as const)(
    '%s manifest hot-reload unregisters the prior contribution and invalidates dispatch',
    async (manifestState) => {
      jest.useFakeTimers();
      const agentDir = writeAgent(agentsDir, 'watched-agent');
      writeManifest(agentDir, 'watched-agent', ['old_tool']);
      const clearCache = jest.fn();
      const registry = new AgentRegistry(agentsDir, contributed, { clearCache });
      await registry.load();
      clearCache.mockClear();

      let watchHandler: ((_eventType: string, filename: string | null) => void) | undefined;
      (fs.watch as jest.MockedFunction<typeof fs.watch>).mockImplementation(((_path, _options, listener) => {
        watchHandler = listener as (_eventType: string, filename: string | null) => void;
        return { close: jest.fn() } as unknown as fs.FSWatcher;
      }) as typeof fs.watch);
      registry.watch(jest.fn(), jest.fn());

      const manifestPath = path.join(agentDir, 'nexus.agent.yaml');
      if (manifestState === 'missing') {
        fs.rmSync(manifestPath);
      } else if (manifestState === 'corrupt') {
        fs.writeFileSync(manifestPath, 'name: [unterminated');
      } else {
        writeManifest(agentDir, 'watched-agent', []);
      }

      watchHandler?.('change', path.join('watched-agent', 'nexus.agent.yaml'));
      await jest.advanceTimersByTimeAsync(300);

      expect(contributed.get('watched-agent', 'old_tool')).toBeUndefined();
      expect(clearCache).toHaveBeenCalledWith('watched-agent');
    },
  );

  it('removed agent directory hot-reload unregisters contributions and invalidates dispatch', async () => {
    jest.useFakeTimers();
    const agentDir = writeAgent(agentsDir, 'removed-watch-agent');
    writeManifest(agentDir, 'removed-watch-agent', ['old_tool']);
    const clearCache = jest.fn();
    const registry = new AgentRegistry(agentsDir, contributed, { clearCache });
    await registry.load();
    clearCache.mockClear();

    let watchHandler: ((_eventType: string, filename: string | null) => void) | undefined;
    (fs.watch as jest.MockedFunction<typeof fs.watch>).mockImplementation(((_path, _options, listener) => {
      watchHandler = listener as (_eventType: string, filename: string | null) => void;
      return { close: jest.fn() } as unknown as fs.FSWatcher;
    }) as typeof fs.watch);
    registry.watch(jest.fn(), jest.fn());

    fs.rmSync(agentDir, { recursive: true });
    watchHandler?.('rename', path.join('removed-watch-agent', 'nexus.agent.yaml'));
    await jest.advanceTimersByTimeAsync(300);

    expect(contributed.get('removed-watch-agent', 'old_tool')).toBeUndefined();
    expect(clearCache).toHaveBeenCalledWith('removed-watch-agent');
  });
});
