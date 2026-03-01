import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { McpToolHandler, NexusServices } from '../../src/main/mcp/types';
import { createAuditLogger } from '../../src/main/mcp/audit';

const mockAuditLogger = createAuditLogger();

const mockServices = {
  auditLogger: mockAuditLogger,
} as unknown as NexusServices;

function makeTool(name: string, opts?: { available?: boolean }): McpToolHandler {
  return {
    definition: {
      name,
      description: `Test tool: ${name}`,
      inputSchema: { type: 'object', properties: {} },
      ...(opts?.available !== undefined ? { isAvailable: () => opts.available! } : {}),
    },
    execute: jest.fn(async (args) => ({
      content: [{ type: 'text' as const, text: `executed ${name}` }],
    })),
  };
}

describe('ToolRegistry Safety Enforcement', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe('Tier 1 tools (Read)', () => {
    test('execute immediately without confirmation', async () => {
      const registry = new ToolRegistry();
      const tool = makeTool('local_list_sites');
      registry.register(tool);

      const result = await registry.call('local_list_sites', {}, mockServices);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('executed local_list_sites');
      expect(tool.execute).toHaveBeenCalled();
    });

    test('audit logs Tier 1 calls', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      registry.register(makeTool('local_list_sites'));

      await registry.call('local_list_sites', { foo: 'bar' }, services);

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].toolName).toBe('local_list_sites');
      expect(entries[0].tier).toBe(1);
      expect(entries[0].result).toBe('success');
      expect(entries[0].confirmed).toBeNull();
    });
  });

  describe('Tier 2 tools (Modify)', () => {
    test('execute without confirmation', async () => {
      const registry = new ToolRegistry();
      const tool = makeTool('local_start_site');
      registry.register(tool);

      const result = await registry.call('local_start_site', { site: 'test' }, mockServices);
      expect(result.isError).toBeUndefined();
      expect(tool.execute).toHaveBeenCalled();
    });

    test('audit logs Tier 2 calls', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      registry.register(makeTool('local_start_site'));

      await registry.call('local_start_site', {}, services);

      const entries = logger.getEntries();
      expect(entries[0].tier).toBe(2);
      expect(entries[0].result).toBe('success');
    });
  });

  describe('Tier 3 tools (Destructive)', () => {
    test('returns confirmation prompt when no token provided', async () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('local_delete_site'));

      const result = await registry.call('local_delete_site', { siteId: '123' }, mockServices);

      const payload = JSON.parse(result.content[0].text);
      expect(payload.requiresConfirmation).toBe(true);
      expect(payload.tier).toBe(3);
      expect(payload.confirmationToken).toBeDefined();
      expect(payload.confirmationToken).toMatch(/^[a-f0-9]{32}$/);
      expect(payload.action).toBeDefined();
      expect(payload.howToConfirm).toContain('local_delete_site');
    });

    test('does not execute handler when no token', async () => {
      const registry = new ToolRegistry();
      const tool = makeTool('local_delete_site');
      registry.register(tool);

      await registry.call('local_delete_site', { siteId: '123' }, mockServices);
      expect(tool.execute).not.toHaveBeenCalled();
    });

    test('executes with valid confirmation token', async () => {
      const registry = new ToolRegistry();
      const tool = makeTool('local_delete_site');
      registry.register(tool);

      // Step 1: Get confirmation token
      const confirmResult = await registry.call('local_delete_site', { siteId: '123' }, mockServices);
      const { confirmationToken } = JSON.parse(confirmResult.content[0].text);

      // Step 2: Confirm with token
      const result = await registry.call(
        'local_delete_site',
        { siteId: '123', _confirmationToken: confirmationToken },
        mockServices,
      );

      expect(result.isError).toBeUndefined();
      expect(tool.execute).toHaveBeenCalled();
    });

    test('strips _confirmationToken before passing to handler', async () => {
      const registry = new ToolRegistry();
      const tool = makeTool('local_delete_site');
      registry.register(tool);

      const confirmResult = await registry.call('local_delete_site', { siteId: '123' }, mockServices);
      const { confirmationToken } = JSON.parse(confirmResult.content[0].text);

      await registry.call(
        'local_delete_site',
        { siteId: '123', _confirmationToken: confirmationToken },
        mockServices,
      );

      const passedArgs = (tool.execute as jest.Mock).mock.calls[0][0];
      expect(passedArgs._confirmationToken).toBeUndefined();
      expect(passedArgs.siteId).toBe('123');
    });

    test('rejects invalid confirmation token', async () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('local_delete_site'));

      const result = await registry.call(
        'local_delete_site',
        { siteId: '123', _confirmationToken: 'bogus' },
        mockServices,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/invalid/i);
    });

    test('rejects when params changed after confirmation', async () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('local_delete_site'));

      const confirmResult = await registry.call('local_delete_site', { siteId: '123' }, mockServices);
      const { confirmationToken } = JSON.parse(confirmResult.content[0].text);

      // Try to confirm with different params
      const result = await registry.call(
        'local_delete_site',
        { siteId: '456', _confirmationToken: confirmationToken },
        mockServices,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/parameters changed/i);
    });

    test('token is single-use', async () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('local_delete_site'));

      const confirmResult = await registry.call('local_delete_site', { siteId: '123' }, mockServices);
      const { confirmationToken } = JSON.parse(confirmResult.content[0].text);

      // First use: success
      await registry.call(
        'local_delete_site',
        { siteId: '123', _confirmationToken: confirmationToken },
        mockServices,
      );

      // Second use: fail
      const result = await registry.call(
        'local_delete_site',
        { siteId: '123', _confirmationToken: confirmationToken },
        mockServices,
      );
      expect(result.isError).toBe(true);
    });

    test('rejects expired token', async () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('local_delete_site'));

      const confirmResult = await registry.call('local_delete_site', { siteId: '123' }, mockServices);
      const { confirmationToken } = JSON.parse(confirmResult.content[0].text);

      // Fast-forward time
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);

      const result = await registry.call(
        'local_delete_site',
        { siteId: '123', _confirmationToken: confirmationToken },
        mockServices,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/expired/i);

      (Date.now as jest.Mock).mockRestore();
    });

    test('audit logs confirmation_required', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      registry.register(makeTool('local_delete_site'));

      await registry.call('local_delete_site', { siteId: '123' }, services);

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe('confirmation_required');
      expect(entries[0].confirmed).toBeNull();
    });

    test('audit logs confirmed execution', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      registry.register(makeTool('local_delete_site'));

      const confirmResult = await registry.call('local_delete_site', { siteId: '123' }, services);
      const { confirmationToken } = JSON.parse(confirmResult.content[0].text);

      await registry.call(
        'local_delete_site',
        { siteId: '123', _confirmationToken: confirmationToken },
        services,
      );

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].result).toBe('confirmation_required');
      expect(entries[1].result).toBe('success');
      expect(entries[1].confirmed).toBe(true);
    });
  });

  describe('Error handling', () => {
    test('catches handler exceptions and logs error', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      const tool: McpToolHandler = {
        definition: {
          name: 'local_start_site',
          description: 'Start site',
          inputSchema: { type: 'object', properties: {} },
        },
        execute: jest.fn(async () => {
          throw new Error('Service unavailable');
        }),
      };
      registry.register(tool);

      const result = await registry.call('local_start_site', {}, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Service unavailable');

      const entries = logger.getEntries();
      expect(entries[0].result).toBe('error');
      expect(entries[0].error).toBe('Service unavailable');
    });

    test('works without audit logger', async () => {
      const services = { ...mockServices, auditLogger: undefined } as unknown as NexusServices;
      const registry = new ToolRegistry();
      registry.register(makeTool('local_list_sites'));

      // Should not throw
      const result = await registry.call('local_list_sites', {}, services);
      expect(result.content[0].text).toBe('executed local_list_sites');
    });
  });

  describe('Backward compatibility', () => {
    test('existing tools without tier overrides default to Tier 2', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      registry.register(makeTool('search_content'));

      await registry.call('search_content', { query: 'test' }, services);

      const entries = logger.getEntries();
      expect(entries[0].tier).toBe(2);
    });

    test('unknown tool returns error without audit log', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      const result = await registry.call('nonexistent', {}, services);

      expect(result.isError).toBe(true);
      expect(logger.getEntries()).toHaveLength(0);
    });

    test('unavailable tool returns error without audit log', async () => {
      const logger = createAuditLogger();
      const services = { ...mockServices, auditLogger: logger } as unknown as NexusServices;

      const registry = new ToolRegistry();
      registry.register(makeTool('gated_tool', { available: false }));

      const result = await registry.call('gated_tool', {}, services);

      expect(result.isError).toBe(true);
      expect(logger.getEntries()).toHaveLength(0);
    });
  });
});
