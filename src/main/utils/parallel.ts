/**
 * Parallel Execution Utilities
 *
 * Execute operations in parallel with concurrency limits.
 * Prevents overwhelming system resources during bulk operations.
 */

export interface ParallelOptions {
  /** Maximum number of concurrent operations */
  concurrency: number;
  /** Called after each operation completes */
  onProgress?: (completed: number, total: number) => void;
  /** Called when an operation fails (doesn't stop execution) */
  onError?: (error: Error, index: number) => void;
}

export interface ParallelResult<T> {
  /** Successful results (sparse array, failed operations are undefined) */
  results: (T | undefined)[];
  /** Errors that occurred */
  errors: { index: number; error: Error }[];
  /** Statistics */
  stats: {
    total: number;
    successful: number;
    failed: number;
    duration: number; // milliseconds
  };
}

/**
 * Execute async operations in parallel with concurrency limit.
 *
 * Continues execution even if some operations fail.
 * Returns results for successful operations and collects errors.
 *
 * @example
 * const results = await pMap(
 *   siteIds,
 *   async (siteId) => setupSiteForAI(siteId),
 *   { concurrency: 5, onProgress: (done, total) => console.log(`${done}/${total}`) }
 * );
 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ParallelOptions,
): Promise<ParallelResult<R>> {
  const startTime = Date.now();
  const results: (R | undefined)[] = new Array(items.length);
  const errors: { index: number; error: Error }[] = [];
  let completed = 0;

  // Process in batches of `concurrency` size
  for (let i = 0; i < items.length; i += options.concurrency) {
    const batch = items.slice(i, Math.min(i + options.concurrency, items.length));
    const batchPromises = batch.map(async (item, batchIndex) => {
      const itemIndex = i + batchIndex;

      try {
        const result = await fn(item, itemIndex);
        results[itemIndex] = result;
        return { success: true, result, index: itemIndex };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ index: itemIndex, error: err });
        options.onError?.(err, itemIndex);
        return { success: false, error: err, index: itemIndex };
      }
    });

    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);

    // Update progress
    completed += batchResults.length;
    options.onProgress?.(completed, items.length);
  }

  const duration = Date.now() - startTime;

  return {
    results,
    errors,
    stats: {
      total: items.length,
      successful: results.filter((r) => r !== undefined).length,
      failed: errors.length,
      duration,
    },
  };
}

/**
 * Execute async operations in parallel with concurrency limit.
 * Throws if ANY operation fails (fail-fast mode).
 *
 * @example
 * const results = await pMapStrict(
 *   siteIds,
 *   async (siteId) => setupSiteForAI(siteId),
 *   { concurrency: 5 }
 * );
 */
export async function pMapStrict<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: Omit<ParallelOptions, 'onError'>,
): Promise<R[]> {
  const result = await pMap(items, fn, {
    ...options,
    onError: undefined, // No error handler in strict mode
  });

  if (result.errors.length > 0) {
    const firstError = result.errors[0];
    throw new Error(
      `Operation failed at index ${firstError.index}: ${firstError.error.message}`,
    );
  }

  return result.results as R[];
}

/**
 * Execute async operations with retry logic.
 *
 * Retries failed operations up to `maxRetries` times.
 *
 * @example
 * const result = await withRetry(
 *   () => fetchData(),
 *   { maxRetries: 3, retryDelay: 1000 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    retryDelay?: number; // milliseconds
    onRetry?: (attempt: number, error: Error) => void;
  },
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < options.maxRetries) {
        options.onRetry?.(attempt + 1, lastError);

        if (options.retryDelay) {
          await new Promise((resolve) => setTimeout(resolve, options.retryDelay));
        }
      }
    }
  }

  throw lastError!;
}

/**
 * Execute operations in sequence (opposite of parallel).
 * Useful for operations that must run in order.
 *
 * @example
 * const results = await sequential(
 *   siteIds,
 *   async (siteId) => setupSiteForAI(siteId),
 *   { onProgress: (done, total) => console.log(`${done}/${total}`) }
 * );
 */
export async function sequential<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options?: {
    onProgress?: (completed: number, total: number) => void;
  },
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = await fn(items[i], i);
    results.push(result);
    options?.onProgress?.(i + 1, items.length);
  }

  return results;
}

/**
 * Batch items into groups of specified size.
 *
 * @example
 * const batches = batch([1,2,3,4,5], 2); // [[1,2], [3,4], [5]]
 */
export function batch<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}
