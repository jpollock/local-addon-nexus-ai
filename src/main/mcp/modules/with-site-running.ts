/**
 * withSiteRunning — shared auto-start/stop utility for MCP tools and IPC handlers.
 *
 * If the target site is halted, starts it, waits for MySQL to be ready,
 * runs the provided work function, then stops the site again. If the site
 * was already running, it is left running when work completes.
 *
 * Stop is best-effort: if Local's stop sequence fails (e.g. database dump
 * during shutdown) we log the error and leave the site running rather than
 * masking the original result.
 */
import type { NexusServices } from '../types';

export async function waitForDatabaseReady(
  siteId: string,
  services: NexusServices,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  services.logger.info(`[withSiteRunning] Waiting for database to be ready for site ${siteId}…`);

  while (Date.now() < deadline) {
    // Cap each individual poll to the remaining deadline so a hanging wpCliRun
    // call does not block past the outer timeout (2-min default >> 30s outer deadline).
    const remainingMs = Math.max(deadline - Date.now(), 1000);
    try {
      const result = await services.localServices!.wpCliRun(
        siteId, ['eval', "echo 'ready';"],
        { timeoutMs: Math.min(remainingMs, 10_000) }, // at most 10s per poll attempt
      );
      if (result.success && result.stdout?.trim() === 'ready') {
        services.logger.info(`[withSiteRunning] Database ready for site ${siteId}`);
        return;
      }
    } catch {
      // Not ready yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  throw new Error(`Database for site ${siteId} did not become ready within ${timeoutMs}ms`);
}

export async function withSiteRunning<T>(
  siteId: string,
  services: NexusServices,
  work: () => Promise<T>,
): Promise<T> {
  const ls = services.localServices!;
  // Use getSiteStatus() (live process manager query) rather than getAllSiteStatuses()
  // which can return stale data after a Local restart and cause auto-start to be skipped.
  const wasRunning = ls.getSiteStatus(siteId) === 'running';

  if (!wasRunning) {
    services.logger.info(`[withSiteRunning] Site ${siteId} is halted — auto-starting`);
    await ls.startSite(siteId);
    await waitForDatabaseReady(siteId, services);
  }

  try {
    const result = await work();

    if (!wasRunning) {
      services.logger.info(`[withSiteRunning] Work complete — auto-stopping site ${siteId}`);
      await new Promise((r) => setTimeout(r, 1_000));
      try {
        await ls.stopSite(siteId);
      } catch (e) {
        services.logger.error(
          `[withSiteRunning] Failed to auto-stop site ${siteId}: ${(e as Error).message}. Site left running.`,
        );
      }
    }

    return result;
  } catch (err) {
    if (!wasRunning) {
      services.logger.info(`[withSiteRunning] Work threw — attempting auto-stop of site ${siteId}`);
      await new Promise((r) => setTimeout(r, 1_000));
      try { await ls.stopSite(siteId); } catch { /* best effort */ }
    }
    throw err;
  }
}
