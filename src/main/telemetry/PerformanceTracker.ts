/**
 * Performance Tracker
 *
 * Tracks operation durations and detects slow operations.
 * Integrates with MetricsCollector for telemetry.
 */

import { getMetrics } from './MetricsCollector';
import { createLogger } from '../logging/Logger';

const logger = createLogger('PerformanceTracker');
const metrics = getMetrics();

// Threshold for slow operations (ms)
const SLOW_OPERATION_THRESHOLD = 5000;

export class PerformanceTracker {
  /**
   * Track the duration of an async operation
   */
  static async track<T>(
    name: string,
    operation: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const startTime = Date.now();
    let error: Error | undefined;

    try {
      const result = await operation();
      return result;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      throw err;
    } finally {
      const duration = Date.now() - startTime;

      // Record metrics
      metrics.recordHistogram('operation_duration_ms', duration, { operation: name, ...labels });

      // Warn on slow operations
      if (duration > SLOW_OPERATION_THRESHOLD) {
        logger.warn(`Slow operation detected: ${name}`, {
          duration_ms: duration,
          threshold_ms: SLOW_OPERATION_THRESHOLD,
          labels,
        });
        metrics.increment('slow_operations_total', { operation: name });
      }

      // Track errors
      if (error) {
        logger.error(`Operation failed: ${name}`, {
          duration_ms: duration,
          error: error.message,
          labels,
        });
        metrics.increment('operation_errors_total', { operation: name });
      }
    }
  }

  /**
   * Track tool execution (simpler interface for MCP tools)
   */
  static async trackTool<T>(
    toolName: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; duration_ms: number; error?: Error }> {
    const startTime = Date.now();
    let error: Error | undefined;
    let result: T;

    try {
      result = await operation();
      return { result, duration_ms: Date.now() - startTime };
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      const duration_ms = Date.now() - startTime;
      return { result: undefined as T, duration_ms, error };
    } finally {
      const duration = Date.now() - startTime;
      metrics.recordToolCall(toolName, duration, !!error);
    }
  }

  /**
   * Create a scoped tracker for a specific component
   */
  static createScoped(componentName: string) {
    return {
      track: <T>(operationName: string, operation: () => Promise<T>) =>
        PerformanceTracker.track(operationName, operation, { component: componentName }),
      trackTool: <T>(toolName: string, operation: () => Promise<T>) =>
        PerformanceTracker.trackTool(toolName, operation),
    };
  }
}

/**
 * Decorator for tracking method execution time
 */
export function tracked(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const className = target.constructor.name;
    const operationName = `${className}.${propertyKey}`;
    return PerformanceTracker.track(operationName, () => originalMethod.apply(this, args));
  };

  return descriptor;
}
