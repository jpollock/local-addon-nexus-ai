/**
 * Unit tests for GroupStorage
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GroupStorage } from '../../../src/main/groups/GroupStorage';
import type { SiteGroup } from '../../../src/main/groups/types';

describe('GroupStorage', () => {
  let storage: GroupStorage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-storage-test-'));
    storage = new GroupStorage(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('create group returns SiteGroup with correct fields', () => {
    const group = storage.create('Production', '#ff0000', 'Prod sites');

    expect(group.name).toBe('Production');
    expect(group.color).toBe('#ff0000');
    expect(group.description).toBe('Prod sites');
    expect(group.siteIds).toEqual([]);
    expect(group.isDynamic).toBe(false);
    expect(group.createdAt).toBeGreaterThan(0);
    expect(group.updatedAt).toBeGreaterThan(0);
  });

  test('create generates unique ID starting with group-', () => {
    const g1 = storage.create('Group A', '#000');
    const g2 = storage.create('Group B', '#111');

    expect(g1.id).toMatch(/^group-\d+-[a-z0-9]+$/);
    expect(g2.id).toMatch(/^group-\d+-[a-z0-9]+$/);
    expect(g1.id).not.toBe(g2.id);
  });

  test('list returns sorted: dynamic first, then alphabetical', () => {
    const staticB = storage.create('Bravo', '#000');
    const staticA = storage.create('Alpha', '#111');

    // Manually insert a dynamic group
    const dynamicGroup: SiteGroup = {
      id: 'group-dynamic-1',
      name: 'Zulu Dynamic',
      color: '#222',
      description: '',
      siteIds: [],
      isDynamic: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Access internal map via get/create workaround: load from file
    // Instead, write directly to file and reload
    const filePath = path.join(tmpDir, 'nexus-ai-groups.json');
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    existing.push(dynamicGroup);
    fs.writeFileSync(filePath, JSON.stringify(existing), 'utf-8');

    // Reload to pick up the dynamic group
    const freshStorage = new GroupStorage(tmpDir);
    return freshStorage.load().then(() => {
      const list = freshStorage.list();

      expect(list.length).toBe(3);
      // Dynamic first
      expect(list[0].name).toBe('Zulu Dynamic');
      expect(list[0].isDynamic).toBe(true);
      // Then alphabetical
      expect(list[1].name).toBe('Alpha');
      expect(list[2].name).toBe('Bravo');
    });
  });

  test('update changes name and color', () => {
    const group = storage.create('Old Name', '#000');

    const updated = storage.update(group.id, { name: 'New Name', color: '#fff' });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('New Name');
    expect(updated!.color).toBe('#fff');
    expect(updated!.id).toBe(group.id);
  });

  test('update sets updatedAt to current time', () => {
    const group = storage.create('Test', '#000');
    const originalUpdatedAt = group.updatedAt;

    // Small delay to ensure timestamp differs
    const before = Date.now();
    const updated = storage.update(group.id, { name: 'Updated' });
    const after = Date.now();

    expect(updated).not.toBeNull();
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(before);
    expect(updated!.updatedAt).toBeLessThanOrEqual(after);
  });

  test('delete removes group from list', () => {
    const g1 = storage.create('Keep', '#000');
    const g2 = storage.create('Remove', '#111');

    const result = storage.delete(g2.id);

    expect(result).toBe(true);
    expect(storage.list().length).toBe(1);
    expect(storage.get(g2.id)).toBeNull();
    expect(storage.get(g1.id)).not.toBeNull();
  });

  test('cannot delete dynamic group (returns false)', async () => {
    // Create a dynamic group via file manipulation
    const dynamicGroup: SiteGroup = {
      id: 'group-dynamic-delete',
      name: 'Dynamic',
      color: '#000',
      description: '',
      siteIds: [],
      isDynamic: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(
      path.join(tmpDir, 'nexus-ai-groups.json'),
      JSON.stringify([dynamicGroup]),
      'utf-8'
    );

    const freshStorage = new GroupStorage(tmpDir);
    await freshStorage.load();

    const result = freshStorage.delete('group-dynamic-delete');

    expect(result).toBe(false);
    expect(freshStorage.get('group-dynamic-delete')).not.toBeNull();
  });

  test('cannot update dynamic group (returns null)', async () => {
    const dynamicGroup: SiteGroup = {
      id: 'group-dynamic-update',
      name: 'Dynamic',
      color: '#000',
      description: '',
      siteIds: [],
      isDynamic: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(
      path.join(tmpDir, 'nexus-ai-groups.json'),
      JSON.stringify([dynamicGroup]),
      'utf-8'
    );

    const freshStorage = new GroupStorage(tmpDir);
    await freshStorage.load();

    const result = freshStorage.update('group-dynamic-update', { name: 'Changed' });

    expect(result).toBeNull();
    expect(freshStorage.get('group-dynamic-update')!.name).toBe('Dynamic');
  });

  test('addSite appends siteId to group', () => {
    const group = storage.create('Test', '#000');

    const result = storage.addSite(group.id, 'site-123');

    expect(result).toBe(true);
    expect(storage.get(group.id)!.siteIds).toEqual(['site-123']);
  });

  test('addSite is idempotent (adding same siteId twice = only one entry)', () => {
    const group = storage.create('Test', '#000');

    storage.addSite(group.id, 'site-123');
    storage.addSite(group.id, 'site-123');

    expect(storage.get(group.id)!.siteIds).toEqual(['site-123']);
  });

  test('removeSite removes siteId from group', () => {
    const group = storage.create('Test', '#000');
    storage.addSite(group.id, 'site-123');
    storage.addSite(group.id, 'site-456');

    const result = storage.removeSite(group.id, 'site-123');

    expect(result).toBe(true);
    expect(storage.get(group.id)!.siteIds).toEqual(['site-456']);
  });

  test('getGroupsForSite returns all groups containing the site', () => {
    const g1 = storage.create('Group A', '#000');
    const g2 = storage.create('Group B', '#111');
    const g3 = storage.create('Group C', '#222');

    storage.addSite(g1.id, 'site-shared');
    storage.addSite(g2.id, 'site-shared');
    storage.addSite(g3.id, 'site-other');

    const groups = storage.getGroupsForSite('site-shared');

    expect(groups.length).toBe(2);
    const names = groups.map((g) => g.name).sort();
    expect(names).toEqual(['Group A', 'Group B']);
  });
});
