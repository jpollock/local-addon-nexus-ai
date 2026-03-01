import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ExtractedPost, IndexEntry } from '../../../src/common/types';
import type { SiteDataAccessor, LocalSiteInfo } from '../../../src/main/mcp/types';

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

export function loadPosts(name: string): ExtractedPost[] {
  const filePath = path.join(FIXTURE_DIR, 'posts', `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadSiteFixture(name: string): Record<string, LocalSiteInfo> {
  const filePath = path.join(FIXTURE_DIR, 'sites', `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadSiteData(name: string): SiteDataAccessor {
  if (name === 'local-sites-json') {
    // Load from real Local sites.json
    const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
    const sitesJsonPath = path.join(localDataDir, 'sites.json');
    if (!fs.existsSync(sitesJsonPath)) {
      throw new Error(`sites.json not found at ${sitesJsonPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(sitesJsonPath, 'utf-8'));
    const sites: Record<string, LocalSiteInfo> = {};
    for (const [id, data] of Object.entries(raw) as [string, any][]) {
      sites[id] = {
        id,
        name: data.name || id,
        path: data.path || '',
        domain: data.domain || '',
      };
    }
    return {
      getSite: (id: string) => sites[id] ?? null,
      getSites: () => sites,
    };
  }

  const sites = loadSiteFixture(name);
  return {
    getSite: (id: string) => sites[id] ?? null,
    getSites: () => sites,
  };
}

export function loadRegistryEntries(name: string): Record<string, IndexEntry> {
  const filePath = path.join(FIXTURE_DIR, 'registry', `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Create a SiteDataAccessor from inline site definitions.
 */
export function createSiteData(sites: Record<string, LocalSiteInfo>): SiteDataAccessor {
  return {
    getSite: (id: string) => sites[id] ?? null,
    getSites: () => sites,
  };
}
