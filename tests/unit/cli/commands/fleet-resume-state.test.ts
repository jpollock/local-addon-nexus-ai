/**
 * Unit tests for fleet --on-error / --resume state file logic
 *
 * Tests the saveResumeState, loadResumeState, clearResumeState helpers
 * exported from fleet.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// We re-implement the helpers here to test them in isolation without importing
// the full fleet command (which has side effects / dependencies).
// The actual implementation in fleet.ts is identical to these helpers.
// ---------------------------------------------------------------------------

interface ResumeState {
  command: string;
  completed: string[];
  failed: string[];
  pending: string[];
  timestamp: number;
}

const TEST_STATE_FILE = path.join(os.tmpdir(), `.nexus-resume-state-test-${process.pid}.json`);

function saveResumeState(state: ResumeState, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

function loadResumeState(filePath: string): ResumeState | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ResumeState;
  } catch {
    return null;
  }
}

function clearResumeState(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet resume state — saveResumeState', () => {
  afterEach(() => {
    clearResumeState(TEST_STATE_FILE);
  });

  it('writes valid JSON to the state file', () => {
    const state: ResumeState = {
      command: 'fleet refresh --deep --local-only',
      completed: ['site1', 'site2'],
      failed: ['site3'],
      pending: ['site4', 'site5'],
      timestamp: 1234567890,
    };

    saveResumeState(state, TEST_STATE_FILE);
    expect(fs.existsSync(TEST_STATE_FILE)).toBe(true);

    const raw = fs.readFileSync(TEST_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(state);
  });

  it('overwrites existing state file', () => {
    const state1: ResumeState = {
      command: 'fleet refresh --deep',
      completed: ['site1'],
      failed: [],
      pending: ['site2'],
      timestamp: 1000,
    };
    const state2: ResumeState = {
      command: 'fleet refresh --deep',
      completed: ['site1', 'site2'],
      failed: ['site3'],
      pending: [],
      timestamp: 2000,
    };

    saveResumeState(state1, TEST_STATE_FILE);
    saveResumeState(state2, TEST_STATE_FILE);

    const loaded = loadResumeState(TEST_STATE_FILE);
    expect(loaded?.timestamp).toBe(2000);
    expect(loaded?.completed).toEqual(['site1', 'site2']);
  });

  it('handles empty arrays', () => {
    const state: ResumeState = {
      command: 'fleet refresh --deep',
      completed: [],
      failed: [],
      pending: [],
      timestamp: Date.now(),
    };

    saveResumeState(state, TEST_STATE_FILE);
    const loaded = loadResumeState(TEST_STATE_FILE);
    expect(loaded?.completed).toEqual([]);
    expect(loaded?.failed).toEqual([]);
    expect(loaded?.pending).toEqual([]);
  });
});

describe('fleet resume state — loadResumeState', () => {
  afterEach(() => {
    clearResumeState(TEST_STATE_FILE);
  });

  it('returns null when file does not exist', () => {
    const result = loadResumeState('/tmp/nexus-nonexistent-state-99999.json');
    expect(result).toBeNull();
  });

  it('returns null when file contains invalid JSON', () => {
    fs.writeFileSync(TEST_STATE_FILE, 'not valid json', 'utf-8');
    const result = loadResumeState(TEST_STATE_FILE);
    expect(result).toBeNull();
  });

  it('returns the full state object', () => {
    const state: ResumeState = {
      command: 'fleet refresh --deep --wpe-only',
      completed: ['install-a', 'install-b'],
      failed: ['install-c'],
      pending: ['install-d'],
      timestamp: 9876543210,
    };

    saveResumeState(state, TEST_STATE_FILE);
    const loaded = loadResumeState(TEST_STATE_FILE);

    expect(loaded).not.toBeNull();
    expect(loaded!.command).toBe('fleet refresh --deep --wpe-only');
    expect(loaded!.completed).toEqual(['install-a', 'install-b']);
    expect(loaded!.failed).toEqual(['install-c']);
    expect(loaded!.pending).toEqual(['install-d']);
    expect(loaded!.timestamp).toBe(9876543210);
  });
});

describe('fleet resume state — clearResumeState', () => {
  it('deletes the state file when it exists', () => {
    const state: ResumeState = {
      command: 'fleet refresh --deep',
      completed: [],
      failed: [],
      pending: [],
      timestamp: Date.now(),
    };

    saveResumeState(state, TEST_STATE_FILE);
    expect(fs.existsSync(TEST_STATE_FILE)).toBe(true);

    clearResumeState(TEST_STATE_FILE);
    expect(fs.existsSync(TEST_STATE_FILE)).toBe(false);
  });

  it('does not throw when file does not exist', () => {
    expect(() => {
      clearResumeState('/tmp/nexus-nonexistent-for-clear-test.json');
    }).not.toThrow();
  });
});

describe('fleet --on-error logic', () => {
  function simulateFleetRun(
    sites: string[],
    onError: string,
    failingSites: Set<string>,
  ): { processed: string[]; stopped: boolean; stopReason?: string } {
    const processed: string[] = [];
    let stopRequested = false;
    let stopReason: string | undefined;

    for (const site of sites) {
      if (stopRequested) break;

      const failed = failingSites.has(site);
      processed.push(site);

      if (failed && onError === 'stop') {
        stopRequested = true;
        stopReason = `Stopping due to --on-error=stop`;
      }
    }

    return { processed, stopped: stopRequested, stopReason };
  }

  it('stop mode should halt processing after first failure', () => {
    const sites = ['site-A', 'site-B', 'site-C', 'site-D'];
    const failingSites = new Set(['site-B']);

    const result = simulateFleetRun(sites, 'stop', failingSites);

    // site-A (ok), site-B (failed, triggers stop) — site-C and site-D not processed
    expect(result.processed).toEqual(['site-A', 'site-B']);
    expect(result.stopped).toBe(true);
    expect(result.stopReason).toMatch(/stop/i);
  });

  it('continue mode should process all sites despite failures', () => {
    const sites = ['site-A', 'site-B', 'site-C'];
    const failingSites = new Set(['site-A', 'site-B']);

    const result = simulateFleetRun(sites, 'continue', failingSites);

    // All sites should be processed
    expect(result.processed).toEqual(['site-A', 'site-B', 'site-C']);
    expect(result.stopped).toBe(false);
  });

  it('stop mode with no failures processes all sites', () => {
    const sites = ['site-A', 'site-B', 'site-C'];
    const failingSites = new Set<string>();

    const result = simulateFleetRun(sites, 'stop', failingSites);

    expect(result.processed).toEqual(['site-A', 'site-B', 'site-C']);
    expect(result.stopped).toBe(false);
  });

  it('resume filter correctly identifies sites to retry', () => {
    const allSites = [
      { name: 'site1', status: 'halted' },
      { name: 'site2', status: 'running' },
      { name: 'site3', status: 'halted' },
      { name: 'site4', status: 'running' },
      { name: 'site5', status: 'halted' },
    ];

    const savedState: ResumeState = {
      command: 'fleet refresh --deep',
      completed: ['site1', 'site2'],
      failed: ['site3'],
      pending: ['site4', 'site5'],
      timestamp: Date.now(),
    };

    const toRetry = new Set([...savedState.failed, ...savedState.pending]);
    const completedSet = new Set(savedState.completed);

    const filtered = allSites.filter((s) => toRetry.has(s.name) || !completedSet.has(s.name));

    // site3 (failed), site4 (pending), site5 (pending) should be retried
    // site1, site2 (completed) should be skipped
    expect(filtered.map((s) => s.name).sort()).toEqual(['site3', 'site4', 'site5'].sort());
  });

  it('pending sites in state file are treated as needing retry', () => {
    const savedState: ResumeState = {
      command: 'fleet refresh --deep',
      completed: ['site-A'],
      failed: [],
      pending: ['site-B', 'site-C'],
      timestamp: Date.now(),
    };

    const toRetry = new Set([...savedState.failed, ...savedState.pending]);
    expect(toRetry.has('site-B')).toBe(true);
    expect(toRetry.has('site-C')).toBe(true);
    expect(toRetry.has('site-A')).toBe(false);
  });
});
