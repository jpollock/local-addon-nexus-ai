/**
 * Site Metadata Cache
 *
 * Digital twin for WordPress sites - caches runtime state (WP version, plugins, themes)
 * so the UI remains responsive when sites are slow/halted or WP-CLI times out.
 *
 * Persistence model:
 * - Cached data survives Local restarts
 * - Updated on site start (lifecycle hook)
 * - Updated after Setup AI (plugin installations)
 * - Shows age ("as of 2 minutes ago")
 * - Falls back to live WP-CLI when cache is stale
 */

import type { RegistryStorage } from '../content/IndexRegistry';
import { STORAGE_KEYS } from '../../common/constants';

export interface WpPluginMetadata {
  name: string;           // "ai"
  title: string;          // "AI"
  version: string;        // "0.6.0"
  status: 'active' | 'inactive';
  file?: string;          // "ai/ai.php"
}

export interface WpThemeMetadata {
  name: string;           // "twentytwentyfour"
  title: string;          // "Twenty Twenty-Four"
  version: string;        // "1.0"
  status: 'active' | 'inactive';
}

export interface SiteMetadata {
  wpVersion: string;              // "7.0-beta6-62094"
  phpVersion?: string;            // "8.3"
  mysqlVersion?: string;          // "8.0.35"
  plugins: WpPluginMetadata[];
  themes: WpThemeMetadata[];
  activeTheme?: string;           // name of the current active theme
  siteUrl?: string;               // "http://nexus-test-site.local"
  adminEmail?: string;            // "admin@example.com"
  lastUpdated: number;            // timestamp
  updateSource: 'lifecycle' | 'manual' | 'setup-ai' | 'upgrade-wp';
}

export interface SiteMetadataWithAge extends SiteMetadata {
  ageMs: number;                  // Date.now() - lastUpdated
  isStale: boolean;               // > 24 hours old
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SiteMetadataCache {
  constructor(private storage: RegistryStorage) {}

  /**
   * Get cached metadata for a site.
   * Returns null if no cache exists.
   */
  get(siteId: string): SiteMetadata | null {
    const allMetadata = this.getAll();
    return allMetadata[siteId] ?? null;
  }

  /**
   * Get cached metadata with age calculation.
   */
  getWithAge(siteId: string): SiteMetadataWithAge | null {
    const metadata = this.get(siteId);
    if (!metadata) return null;

    const now = Date.now();
    const ageMs = now - metadata.lastUpdated;
    const isStale = ageMs > STALE_THRESHOLD_MS;

    return {
      ...metadata,
      ageMs,
      isStale,
    };
  }

  /**
   * Get all cached metadata (all sites).
   */
  getAll(): Record<string, SiteMetadata> {
    return (this.storage.get(STORAGE_KEYS.SITE_METADATA) ?? {}) as Record<string, SiteMetadata>;
  }

  /**
   * Set metadata for a site.
   */
  set(siteId: string, metadata: Omit<SiteMetadata, 'lastUpdated'>): void {
    const allMetadata = this.getAll();
    allMetadata[siteId] = {
      ...metadata,
      lastUpdated: Date.now(),
    };
    this.storage.set(STORAGE_KEYS.SITE_METADATA, allMetadata);
  }

  /**
   * Update metadata for a site.
   * Only updates specified fields, preserves others.
   */
  update(siteId: string, partial: Partial<Omit<SiteMetadata, 'lastUpdated'>>): void {
    const existing = this.get(siteId);
    if (!existing) {
      throw new Error(`Cannot update metadata for ${siteId}: no cached data exists`);
    }

    const allMetadata = this.getAll();
    allMetadata[siteId] = {
      ...existing,
      ...partial,
      lastUpdated: Date.now(),
    };
    this.storage.set(STORAGE_KEYS.SITE_METADATA, allMetadata);
  }

  /**
   * Invalidate (delete) metadata for a site.
   * Call when site is deleted.
   */
  invalidate(siteId: string): void {
    const allMetadata = this.getAll();
    delete allMetadata[siteId];
    this.storage.set(STORAGE_KEYS.SITE_METADATA, allMetadata);
  }

  /**
   * Check if cached data is stale (> 24 hours old).
   */
  isStale(siteId: string): boolean {
    const metadata = this.get(siteId);
    if (!metadata) return true; // No cache = stale

    const ageMs = Date.now() - metadata.lastUpdated;
    return ageMs > STALE_THRESHOLD_MS;
  }

  /**
   * Get human-readable age string.
   * "Just now", "2m ago", "3h ago", "2d ago"
   */
  getAgeString(siteId: string): string {
    const metadata = this.get(siteId);
    if (!metadata) return 'Never cached';

    const ageMs = Date.now() - metadata.lastUpdated;
    const seconds = Math.floor(ageMs / 1000);

    if (seconds < 60) return 'Just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  /**
   * Clear all cached metadata.
   * Useful for debugging.
   */
  clear(): void {
    this.storage.set(STORAGE_KEYS.SITE_METADATA, {});
  }
}
