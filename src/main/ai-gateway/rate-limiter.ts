/**
 * Rate limiter for AI Gateway
 */

import type { RegistryStorage } from '../content/IndexRegistry';
import type { RateLimitConfig, RateLimitStatus } from './types';

const STORAGE_KEY = 'nexus_ai_rate_limits';
const DEFAULT_REQUESTS_PER_HOUR = 100;
const DEFAULT_REQUESTS_PER_DAY = 500;
const DEFAULT_COST_PER_DAY_USD = 10.0;

/**
 * Get rate limit configuration for a site
 */
export function getRateLimit(
  storage: RegistryStorage,
  siteId: string,
): RateLimitConfig {
  const limits = (storage.get(STORAGE_KEY) ?? {}) as Record<string, RateLimitConfig>;
  return limits[siteId] ?? {
    requestsPerHour: DEFAULT_REQUESTS_PER_HOUR,
    requestsPerDay: DEFAULT_REQUESTS_PER_DAY,
    costPerDayUsd: DEFAULT_COST_PER_DAY_USD,
  };
}

/**
 * Set rate limit configuration for a site
 */
export function setRateLimit(
  storage: RegistryStorage,
  siteId: string,
  config: RateLimitConfig,
): void {
  const limits = (storage.get(STORAGE_KEY) ?? {}) as Record<string, RateLimitConfig>;
  limits[siteId] = config;
  storage.set(STORAGE_KEY, limits);
}

/**
 * Check if a request is within rate limits
 */
export function checkRateLimit(
  storage: RegistryStorage,
  siteId: string,
): RateLimitStatus {
  const config = getRateLimit(storage, siteId);

  // Get usage records
  const USAGE_KEY = 'nexus_ai_gateway_usage';
  const allRecords = (storage.get(USAGE_KEY) ?? []) as any[];

  // Filter to this site's records
  const siteRecords = allRecords.filter((r) => r.siteId === siteId);

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Count requests in rolling windows
  const requestsThisHour = siteRecords.filter((r) => r.timestamp >= oneHourAgo).length;
  const requestsThisDay = siteRecords.filter((r) => r.timestamp >= oneDayAgo).length;

  // Calculate cost in rolling day
  const costThisDayUsd = siteRecords
    .filter((r) => r.timestamp >= oneDayAgo)
    .reduce((sum, r) => sum + (r.costUsd || 0), 0);

  // Check limits
  let allowed = true;
  let reason: string | undefined;

  if (config.requestsPerHour && requestsThisHour >= config.requestsPerHour) {
    allowed = false;
    reason = `Rate limit exceeded: ${requestsThisHour} requests in the last hour (limit: ${config.requestsPerHour})`;
  } else if (config.requestsPerDay && requestsThisDay >= config.requestsPerDay) {
    allowed = false;
    reason = `Rate limit exceeded: ${requestsThisDay} requests in the last day (limit: ${config.requestsPerDay})`;
  } else if (
    config.costPerDayUsd &&
    costThisDayUsd >= config.costPerDayUsd
  ) {
    allowed = false;
    reason = `Cost limit exceeded: $${costThisDayUsd.toFixed(4)} in the last day (limit: $${config.costPerDayUsd})`;
  }

  return {
    allowed,
    reason,
    requestsThisHour,
    requestsThisDay,
    costThisDayUsd,
    limits: config,
  };
}
