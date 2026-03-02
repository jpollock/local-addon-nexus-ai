import { createTestRegistry } from './helpers/registry-harness';

describe('Resource Quality', () => {
  const registry = createTestRegistry();
  const resources = registry.listResources();

  it('registers at least 6 resources', () => {
    expect(resources.length).toBeGreaterThanOrEqual(6);
  });

  it('all URIs use the nexus:// scheme', () => {
    for (const r of resources) {
      expect(r.uri).toMatch(/^nexus:\/\//);
    }
  });

  it('all resources have non-empty descriptions', () => {
    for (const r of resources) {
      expect(r.description.length).toBeGreaterThan(10);
    }
  });

  it('all resources have mimeType text/markdown', () => {
    for (const r of resources) {
      expect(r.mimeType).toBe('text/markdown');
    }
  });

  describe.each(
    resources.map((r) => [r.uri, r]),
  )('resource: %s', (uri) => {
    it('is readable and returns non-empty content', async () => {
      const content = await registry.readResource(uri as string);
      expect(content).not.toBeNull();
      expect(content!.text.length).toBeGreaterThan(100);
      expect(content!.mimeType).toBe('text/markdown');
    });

    it('content has markdown headings', async () => {
      const content = await registry.readResource(uri as string);
      expect(content!.text).toMatch(/^#/m);
    });
  });

  // Specific resource checks

  it('getting-started guide mentions discovery', async () => {
    const content = await registry.readResource('nexus://guide/getting-started');
    expect(content).not.toBeNull();
    expect(content!.text).toMatch(/discover/i);
    expect(content!.text).toContain('local_list_sites');
  });

  it('safety guide covers all 3 tiers', async () => {
    const content = await registry.readResource('nexus://guide/safety');
    expect(content).not.toBeNull();
    expect(content!.text).toMatch(/tier\s*1/i);
    expect(content!.text).toMatch(/tier\s*2/i);
    expect(content!.text).toMatch(/tier\s*3/i);
  });

  it('safety guide explains confirmation tokens', async () => {
    const content = await registry.readResource('nexus://guide/safety');
    expect(content!.text).toMatch(/confirm.*token/i);
  });

  it('remote-wp-cli guide explains both execution modes', async () => {
    const content = await registry.readResource('nexus://guide/remote-wp-cli');
    expect(content).not.toBeNull();
    expect(content!.text).toContain('install_name');
    expect(content!.text).toMatch(/\bsite\b/);
    expect(content!.text).toMatch(/blocked/i);
  });

  it('returns null for unknown URI', async () => {
    const content = await registry.readResource('nexus://nonexistent');
    expect(content).toBeNull();
  });
});
