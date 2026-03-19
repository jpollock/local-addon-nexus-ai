/**
 * Metrics Collector
 *
 * Lightweight, in-memory metrics collection for production monitoring.
 * Collects counters, gauges, and histograms with minimal overhead.
 */

import { Counter, Gauge, Histogram, MetricSnapshot, ToolMetrics } from './types';

export class MetricsCollector {
  private static instance: MetricsCollector;

  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  // Tool-specific metrics tracking
  private toolCalls = new Map<string, number[]>(); // tool name => [duration1, duration2, ...]
  private toolErrors = new Map<string, number>(); // tool name => error count

  private startTime = Date.now();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Increment a counter
   */
  increment(name: string, labels?: Record<string, string>, value: number = 1): void {
    const key = this.makeKey(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { name, value, labels });
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, { name, value, labels });
  }

  /**
   * Record a histogram value
   */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels);
    const existing = this.histograms.get(key);
    if (existing) {
      existing.values.push(value);
    } else {
      this.histograms.set(key, { name, values: [value], labels });
    }
  }

  /**
   * Record a tool call (duration in ms)
   */
  recordToolCall(toolName: string, duration_ms: number, isError: boolean = false): void {
    // Track duration
    const durations = this.toolCalls.get(toolName) || [];
    durations.push(duration_ms);
    this.toolCalls.set(toolName, durations);

    // Track errors
    if (isError) {
      const errorCount = this.toolErrors.get(toolName) || 0;
      this.toolErrors.set(toolName, errorCount + 1);
    }

    // Update metrics
    this.increment('mcp_tool_calls_total', { tool: toolName });
    this.recordHistogram('mcp_tool_duration_ms', duration_ms, { tool: toolName });

    if (isError) {
      this.increment('mcp_tool_errors_total', { tool: toolName });
    }
  }

  /**
   * Get tool metrics for a specific tool
   */
  getToolMetrics(toolName: string): ToolMetrics | null {
    const durations = this.toolCalls.get(toolName);
    if (!durations || durations.length === 0) {
      return null;
    }

    const sorted = durations.slice().sort((a, b) => a - b);
    const total = durations.reduce((sum, d) => sum + d, 0);
    const errors = this.toolErrors.get(toolName) || 0;

    return {
      name: toolName,
      calls: durations.length,
      errors,
      total_duration_ms: total,
      avg_duration_ms: total / durations.length,
      min_duration_ms: sorted[0],
      max_duration_ms: sorted[sorted.length - 1],
      p50_duration_ms: sorted[Math.floor(sorted.length * 0.5)],
      p95_duration_ms: sorted[Math.floor(sorted.length * 0.95)],
      p99_duration_ms: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  /**
   * Get all tool metrics
   */
  getAllToolMetrics(): ToolMetrics[] {
    const metrics: ToolMetrics[] = [];
    for (const toolName of this.toolCalls.keys()) {
      const toolMetric = this.getToolMetrics(toolName);
      if (toolMetric) {
        metrics.push(toolMetric);
      }
    }
    return metrics.sort((a, b) => b.calls - a.calls);
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get current snapshot of all metrics
   */
  getSnapshot(): MetricSnapshot {
    return {
      timestamp: new Date().toISOString(),
      counters: new Map(this.counters),
      gauges: new Map(this.gauges),
      histograms: new Map(this.histograms),
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.toolCalls.clear();
    this.toolErrors.clear();
    this.startTime = Date.now();
  }

  /**
   * Export metrics to JSON
   */
  toJSON(): any {
    const snapshot = this.getSnapshot();
    return {
      timestamp: snapshot.timestamp,
      uptime_ms: this.getUptime(),
      counters: Array.from(snapshot.counters.values()),
      gauges: Array.from(snapshot.gauges.values()),
      histograms: Array.from(snapshot.histograms.entries()).map(([key, hist]) => ({
        name: hist.name,
        labels: hist.labels,
        count: hist.values.length,
        sum: hist.values.reduce((a, b) => a + b, 0),
        min: Math.min(...hist.values),
        max: Math.max(...hist.values),
        avg: hist.values.reduce((a, b) => a + b, 0) / hist.values.length,
      })),
      tools: this.getAllToolMetrics(),
    };
  }

  private makeKey(name: string, labels?: Record<string, string>): string {
    if (!labels) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }
}

/**
 * Get the singleton metrics collector
 */
export function getMetrics(): MetricsCollector {
  return MetricsCollector.getInstance();
}
