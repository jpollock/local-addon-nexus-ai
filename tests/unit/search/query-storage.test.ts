/**
 * Unit tests for QueryStorage
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QueryStorage } from '../../../src/main/search/QueryStorage';

describe('QueryStorage', () => {
  let storage: QueryStorage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-storage-test-'));
    storage = new QueryStorage(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('save creates new query with generated ID', async () => {
    const query = await storage.save({
      name: 'Test Query',
      description: 'A test query',
      filters: { searchText: 'hello' },
      pinned: false,
    });

    expect(query.id).toMatch(/^query-\d+-[a-z0-9]+$/);
    expect(query.name).toBe('Test Query');
    expect(query.description).toBe('A test query');
    expect(query.filters.searchText).toBe('hello');
    expect(query.createdAt).toBeGreaterThan(0);
    expect(query.lastRun).toBeNull();
    expect(query.resultCount).toBe(0);
    expect(query.pinned).toBe(false);

    // Verify it was written to disk
    const filePath = path.join(tmpDir, 'saved-queries.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('list returns queries sorted (pinned first, then by createdAt desc)', async () => {
    // Save queries then set distinct createdAt via update to guarantee ordering
    const q1 = await storage.save({ name: 'First', filters: {}, pinned: false });
    await storage.update(q1.id, { createdAt: 1000 });
    const q2 = await storage.save({ name: 'Second', filters: {}, pinned: false });
    await storage.update(q2.id, { createdAt: 2000 });
    const q3 = await storage.save({ name: 'Pinned', filters: {}, pinned: true });
    await storage.update(q3.id, { createdAt: 3000 });

    const list = storage.list();

    expect(list.length).toBe(3);
    // Pinned should be first
    expect(list[0].name).toBe('Pinned');
    // Then most recent non-pinned first
    expect(list[1].name).toBe('Second');
    expect(list[2].name).toBe('First');
  });

  test('update modifies existing query', async () => {
    const query = await storage.save({
      name: 'Original',
      filters: { searchText: 'test' },
      pinned: false,
    });

    const updated = await storage.update(query.id, {
      name: 'Updated',
      pinned: true,
      lastRun: Date.now(),
      resultCount: 42,
    });

    expect(updated.name).toBe('Updated');
    expect(updated.pinned).toBe(true);
    expect(updated.resultCount).toBe(42);
    expect(updated.id).toBe(query.id); // ID should not change
    expect(updated.filters.searchText).toBe('test'); // Unchanged fields preserved
  });

  test('delete removes query', async () => {
    const q1 = await storage.save({ name: 'Keep', filters: {}, pinned: false });
    const q2 = await storage.save({ name: 'Delete', filters: {}, pinned: false });

    await storage.delete(q2.id);

    const list = storage.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Keep');
    expect(storage.get(q2.id)).toBeUndefined();
  });

  test('get returns query by ID', async () => {
    const query = await storage.save({
      name: 'Find Me',
      filters: { contentTypes: ['plugin'] },
      pinned: false,
    });

    const found = storage.get(query.id);

    expect(found).toBeDefined();
    expect(found!.name).toBe('Find Me');
    expect(found!.filters.contentTypes).toEqual(['plugin']);
  });

  test('get returns undefined for non-existent ID', () => {
    const result = storage.get('query-nonexistent-abc1234');
    expect(result).toBeUndefined();
  });

  test('handles missing storage file gracefully (load does not throw)', async () => {
    const missingDir = path.join(tmpDir, 'nonexistent', 'subdir');
    const freshStorage = new QueryStorage(missingDir);

    // load should not throw even if file doesn't exist
    await expect(freshStorage.load()).resolves.not.toThrow();

    // Should have empty list
    expect(freshStorage.list()).toEqual([]);
  });
});
