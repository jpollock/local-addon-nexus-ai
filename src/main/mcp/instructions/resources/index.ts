import * as fs from 'fs';
import * as path from 'path';
import { InstructionRegistry } from '../index';
import type { RegistryStorage } from '../../../content/IndexRegistry';
import { STORAGE_KEYS } from '../../../../common/constants';

interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  file: string;
}

const RESOURCES: ResourceDef[] = [
  {
    uri: 'nexus://guide/getting-started',
    name: 'Getting Started',
    description: 'Tool overview, discovery-first principle, and module guide',
    file: 'getting-started.md',
  },
  {
    uri: 'nexus://guide/safety',
    name: 'Safety System',
    description: '3-tier safety system, confirmation tokens, and audit logging',
    file: 'safety-guide.md',
  },
  {
    uri: 'nexus://guide/remote-wp-cli',
    name: 'Remote WP-CLI',
    description: 'Local vs remote execution, SSH setup, and blocked commands',
    file: 'remote-wp-cli.md',
  },
  {
    uri: 'nexus://guide/workflows/site-setup',
    name: 'Workflow: Site Setup',
    description: 'Step-by-step guide for creating a new local WordPress site',
    file: 'workflows/site-setup.md',
  },
  {
    uri: 'nexus://guide/workflows/wpe-sync',
    name: 'Workflow: WPE Sync',
    description: 'Push and pull between local sites and WP Engine environments',
    file: 'workflows/wpe-sync.md',
  },
  {
    uri: 'nexus://guide/workflows/content-search',
    name: 'Workflow: Content Search',
    description: 'Index WordPress content and search with natural language queries',
    file: 'workflows/content-search.md',
  },
];

export function registerResources(
  registry: InstructionRegistry,
  storage?: RegistryStorage,
): void {
  const resourceDir = __dirname;

  // Static markdown guide resources
  for (const def of RESOURCES) {
    const filePath = path.join(resourceDir, def.file);
    registry.registerResource({
      uri: def.uri,
      name: def.name,
      description: def.description,
      mimeType: 'text/markdown',
      read: async () => {
        const text = fs.readFileSync(filePath, 'utf-8');
        return { text, mimeType: 'text/markdown' };
      },
    });
  }

  // Dynamic fleet state resource — reads from WPE sync cache at request time.
  // Use this before any WPE workflow to get install names, IDs, and local links
  // without making tool calls.
  if (storage) {
    registry.registerResource({
      uri: 'nexus://fleet/state',
      name: 'Fleet State',
      description: 'Current WPE installs and local sites with IDs and links — read before any WPE workflow',
      mimeType: 'text/markdown',
      read: async () => {
        const text = buildFleetSnapshot(storage);
        return { text, mimeType: 'text/markdown' };
      },
    });
  }
}

/**
 * Build a compact fleet snapshot string suitable for injecting into MCP
 * initialize instructions. Returns null if no useful data is available.
 * Called by McpServer at session-connect time so Claude has fleet context
 * from message 1 without any discovery tool calls.
 */
export function buildFleetSnapshotForInstructions(storage: RegistryStorage): string | null {
  const snapshot = buildFleetSnapshot(storage);
  // Only inject if there's real data (not just the fallback message)
  if (snapshot.includes('Not yet cached') && !snapshot.includes('|')) return null;
  return snapshot;
}

/**
 * Build a compact fleet snapshot from cached storage.
 * Used by the nexus://fleet/state resource AND injected into initialize instructions.
 *
 * NOTE: WPE install data (install_name, install_id, environment) is cached
 * after CAPI sync runs. Local site data comes from the index registry.
 */
function buildFleetSnapshot(storage: RegistryStorage): string {
  const lines: string[] = ['# Fleet State (from local cache)\n'];

  try {
    // WPE installs from CAPI sync cache (written by WPESyncService.syncFromCAPI)
    const wpeCache = storage.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs: any[]; syncedAt: number } | null;
    if (wpeCache?.installs?.length) {
      const ageMin = Math.round((Date.now() - wpeCache.syncedAt) / 60000);
      lines.push(`## WP Engine Installs (${wpeCache.installs.length} installs, synced ${ageMin}m ago)\n`);
      lines.push('| install_name | install_id | environment | primary_domain | account |');
      lines.push('|---|---|---|---|---|');
      for (const i of wpeCache.installs) {
        lines.push(`| ${i.installName} | ${i.installId} | ${i.environment} | ${i.primaryDomain} | ${i.accountName || '—'} |`);
      }
      lines.push('');
      lines.push('_Use install_name as `install_name=` in wp_* tools for remote WP-CLI execution._');
      lines.push('_Use install_id as `remote_install_id=` in local_wpe_pull / local_wpe_push._\n');
    } else {
      lines.push('## WP Engine Installs\n');
      lines.push('_Not yet cached. Run nexus_list_sites to trigger a sync._\n');
    }

    // Local sites from index registry (populated by content indexing)
    const indexRegistry = (storage.get(STORAGE_KEYS.INDEX_REGISTRY) ?? {}) as Record<string, any>;
    // AI setup state per site
    const siteAiConfig = (storage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
    // Site metadata (WP version, active theme)
    const siteMetadata = (storage.get(STORAGE_KEYS.SITE_METADATA) ?? {}) as Record<string, any>;

    const localEntries = Object.entries(indexRegistry)
      .filter(([, v]: [string, any]) => v?.siteName && v.siteName !== '')
      .map(([siteId, v]: [string, any]) => {
        const meta = siteMetadata[siteId] ?? {};
        const aiCfg = siteAiConfig[siteId] ?? null;
        return {
          siteId,
          siteName: v.siteName as string,
          wpVersion: meta.wpVersion || '—',
          hasAI: !!aiCfg,
          provider: aiCfg?.provider || '—',
          useGateway: aiCfg?.useLocalGateway ? 'yes' : '—',
          docCount: v.documentCount ?? 0,
        };
      })
      .sort((a, b) => a.siteName.localeCompare(b.siteName));

    if (localEntries.length > 0) {
      lines.push('## Local Sites (indexed)\n');
      lines.push('| site_name | site_id | wp_version | ai_configured | provider | gateway |');
      lines.push('|---|---|---|---|---|---|');
      for (const e of localEntries) {
        lines.push(`| ${e.siteName} | ${e.siteId} | ${e.wpVersion} | ${e.hasAI ? 'yes' : 'no'} | ${e.provider} | ${e.useGateway} |`);
      }
      lines.push('');
      lines.push(`_${localEntries.length} local sites indexed. Use site_name as \`site=\` in wp_* tools._`);
      lines.push('_Run nexus_list_sites for running/halted status and WPE environment links._');
    } else {
      lines.push('## Local Sites\n');
      lines.push('_No indexed sites. Run nexus_list_sites to discover sites._');
    }

  } catch {
    lines.push('_Fleet state unavailable — run nexus_list_sites._');
  }

  return lines.join('\n');
}
