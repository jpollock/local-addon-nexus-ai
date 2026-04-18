/**
 * REST API route: fleet
 *
 * GET /api/v1/fleet/health  — fleet health summary
 */

import type { NexusServices } from '../../types/nexus-services';

export async function handleFleetHealth(
  services: NexusServices,
): Promise<Record<string, unknown>> {
  const { twinService, indexRegistry, healthCalculator, siteData } = services;

  const twins = twinService?.getAll() ?? [];
  const totalSites = twins.length || Object.keys(siteData.getSites()).length;

  // Use indexed entries for health scoring (same as fleet_health_summary MCP tool)
  if (!healthCalculator || !indexRegistry) {
    return {
      totalSites,
      indexedSites: 0,
      healthyCount: 0,
      warningCount: 0,
      criticalCount: 0,
      averageScore: null,
      note: 'Health scoring is not available. Index sites first.',
    };
  }

  const entries = indexRegistry.listAll().filter((e: any) => e.state === 'indexed');

  if (entries.length === 0) {
    return {
      totalSites,
      indexedSites: 0,
      healthyCount: 0,
      warningCount: 0,
      criticalCount: 0,
      averageScore: null,
      note: 'No indexed sites. Index sites to enable health scoring.',
    };
  }

  const allSites = siteData.getSites();
  const siteInfoMap: Record<string, any> = {};
  const siteIds: string[] = [];

  for (const entry of entries) {
    const site = allSites[entry.siteId] as any;
    siteIds.push(entry.siteId);
    siteInfoMap[entry.siteId] = {
      domain: site?.domain || '',
      phpVersion: site?.phpVersion || '8.0',
    };
  }

  const scores = await healthCalculator.calculateAllScores(siteIds, siteInfoMap);

  let healthy = 0;
  let warning = 0;
  let critical = 0;
  let totalScore = 0;

  for (const siteId of siteIds) {
    const score = scores[siteId] ?? 0;
    totalScore += score;
    if (score >= 80) healthy++;
    else if (score >= 50) warning++;
    else critical++;
  }

  const averageScore = siteIds.length > 0 ? Math.round(totalScore / siteIds.length) : null;

  return {
    totalSites,
    indexedSites: entries.length,
    healthyCount: healthy,
    warningCount: warning,
    criticalCount: critical,
    averageScore,
  };
}
