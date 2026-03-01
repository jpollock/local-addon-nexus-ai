import { TestHarness } from './helpers/harness';
import { createSiteData } from './helpers/fixtures';
import { expectToolError } from './helpers/assertions';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { McpAuth } from '../../src/main/mcp/McpAuth';
import type { NexusServices } from '../../src/main/mcp/types';

describe('Negative Paths — Input Validation', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    const siteData = createSiteData({
      'site-abc123': {
        id: 'site-abc123',
        name: 'Dev Blog',
        path: '/tmp/nexus-test/dev-blog',
        domain: 'dev-blog.local',
      },
    });

    harness = await TestHarness.create({
      skipServer: true,
      siteData,
      withLocalServices: true,
    });
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  test('wp_plugin_install rejects invalid slug pattern', async () => {
    const result = await harness.callTool('wp_plugin_install', {
      site: 'Dev Blog',
      slug: 'My Plugin!',
    });
    expectToolError(result, 'Invalid plugin slug');
  });

  test('local_create_site rejects empty name', async () => {
    const result = await harness.callTool('local_create_site', { name: '' });
    expectToolError(result);
  });

  test('local_create_site rejects whitespace-only name', async () => {
    const result = await harness.callTool('local_create_site', { name: '   ' });
    expectToolError(result);
  });
});

describe('Negative Paths — Service Unavailability', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    // Harness WITHOUT localServices to test tool unavailability
    harness = await TestHarness.create({ skipServer: true });
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  test('unknown tool name returns descriptive error', async () => {
    const result = await harness.callTool('completely_fake_tool', {});
    expectToolError(result, 'Unknown tool: "completely_fake_tool"');
  });

  test('calling gated tool when prerequisites not met returns error', async () => {
    // wp_plugin_list requires localServices which is not set
    const result = await harness.callTool('wp_plugin_list', { site: 'anything' });
    expectToolError(result, 'not currently available');
  });
});

describe('Negative Paths — Site Resolution', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    const siteData = createSiteData({
      'site-abc123': {
        id: 'site-abc123',
        name: 'Dev Blog',
        path: '/tmp/nexus-test/dev-blog',
        domain: 'dev-blog.local',
      },
    });

    harness = await TestHarness.create({ skipServer: true, siteData });
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  test('site resolver returns error for empty string', async () => {
    const result = await harness.callTool('search_site_content', {
      site: '',
      query: 'test',
    });
    expectToolError(result);
  });

  test('site resolver returns error for non-matching query', async () => {
    const result = await harness.callTool('get_index_status', {
      site: 'zzz-no-match-999',
    });
    expectToolError(result, 'not found');
  });
});

describe('Negative Paths — State Mismatch', () => {
  test('search_across_sites with no indexed sites returns error', async () => {
    const harness = await TestHarness.create({ skipServer: true });
    const result = await harness.callTool('search_across_sites', { query: 'test' });
    expectToolError(result, 'No sites');
    await harness.cleanup();
  }, 60000);
});

describe('Negative Paths — WP-CLI Preflight', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    const siteData = createSiteData({
      'site-abc123': {
        id: 'site-abc123',
        name: 'Dev Blog',
        path: '/tmp/nexus-test/dev-blog',
        domain: 'dev-blog.local',
      },
    });

    harness = await TestHarness.create({
      skipServer: true,
      siteData,
      localServicesConfig: {
        siteStatuses: { 'site-abc123': 'halted' },
        defaultStatus: 'halted',
      },
    });
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  test('wp_plugin_list for stopped site returns "not running" error', async () => {
    const result = await harness.callTool('wp_plugin_list', { site: 'Dev Blog' });
    expectToolError(result);
    // Should mention the site is not running
    const text = result.content[0].text.toLowerCase();
    expect(text).toMatch(/halted|not running|start/);
  });
});

describe('Negative Paths — Security', () => {
  test('McpAuth rejects non-localhost IP', () => {
    const auth = new McpAuth();
    const fakeReq = {
      socket: { remoteAddress: '192.168.1.100' },
      headers: { authorization: `Bearer ${auth.getToken()}` },
    } as any;
    const error = auth.validate(fakeReq);
    expect(error).toBe('Connection from untrusted IP: 192.168.1.100');
  });
});

describe('Negative Paths — Tool Execution Errors', () => {
  test('tool handler that throws is caught and wrapped in error result', async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'throw_tool',
        description: 'A tool that always throws',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => {
        throw new Error('kaboom');
      },
    });

    const services = {
      vectorStore: {} as any,
      embeddingService: {} as any,
      contentPipeline: {} as any,
      indexRegistry: { listAll: () => [] } as any,
      fileScanner: {} as any,
      siteData: createSiteData({}),
      logger: { info: () => {}, error: () => {} },
    } as NexusServices;

    const result = await registry.call('throw_tool', {}, services);
    expectToolError(result, 'Tool error: kaboom');
  });
});
