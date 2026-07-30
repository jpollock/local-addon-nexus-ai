import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog } from '../../../src/main/audit/OperationAuditLog';
import { McpSafetyWrapper } from '../../../src/main/mcp/mcp-safety-wrapper';

function makeDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wiring-')); }

describe('audit wiring at the MCP dispatch chokepoint', () => {
  let dir: string, logPath: string;
  beforeEach(() => { dir = makeDir(); logPath = path.join(dir, 'operation-audit.log'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function servicesWithAudit() {
    return { operationAuditLog: new OperationAuditLog(logPath) } as any;
  }

  const registry = {
    call: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false }),
  } as any;

  beforeEach(() => registry.call.mockClear());

  it('writes a durable entry for a Tier 2 tool call', async () => {
    const wrapper = new McpSafetyWrapper(registry);
    await wrapper.callWithSafety('wp_core_update', { site: 'demo' }, servicesWithAudit());

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.operation).toBe('wp_core_update');
    expect(entry.outcome).toBe('success');
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
  });

  it('does NOT write a durable entry for a Tier 1 read-only tool', async () => {
    const wrapper = new McpSafetyWrapper(registry);
    await wrapper.callWithSafety('wp_plugin_list', { site: 'demo' }, servicesWithAudit());
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('records failures with outcome=failure', async () => {
    const failing = {
      call: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    } as any;
    const wrapper = new McpSafetyWrapper(failing);
    await wrapper.callWithSafety('wp_core_update', { site: 'demo' }, servicesWithAudit());

    const entry = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(entry.outcome).toBe('failure');
    expect(entry.error).toContain('boom');
  });

  it('does not break the tool call when auditing is unavailable', async () => {
    const wrapper = new McpSafetyWrapper(registry);
    const result = await wrapper.callWithSafety('wp_core_update', { site: 'demo' }, {} as any);
    expect(result.isError).toBeFalsy();
  });
});
