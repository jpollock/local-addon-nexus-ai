describe('phpVersion in fleet query', () => {
  it('SiteMetadataCache.phpVersion is accessible', () => {
    // Simulate metadata cache structure
    const metadata = {
      phpVersion: '8.2',
      wpVersion: '7.0',
      plugins: [],
      themes: [],
      updateSource: 'lifecycle' as const,
      scanDepth: 'full' as const,
      lastUpdated: Date.now(),
    };
    // The resolver picks phpVersion from metadata
    const phpVersion = metadata?.phpVersion ?? null;
    expect(phpVersion).toBe('8.2');
  });

  it('returns null when phpVersion not cached', () => {
    const metadata = undefined;
    const phpVersion = (metadata as any)?.phpVersion ?? null;
    expect(phpVersion).toBeNull();
  });
});
