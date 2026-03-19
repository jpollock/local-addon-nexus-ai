/**
 * Telemetry Types
 *
 * Defines metrics collection types for production monitoring.
 */

export interface Counter {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface Gauge {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface Histogram {
  name: string;
  values: number[];
  labels?: Record<string, string>;
}

export interface MetricSnapshot {
  timestamp: string;
  counters: Map<string, Counter>;
  gauges: Map<string, Gauge>;
  histograms: Map<string, Histogram>;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime_ms: number;
  memory: {
    rss_mb: number;
    heap_used_mb: number;
    heap_total_mb: number;
    external_mb: number;
  };
  event_queue: {
    pending: number;
    processing: number;
    failed_last_hour: number;
  };
  mcp_tools: {
    total_calls: number;
    error_rate: number;
    avg_duration_ms: number;
  };
  search: {
    total_queries: number;
    avg_duration_ms: number;
    cache_hit_rate: number;
  };
  issues: string[];
}

export interface ToolMetrics {
  name: string;
  calls: number;
  errors: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  min_duration_ms: number;
  max_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
}
