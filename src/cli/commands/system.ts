/**
 * nexus system status
 *
 * Programmatic inspection of all four data stores for all local sites.
 * Returns machine-readable JSON or a human-readable table.
 *
 * Used by e2e tests to verify state after operations without opening the UI.
 */
import { Command } from 'commander';
import { getClient } from '../utils/graphql';

async function getSystemStatus(ipcInvoke: (channel: string, ...args: any[]) => Promise<any>) {
  const [sites, indexEntries] = await Promise.all([
    ipcInvoke('nexus-ai:get-sites'),
    ipcInvoke('nexus-ai:get-fleet-status'),
  ]);

  const localSites: any[] = Array.isArray(sites)
    ? sites.filter((s: any) => s.source !== 'wpe')
    : (sites?.local ?? []);

  const indexMap = new Map<string, any>();
  if (Array.isArray(indexEntries)) {
    indexEntries.forEach((e: any) => indexMap.set(e.siteId, e));
  }

  // Fetch metadata for each site in parallel
  const metaResults = await Promise.all(
    localSites.map(async (site: any) => {
      try {
        const res = await ipcInvoke('nexus-ai:metadata:get', site.id);
        return { siteId: site.id, metadata: res?.metadata?.metadata ?? null, ageString: res?.ageString ?? null };
      } catch {
        return { siteId: site.id, metadata: null, ageString: null };
      }
    }),
  );

  const metaMap = new Map<string, any>();
  metaResults.forEach(r => metaMap.set(r.siteId, r));

  return localSites.map((site: any) => {
    const entry   = indexMap.get(site.id);
    const metaRes = metaMap.get(site.id);
    const meta    = metaRes?.metadata;

    return {
      siteId:        site.id,
      siteName:      site.name,
      siteStatus:    site.status,
      // Content Index (IndexRegistry)
      indexState:    entry?.state ?? 'idle',
      documentCount: entry?.documentCount ?? 0,
      chunkCount:    entry?.chunkCount ?? 0,
      lastIndexed:   entry?.lastIndexed ?? null,
      indexErrors:   entry?.errors ?? [],
      // Metadata Cache (SiteMetadataCache)
      metaCached:    !!meta,
      wpVersion:     meta?.wpVersion ?? null,
      phpVersion:    meta?.phpVersion ?? null,
      pluginCount:   meta?.plugins?.length ?? null,
      postCount:     meta?.postCount ?? null,
      metaUpdatedAt: meta?.lastUpdated ?? null,
      metaSource:    meta?.updateSource ?? null,
      metaAge:       metaRes?.ageString ?? null,
    };
  });
}

export const systemCommand = new Command('system')
  .description('Inspect data store state across all local sites');

systemCommand
  .command('status')
  .description('Show content index + metadata cache state for all local sites')
  .option('--json', 'Output as JSON (machine-readable)')
  .option('--site <name>', 'Filter to a specific site by name')
  .action(async (options) => {
    try {
      // Use GraphQL client to reach the addon (same as all other CLI commands)
      const client = getClient();

      // We need IPC access — use a GraphQL mutation that proxies to IPC
      // For now, use nexusSitesList which gives us sites + index state
      const listResult = await client.mutate<{ nexusSitesList: any }>(`
        mutation {
          nexusSitesList {
            local {
              id
              name
              status
              phpVersion
              wpVersion
              indexState
              documentCount
              chunkCount
              lastIndexed
              pluginCount
              postCount
              metaUpdatedAt
              metaAge
              metaSource
            }
          }
        }
      `, {});

      let sites = listResult.nexusSitesList?.local ?? [];
      if (options.site) {
        sites = sites.filter((s: any) => s.name === options.site || s.id === options.site);
      }
      // local[] is already local-only

      if (options.json) {
        console.log(JSON.stringify(sites, null, 2));
        return;
      }

      // Human-readable table
      const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
      console.log('\nNexus AI — System Status\n');
      console.log(
        col('Site', 20) +
        col('Status', 9) +
        col('Index', 10) +
        col('Docs', 7) +
        col('WP', 10) +
        col('PHP', 8) +
        col('Plugins', 8) +
        'Meta age'
      );
      console.log('─'.repeat(82));

      sites.forEach((s: any) => {
        const indexMark = s.indexState === 'indexed' ? '✓' : s.indexState === 'indexing' ? '…' : s.indexState === 'error' ? '✗' : '—';
        const metaMark  = s.wpVersion ? `${s.wpVersion ?? '?'}` : '—';
        console.log(
          col(s.name, 20) +
          col(s.status ?? '?', 9) +
          col(`${indexMark} ${s.indexState ?? 'idle'}`, 10) +
          col(s.documentCount ? String(s.documentCount) : '—', 7) +
          col(metaMark, 10) +
          col(s.phpVersion ?? '—', 8) +
          col(s.pluginCount != null ? String(s.pluginCount) : '—', 8) +
          (s.metaAge ?? '—')
        );
      });
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
