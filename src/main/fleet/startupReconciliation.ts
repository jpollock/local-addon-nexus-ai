import type { SiteDataAccessor } from '../mcp/types';
import type { SiteLinkResolver } from './SiteLinkResolver';
import type { ReconcileReport } from './types';

interface LoggerLike {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/**
 * Resolve every local site's install link once at startup. Deliberately never
 * throws: a CAPI outage or an unauthenticated user must degrade the fleet view,
 * not prevent the addon from booting.
 */
export async function runStartupReconciliation(
  resolver: SiteLinkResolver,
  siteData: SiteDataAccessor,
  logger: LoggerLike,
): Promise<ReconcileReport> {
  try {
    const report = await resolver.reconcileAll(siteData.getSites());
    logger.info(
      `[NexusAI] Site link reconciliation: ${report.linked.length} linked, ${report.unresolved.length} unresolved`,
    );
    return report;
  } catch (err) {
    logger.error('[NexusAI] Site link reconciliation failed', err);
    return { linked: [], unresolved: [] };
  }
}
