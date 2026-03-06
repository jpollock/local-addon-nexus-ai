/**
 * GroupStorage - JSON file-based persistence for site groups.
 *
 * Stores manual and dynamic site groups to disk so users can
 * organize their fleet across sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SiteGroup } from './types';

export class GroupStorage {
  private groups = new Map<string, SiteGroup>();
  private filePath: string;
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.filePath = path.join(storagePath, 'nexus-ai-groups.json');
  }

  /**
   * Load groups from disk. If the file doesn't exist, starts with empty state.
   */
  async load(): Promise<void> {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.groups = new Map();

      if (Array.isArray(parsed)) {
        for (const group of parsed) {
          if (group && typeof group.id === 'string') {
            this.groups.set(group.id, group);
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid - start fresh
      this.groups = new Map();
    }
  }

  /**
   * Atomic write: write to .tmp file, then rename. Create dir if needed.
   */
  persist(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.groups.values()), null, 2);
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Silently fail - storage is best-effort
    }
  }

  /**
   * Create a new static site group.
   */
  create(name: string, color: string, description?: string): SiteGroup {
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const group: SiteGroup = {
      id,
      name,
      color,
      description: description || '',
      siteIds: [],
      isDynamic: false,
      createdAt: now,
      updatedAt: now,
    };

    this.groups.set(id, group);
    this.persist();
    return group;
  }

  /**
   * Update a static group's name, color, or description.
   * Returns null if group not found or is dynamic.
   */
  update(id: string, changes: Partial<Pick<SiteGroup, 'name' | 'color' | 'description'>>): SiteGroup | null {
    const group = this.groups.get(id);
    if (!group || group.isDynamic) {
      return null;
    }

    const updated: SiteGroup = {
      ...group,
      ...changes,
      id,
      updatedAt: Date.now(),
    };

    this.groups.set(id, updated);
    this.persist();
    return updated;
  }

  /**
   * Delete a static group. Returns false if not found or is dynamic.
   */
  delete(id: string): boolean {
    const group = this.groups.get(id);
    if (!group || group.isDynamic) {
      return false;
    }

    this.groups.delete(id);
    this.persist();
    return true;
  }

  /**
   * Add a site to a static group. Idempotent - returns true if already present.
   * Returns false if group not found or is dynamic.
   */
  addSite(groupId: string, siteId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.isDynamic) {
      return false;
    }

    if (group.siteIds.includes(siteId)) {
      return true;
    }

    group.siteIds.push(siteId);
    group.updatedAt = Date.now();
    this.persist();
    return true;
  }

  /**
   * Remove a site from a static group. Returns false if group not found or is dynamic.
   */
  removeSite(groupId: string, siteId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.isDynamic) {
      return false;
    }

    group.siteIds = group.siteIds.filter((id) => id !== siteId);
    group.updatedAt = Date.now();
    this.persist();
    return true;
  }

  /**
   * Get a single group by ID.
   */
  get(id: string): SiteGroup | null {
    return this.groups.get(id) || null;
  }

  /**
   * List all groups sorted: isDynamic first, then alphabetical by name.
   */
  list(): SiteGroup[] {
    const all = Array.from(this.groups.values());
    return all.sort((a, b) => {
      if (a.isDynamic && !b.isDynamic) return -1;
      if (!a.isDynamic && b.isDynamic) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get all groups that contain the given siteId.
   */
  getGroupsForSite(siteId: string): SiteGroup[] {
    return Array.from(this.groups.values()).filter((group) =>
      group.siteIds.includes(siteId)
    );
  }
}
