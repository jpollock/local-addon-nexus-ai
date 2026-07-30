import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog } from '../../../src/main/audit/OperationAuditLog';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import type { McpToolHandler } from '../../../src/main/mcp/types';

function makeDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wiring-')); }

/**
 * The durable audit write lives inside ToolRegistry.call() — the true single
 * funnel all dispatch surfaces (McpSafetyWrapper, CLI/GraphQL resolvers,
 * ChatService) route through. A mocked registry never executes that code, so
 * these tests construct a REAL ToolRegistry with a fake registered tool and
 * call it directly, rather than mocking `registry.call`.
 */
function makeTool(name: string, opts: { isError?: boolean; text?: string } = {}): McpToolHandler {
  return {
    definition: { name, description: 'test tool', inputSchema: {} },
    execute: async () => ({
      content: [{ type: 'text', text: opts.text ?? 'done' }],
      isError: opts.isError ?? false,
    }),
  };
}

/** A tool whose handler throws instead of returning an error result — the
 * regression guard for ToolRegistry.call()'s catch branch. */
function makeThrowingTool(name: string, errorMessage: string): McpToolHandler {
  return {
    definition: { name, description: 'test tool', inputSchema: {} },
    execute: async () => {
      throw new Error(errorMessage);
    },
  };
}

describe('audit wiring at the ToolRegistry dispatch chokepoint', () => {
  let dir: string, logPath: string;
  beforeEach(() => { dir = makeDir(); logPath = path.join(dir, 'operation-audit.log'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function servicesWithAudit() {
    return { operationAuditLog: new OperationAuditLog(logPath) } as any;
  }

  it('writes a durable entry for a Tier 2 tool call (default tier for a name absent from TIER_OVERRIDES)', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('fake_tier2_tool'));

    await registry.call('fake_tier2_tool', { site: 'demo' }, servicesWithAudit(), 'mcp');

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.operation).toBe('fake_tier2_tool');
    expect(entry.outcome).toBe('success');
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
  });

  it('does NOT write a durable entry for a Tier 1 read-only tool', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('wp_plugin_list')); // Tier 1 per TIER_OVERRIDES

    await registry.call('wp_plugin_list', { site: 'demo' }, servicesWithAudit(), 'mcp');

    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('records failures with outcome=failure', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('wp_core_update', { isError: true, text: 'boom' })); // Tier 2

    await registry.call('wp_core_update', { site: 'demo' }, servicesWithAudit(), 'mcp');

    const entry = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(entry.outcome).toBe('failure');
    expect(entry.error).toContain('boom');
  });

  it('records a durable failure entry with the error message when the handler throws', async () => {
    const registry = new ToolRegistry();
    registry.register(makeThrowingTool('wp_core_update', 'connection reset by peer')); // Tier 2

    const result = await registry.call('wp_core_update', { site: 'demo' }, servicesWithAudit(), 'mcp');

    // The tool call itself still resolves with an error result rather than
    // throwing out of registry.call() — the audit write must not change that.
    expect(result.isError).toBe(true);

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.operation).toBe('wp_core_update');
    expect(entry.outcome).toBe('failure');
    expect(entry.error).toContain('connection reset by peer');
  });

  it('does not break the tool call when auditing is unavailable', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('wp_core_update'));

    const result = await registry.call('wp_core_update', { site: 'demo' }, {} as any, 'mcp');
    expect(result.isError).toBeFalsy();
  });

  it('records _accessMethod on the durable entry (regression guard for the CLI/GraphQL gap)', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('wp_core_update'));

    await registry.call('wp_core_update', { site: 'demo' }, servicesWithAudit(), 'cli');

    const entry = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(entry.parameters._accessMethod).toBe('cli');
  });
});
