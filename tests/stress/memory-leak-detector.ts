/**
 * Memory Leak Detector
 *
 * Runs operations repeatedly and monitors memory growth to detect leaks.
 */

export interface MemorySnapshot {
  iteration: number;
  rss_mb: number;
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
  timestamp: number;
}

export interface LeakReport {
  test_name: string;
  iterations: number;
  duration_ms: number;
  initial_memory: MemorySnapshot;
  final_memory: MemorySnapshot;
  peak_memory: MemorySnapshot;
  avg_memory_mb: number;
  memory_growth_mb: number;
  memory_growth_percent: number;
  has_leak: boolean;
  leak_severity: 'none' | 'minor' | 'moderate' | 'severe';
  snapshots: MemorySnapshot[];
}

export class MemoryLeakDetector {
  private snapshots: MemorySnapshot[] = [];

  /**
   * Run an operation repeatedly and track memory usage
   */
  async detectLeaks(
    testName: string,
    operation: () => Promise<void>,
    iterations: number = 100,
    sampleInterval: number = 10 // Take snapshot every N iterations
  ): Promise<LeakReport> {
    const startTime = Date.now();

    // Force GC before starting (if available)
    if (global.gc) {
      global.gc();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Initial snapshot
    this.takeSnapshot(0);

    // Run iterations
    for (let i = 1; i <= iterations; i++) {
      await operation();

      // Take snapshot at intervals
      if (i % sampleInterval === 0) {
        // Force GC before snapshot (if available)
        if (global.gc) {
          global.gc();
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        this.takeSnapshot(i);
      }
    }

    // Final snapshot
    if (global.gc) {
      global.gc();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.takeSnapshot(iterations);

    const duration = Date.now() - startTime;

    // Analyze results
    const report = this.analyzeSnapshots(testName, iterations, duration);

    // Clear snapshots for next test
    this.snapshots = [];

    return report;
  }

  private takeSnapshot(iteration: number): void {
    const mem = process.memoryUsage();
    this.snapshots.push({
      iteration,
      rss_mb: mem.rss / 1024 / 1024,
      heap_used_mb: mem.heapUsed / 1024 / 1024,
      heap_total_mb: mem.heapTotal / 1024 / 1024,
      external_mb: mem.external / 1024 / 1024,
      timestamp: Date.now(),
    });
  }

  private analyzeSnapshots(
    testName: string,
    iterations: number,
    duration_ms: number
  ): LeakReport {
    const initial = this.snapshots[0];
    const final = this.snapshots[this.snapshots.length - 1];

    // Find peak memory
    const peak = this.snapshots.reduce((max, snap) =>
      snap.rss_mb > max.rss_mb ? snap : max
    );

    // Calculate average memory
    const totalMemory = this.snapshots.reduce((sum, snap) => sum + snap.rss_mb, 0);
    const avgMemory = totalMemory / this.snapshots.length;

    // Calculate memory growth
    const memoryGrowth = final.rss_mb - initial.rss_mb;
    const memoryGrowthPercent = (memoryGrowth / initial.rss_mb) * 100;

    // Determine if there's a leak
    // Leak detection criteria:
    // - >10% growth = minor leak
    // - >25% growth = moderate leak
    // - >50% growth = severe leak
    let hasLeak = false;
    let leakSeverity: LeakReport['leak_severity'] = 'none';

    if (memoryGrowthPercent > 50) {
      hasLeak = true;
      leakSeverity = 'severe';
    } else if (memoryGrowthPercent > 25) {
      hasLeak = true;
      leakSeverity = 'moderate';
    } else if (memoryGrowthPercent > 10) {
      hasLeak = true;
      leakSeverity = 'minor';
    }

    return {
      test_name: testName,
      iterations,
      duration_ms,
      initial_memory: initial,
      final_memory: final,
      peak_memory: peak,
      avg_memory_mb: avgMemory,
      memory_growth_mb: memoryGrowth,
      memory_growth_percent: memoryGrowthPercent,
      has_leak: hasLeak,
      leak_severity: leakSeverity,
      snapshots: this.snapshots,
    };
  }

  /**
   * Print leak report
   */
  static printReport(report: LeakReport): void {
    console.log(`\n=== Memory Leak Report: ${report.test_name} ===`);
    console.log(`Iterations: ${report.iterations}`);
    console.log(`Duration: ${(report.duration_ms / 1000).toFixed(1)}s`);
    console.log(`\nMemory Usage:`);
    console.log(`  Initial:  ${report.initial_memory.rss_mb.toFixed(2)} MB`);
    console.log(`  Final:    ${report.final_memory.rss_mb.toFixed(2)} MB`);
    console.log(`  Peak:     ${report.peak_memory.rss_mb.toFixed(2)} MB (iteration ${report.peak_memory.iteration})`);
    console.log(`  Average:  ${report.avg_memory_mb.toFixed(2)} MB`);
    console.log(`\nMemory Growth:`);
    console.log(`  Absolute: ${report.memory_growth_mb > 0 ? '+' : ''}${report.memory_growth_mb.toFixed(2)} MB`);
    console.log(`  Percent:  ${report.memory_growth_percent > 0 ? '+' : ''}${report.memory_growth_percent.toFixed(1)}%`);
    console.log(`\nLeak Detection:`);
    console.log(`  Has Leak: ${report.has_leak ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`  Severity: ${report.leak_severity.toUpperCase()}`);

    if (report.has_leak) {
      console.log(`\n⚠️  MEMORY LEAK DETECTED!`);
      console.log(`  This operation appears to be leaking memory.`);
      console.log(`  Consider investigating for unclosed connections, event listeners, or retained objects.`);
    }

    console.log(`\n==========================================\n`);
  }
}
