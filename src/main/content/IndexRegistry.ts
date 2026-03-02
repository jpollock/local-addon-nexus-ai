import { IndexEntry, SiteStructure } from '../../common/types';
import { STORAGE_KEYS } from '../../common/constants';

/**
 * Callback type for persisting data via Local's userData.
 * In production, this wraps userData.get/set.
 * In tests, it can be backed by a simple Map.
 */
export interface RegistryStorage {
  get(key: string): any;
  set(key: string, value: any): void;
}

/**
 * Tracks per-site indexing state. Persists via Local's userData.
 */
export class IndexRegistry {
  private storage: RegistryStorage;
  private data: Record<string, IndexEntry>;

  constructor(storage: RegistryStorage) {
    this.storage = storage;
    this.data = storage.get(STORAGE_KEYS.INDEX_REGISTRY) ?? {};
  }

  get(siteId: string): IndexEntry | null {
    return this.data[siteId] ?? null;
  }

  update(siteId: string, partial: Partial<IndexEntry>): void {
    const existing = this.data[siteId] ?? this.emptyEntry(siteId);
    this.data[siteId] = { ...existing, ...partial };
    this.persist();
  }

  remove(siteId: string): void {
    delete this.data[siteId];
    this.persist();
  }

  listAll(): IndexEntry[] {
    return Object.values(this.data);
  }

  private emptyEntry(siteId: string): IndexEntry {
    return {
      siteId,
      siteName: '',
      lastIndexed: 0,
      documentCount: 0,
      chunkCount: 0,
      durationMs: 0,
      structure: null,
      state: 'indexing',
    };
  }

  private persist(): void {
    this.storage.set(STORAGE_KEYS.INDEX_REGISTRY, this.data);
  }
}
