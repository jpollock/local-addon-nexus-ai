/**
 * The two dispatch chokepoints must never let the audit path change the
 * outcome of the operation being audited (M1) and must tolerate a result with
 * no `content` array (M2). Agent handlers are the least-trusted code in the
 * system, so both chokepoints see hostile shapes.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import type { McpToolHandler, McpToolResult, NexusServices } from '../../../src/main/mcp/types';
import { AgentDispatcher } from '../../../src/main/agent-runtime/AgentDispatcher';
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';
import { OperationAuditLog } from '../../../src/main/audit/OperationAuditLog';

jest.mock('../../../src/main/ipc-handlers', () => ({
  getAgentSetting: jest.fn().mockReturnValue(true),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempLogPath(): { dir: string; logPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-chokepoint-'));
  return { dir, logPath: path.join(dir, 'operation-audit.log') };
}

/** A handler returning a bare `{ isError: true }` — no `content` array at all. */
function contentlessHandler(name: string, mode: 'error' | 'throw'): McpToolHandler {
  return {
    definition: { name, description: 'x', inputSchema: { type: 'object', properties: {} } },
    execute: async (): Promise<McpToolResult> => {
      if (mode === 'throw') throw new Error('handler exploded');
      return { isError: true } as unknown as McpToolResult;
    },
  };
}

/** An audit log stand-in that always throws — the M1 defence under test. */
const throwingAuditLog = {
  log() {
    throw new Error('audit disk on fire');
  },
} as unknown as OperationAuditLog;

// ---------------------------------------------------------------------------
// ToolRegistry.call()
// ---------------------------------------------------------------------------

describe('ToolRegistry.call() — audit path safety', () => {
  // M2
  it('does not throw when a Tier >= 2 handler returns no content array', async () => {
    const { dir, logPath } = tempLogPath();
    const registry = new ToolRegistry();
    registry.register(contentlessHandler('wpe_delete_install', 'error'));
    const services = { operationAuditLog: new OperationAuditLog(logPath) } as unknown as NexusServices;

    const result = await registry.call('wpe_delete_install', { install_id: 'prod' }, services);
    expect(result.isError).toBe(true);

    // The audit entry is still written, with the fallback error text.
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(entry.operation).toBe('wpe_delete_install');
    expect(entry.outcome).toBe('failure');
    expect(entry.error).toBe('Unknown error');
    expect(entry.target).toBe('prod');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // M1 — success path
  it('returns the successful result even when the audit write throws', async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: { name: 'wpe_create_backup', description: 'x', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: [{ type: 'text' as const, text: 'backup queued' }] }),
    });
    const services = { operationAuditLog: throwingAuditLog } as unknown as NexusServices;

    const result = await registry.call('wpe_create_backup', { install_id: 'prod' }, services);
    // Must NOT have been converted into an error result by the outer catch.
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('backup queued');
  });

  // M1 — catch path
  it('returns an error result (not a rejected promise) when the handler throws and the audit write also throws', async () => {
    const registry = new ToolRegistry();
    registry.register(contentlessHandler('wpe_delete_install', 'throw'));
    const services = { operationAuditLog: throwingAuditLog } as unknown as NexusServices;

    await expect(
      registry.call('wpe_delete_install', { install_id: 'prod' }, services),
    ).resolves.toMatchObject({ isError: true });
  });
});

// ---------------------------------------------------------------------------
// AgentDispatcher.dispatch()
// ---------------------------------------------------------------------------

describe('AgentDispatcher.dispatch() — audit path safety', () => {
  function makeDispatcher(services: unknown) {
    const reg = new ContributedToolRegistry();
    reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} }, 2);
    return new AgentDispatcher(
      reg,
      { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
      services as any,
      '/nonexistent',
      { provider: 'anthropic', apiKey: '', model: 'm', useLocalGateway: false } as any,
      { buildHandle: jest.fn() } as any,
    );
  }

  // M2
  it('does not throw when an agent handler returns no content array', async () => {
    const { dir, logPath } = tempLogPath();
    const d = makeDispatcher({ operationAuditLog: new OperationAuditLog(logPath) });
    jest.spyOn(d as any, 'dispatchFunction').mockResolvedValue({ isError: true });

    const r = await d.dispatch('my-agent', 'greet', { site: 'my-site' });
    expect(r.isError).toBe(true);

    const entry = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(entry.operation).toBe('my-agent/greet');
    expect(entry.outcome).toBe('failure');
    expect(entry.error).toBe('Unknown error');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // M1
  it('returns the handler result even when the audit write throws', async () => {
    const d = makeDispatcher({ operationAuditLog: throwingAuditLog });
    jest.spyOn(d as any, 'dispatchFunction').mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const r = await d.dispatch('my-agent', 'greet', { site: 'my-site' });
    expect(r.content[0].text).toBe('ok');
  });

  // M1 — cyclic args from agent code must not blow the stack in redactValue
  it('survives cyclic args', async () => {
    const { dir, logPath } = tempLogPath();
    const d = makeDispatcher({ operationAuditLog: new OperationAuditLog(logPath) });
    jest.spyOn(d as any, 'dispatchFunction').mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const cyclic: Record<string, unknown> = { site: 'my-site' };
    cyclic.self = cyclic;

    const r = await d.dispatch('my-agent', 'greet', cyclic);
    expect(r.content[0].text).toBe('ok');

    // The dispatcher spreads args into a fresh object, so the cycle closes one
    // level deeper: parameters.self is the original object, whose own `self`
    // back-reference is where the guard fires.
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(entry.parameters.self.self).toBe('[Circular]');
    expect(entry.parameters.self.site).toBe('my-site');
    expect(entry.target).toBe('my-site');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
