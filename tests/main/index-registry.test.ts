import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';
import { IndexEntry } from '../../src/common/types';
import { STORAGE_KEYS } from '../../src/common/constants';

function createMockStorage(initial?: Record<string, IndexEntry>): RegistryStorage {
  const store = new Map<string, any>();
  if (initial) {
    store.set(STORAGE_KEYS.INDEX_REGISTRY, initial);
  }
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

describe('IndexRegistry', () => {
  test('returns null for unknown site', () => {
    const registry = new IndexRegistry(createMockStorage());
    expect(registry.get('unknown')).toBeNull();
  });

  test('updates and retrieves an entry', () => {
    const registry = new IndexRegistry(createMockStorage());
    registry.update('site1', {
      siteName: 'My Site',
      state: 'indexed',
      documentCount: 10,
      chunkCount: 15,
      lastIndexed: 1000,
      durationMs: 500,
    });

    const entry = registry.get('site1');
    expect(entry).not.toBeNull();
    expect(entry!.siteName).toBe('My Site');
    expect(entry!.state).toBe('indexed');
    expect(entry!.documentCount).toBe(10);
  });

  test('merges partial updates', () => {
    const registry = new IndexRegistry(createMockStorage());
    registry.update('site1', { siteName: 'Site', state: 'indexing' });
    registry.update('site1', { state: 'indexed', documentCount: 5 });

    const entry = registry.get('site1')!;
    expect(entry.siteName).toBe('Site');
    expect(entry.state).toBe('indexed');
    expect(entry.documentCount).toBe(5);
  });

  test('removes an entry', () => {
    const registry = new IndexRegistry(createMockStorage());
    registry.update('site1', { siteName: 'Site', state: 'indexed' });
    registry.remove('site1');

    expect(registry.get('site1')).toBeNull();
  });

  test('lists all entries', () => {
    const registry = new IndexRegistry(createMockStorage());
    registry.update('a', { siteName: 'A', state: 'indexed' });
    registry.update('b', { siteName: 'B', state: 'indexing' });

    const all = registry.listAll();
    expect(all.length).toBe(2);
    expect(all.map((e) => e.siteName).sort()).toEqual(['A', 'B']);
  });

  test('persists to storage on every mutation', () => {
    const storage = createMockStorage();
    const registry = new IndexRegistry(storage);

    registry.update('site1', { siteName: 'Site', state: 'indexed' });
    const persisted = storage.get(STORAGE_KEYS.INDEX_REGISTRY)!;
    expect(persisted.site1).toBeDefined();
    expect(persisted.site1.siteName).toBe('Site');
  });

  test('loads from existing storage data', () => {
    const initial: Record<string, IndexEntry> = {
      existing: {
        siteId: 'existing',
        siteName: 'Existing',
        lastIndexed: 500,
        documentCount: 3,
        chunkCount: 5,
        durationMs: 200,
        structure: null,
        state: 'indexed',
      },
    };
    const registry = new IndexRegistry(createMockStorage(initial));

    const entry = registry.get('existing');
    expect(entry).not.toBeNull();
    expect(entry!.siteName).toBe('Existing');
  });
});
