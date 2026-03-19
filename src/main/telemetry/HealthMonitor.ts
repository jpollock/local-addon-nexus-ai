/**
 * Health Monitor
 *
 * Monitors system health and aggregates metrics for health checks.
 * Periodically transmits health data to Cloudflare for analytics.
 */

import { SystemHealth } from './types';
import { getMetrics } from './MetricsCollector';
import { CloudflareTransmitter } from './CloudflareTransmitter';
import { createLogger } from '../logging/Logger';

const logger = createLogger('HealthMonitor');
const metrics = getMetrics();

export class HealthMonitor {
  private static instance: HealthMonitor;

  private eventQueuePending = 0;
  private eventQueueProcessing = 0;
  private eventQueueFailedLastHour = 0;

  private searchQueryCount = 0;
  private searchTotalDuration = 0;
  private searchCacheHits = 0;
  private searchCacheMisses = 0;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): HealthMonitor {
    if (!HealthMonitor.instance) {
      HealthMonitor.instance = new HealthMonitor();
    }
    return HealthMonitor.instance;
  }

  /**
   * Update event queue stats
   */
  updateEventQueue(pending: number, processing: number): void {
    this.eventQueuePending = pending;
    this.eventQueueProcessing = processing;
  }

  /**
   * Record event processing failure
   */
  recordEventFailure(): void {
    this.eventQueueFailedLastHour++;
    // Reset counter every hour
    setTimeout(() => {
      this.eventQueueFailedLastHour = Math.max(0, this.eventQueueFailedLastHour - 1);
    }, 3600000);
  }

  /**
   * Record search query
   */
  recordSearch(duration_ms: number, cacheHit: boolean): void {
    this.searchQueryCount++;
    this.searchTotalDuration += duration_ms;
    if (cacheHit) {
      this.searchCacheHits++;
    } else {
      this.searchCacheMisses++;
    }
  }

  /**
   * Get current system health
   */
  getHealth(): SystemHealth {
    const mem = process.memoryUsage();
    const uptime = metrics.getUptime();

    // Calculate tool metrics
    const toolMetrics = metrics.getAllToolMetrics();
    const totalCalls = toolMetrics.reduce((sum, t) => sum + t.calls, 0);
    const totalErrors = toolMetrics.reduce((sum, t) => sum + t.errors, 0);
    const totalDuration = toolMetrics.reduce((sum, t) => sum + t.total_duration_ms, 0);

    const errorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
    const avgDuration = totalCalls > 0 ? totalDuration / totalCalls : 0;

    // Calculate search metrics
    const totalSearches = this.searchCacheHits + this.searchCacheMisses;
    const cacheHitRate = totalSearches > 0 ? this.searchCacheHits / totalSearches : 0;
    const searchAvgDuration = this.searchQueryCount > 0
      ? this.searchTotalDuration / this.searchQueryCount
      : 0;

    // Determine health status
    const issues: string[] = [];
    let status: SystemHealth['status'] = 'healthy';

    // Check memory
    const rss_mb = mem.rss / 1024 / 1024;
    if (rss_mb > 500) {
      issues.push(`High memory usage: ${rss_mb.toFixed(0)}MB (threshold: 500MB)`);
      status = 'degraded';
    }
    if (rss_mb > 1000) {
      status = 'unhealthy';
    }

    // Check error rate
    if (errorRate > 0.05) {
      issues.push(`High error rate: ${(errorRate * 100).toFixed(1)}% (threshold: 5%)`);
      status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    }
    if (errorRate > 0.10) {
      status = 'unhealthy';
    }

    // Check event queue
    if (this.eventQueuePending > 100) {
      issues.push(`Event queue backlog: ${this.eventQueuePending} (threshold: 100)`);
      status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    }
    if (this.eventQueueFailedLastHour > 10) {
      issues.push(`High event failure rate: ${this.eventQueueFailedLastHour} in last hour`);
      status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    }

    return {
      status,
      uptime_ms: uptime,
      memory: {
        rss_mb: rss_mb,
        heap_used_mb: mem.heapUsed / 1024 / 1024,
        heap_total_mb: mem.heapTotal / 1024 / 1024,
        external_mb: mem.external / 1024 / 1024,
      },
      event_queue: {
        pending: this.eventQueuePending,
        processing: this.eventQueueProcessing,
        failed_last_hour: this.eventQueueFailedLastHour,
      },
      mcp_tools: {
        total_calls: totalCalls,
        error_rate: errorRate,
        avg_duration_ms: avgDuration,
      },
      search: {
        total_queries: this.searchQueryCount,
        avg_duration_ms: searchAvgDuration,
        cache_hit_rate: cacheHitRate,
      },
      issues,
    };
  }

  /**
   * Log health status
   */
  logHealth(): void {
    const health = this.getHealth();

    if (health.status === 'unhealthy') {
      logger.error('System health: UNHEALTHY', health);
    } else if (health.status === 'degraded') {
      logger.warn('System health: DEGRADED', health);
    } else {
      logger.info('System health: HEALTHY', health);
    }
  }

  /**
   * Transmit health check to Cloudflare analytics
   *
   * Called periodically to send anonymous health metrics.
   * Gets number of indexed sites from IndexRegistry if available.
   */
  transmitHealthCheck(activeSites: number = 0): void {
    const health = this.getHealth();

    CloudflareTransmitter.recordHealthCheck(
      health.memory.rss_mb,
      health.status,
      activeSites,
    );
  }
}

/**
 * Get the singleton health monitor
 */
export function getHealthMonitor(): HealthMonitor {
  return HealthMonitor.getInstance();
}
