/**
 * External SSH host adapters for BulkOperationManager.
 *
 * These are the same two operations `nexus host refresh` and `nexus host index`
 * perform, scoped to ONE registered site rather than iterating a whole
 * connection. The resolvers (`nexusHostRefresh` / `nexusHostIndex`) fan out over
 * every site on an alias; a selection-scoped bulk action already knows exactly
 * which sites the user ticked, so it must not widen that to the connection.
 */
import { resolveTransport } from '../transport';
import { collectExternalHostData } from '../startup/collectExternalHostData';
import { writeExternalHostData } from '../startup/writeExternalHostData';
import { ExternalContentIndexService } from '../events/ExternalContentIndexService';
import { ensureContentIndexedAtColumn } from '../startup/ExternalContentIndexScheduler';
import type { SiteOpOutcome } from './types';

interface ExternalRow {
  id: string;
  name: string;
  environment: string | null;
}

/**
 * Look the row up by id rather than by alias.
 *
 * `findExternalSites` filters on `account_id`, which is NULL on the bare
 * `ssh:<alias>` row (measured: 1 of 3 rows on a real machine), so an
 * alias-keyed lookup silently misses it. The id is present on every row by
 * definition and is what the caller holds.
 */
function findById(db: any, siteId: string): ExternalRow | null {
  if (!db) return null;
  try {
    return db.prepare(
      "SELECT id, name, environment FROM sites WHERE id = ? AND source = 'external' AND is_active = 1",
    ).get(siteId) as ExternalRow | undefined ?? null;
  } catch {
    return null;
  }
}

/**
 * A site id IS the target, minus the environment suffix:
 * `ssh:<alias>/<site>` + `@<env>`, or `ssh:<alias>` + `@<env>` for the bare
 * single-site form. Both are legal target syntax, so this needs no
 * reconstruction from parts — which is what made `account_id` being NULL a
 * problem for the alias-keyed path.
 *
 * `resolveTransport` gates writes on the more restrictive of this suffix and
 * the registered label, so passing the row's own environment cannot loosen it.
 */
async function openTransport(services: any, row: ExternalRow): Promise<any> {
  const target = `${row.id}@${row.environment ?? 'production'}`;
  const transport = await resolveTransport({ ssh_target: target }, services, 'wpcli_read');
  // resolveTransport signals refusal by returning an MCP-shaped content payload
  // rather than throwing. Same check the resolvers make.
  if (transport && typeof transport === 'object' && 'content' in transport) {
    const msg = (transport.content?.[0] as { text?: string } | undefined)?.text ?? 'Could not reach host';
    throw new Error(msg);
  }
  return transport;
}

export function createExternalBulkOps(services: any, logger: any) {
  return {
    async refreshSite(siteId: string, siteName: string): Promise<void> {
      const db = services.graphService?.getDb?.();
      const row = findById(db, siteId);
      if (!row) throw new Error(`"${siteName}" is not a registered external site.`);

      const transport = await openTransport(services, row);
      const data = await collectExternalHostData(transport, logger);
      // writeExternalHostData writes NULL for anything that did not parse and
      // leaves prior data alone on failure — never a fabricated default.
      await writeExternalHostData(services.graphService, row.id, row.name, data, Date.now(), logger);
    },

    async indexSite(siteId: string, siteName: string): Promise<SiteOpOutcome> {
      const db = services.graphService?.getDb?.();
      const row = findById(db, siteId);
      if (!row) throw new Error(`"${siteName}" is not a registered external site.`);

      const transport = await openTransport(services, row);
      const indexService = new ExternalContentIndexService({
        graphService: services.graphService,
        embeddingService: services.embeddingService,
        vectorStore: services.vectorStore,
        indexRegistry: services.indexRegistry,
        logger,
      });
      const { documentCount } = await indexService.indexOne(transport, row.id, row.name);

      // Stamp the staleness column the scheduler reads, so a host indexed here
      // is not redundantly re-indexed on the next cycle. The scheduler is
      // opt-in and may never have run in this process, so the column is
      // ensured rather than assumed.
      //
      // Stamped for a zero-document host too: the host WAS reached and asked,
      // so the next cycle would learn nothing new by asking again. The stamp
      // records contact, which is a separate question from whether there was
      // anything to index.
      try {
        if (ensureContentIndexedAtColumn(db, logger)) {
          db.prepare('UPDATE sites SET content_indexed_at = ? WHERE id = ?').run(Date.now(), row.id);
        }
      } catch { /* best-effort staleness stamp, matches the scheduler's tolerance */ }

      // `indexOne` marks a zero-post host 'indexed' and returns a count of
      // zero — the same shape as WP Engine's zero-post exit, and the same
      // reason it must not be reported as a success.
      return documentCount === 0
        ? { ran: false, reason: 'No content returned by the extractor' }
        : { ran: true };
    },
  };
}
