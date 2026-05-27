/**
 * NexusStateManager — shared reactive state store for the Nexus AI renderer.
 *
 * Single source of truth for fleet state pushed from the main process.
 * Replaces per-component setInterval polling with a subscribe/notify pattern.
 *
 * Usage:
 *   // In componentDidMount:
 *   this.unsub = nexusStore.subscribe(() => this.setState({ fleet: nexusStore.get().fleetCompleteness }));
 *   // In componentWillUnmount:
 *   this.unsub?.();
 *
 * Main process pushes via NEXUS_STATE_UPDATE IPC channel with a Partial<NexusState> patch.
 */

import type {
  FleetCompleteness,
  IndexEntry,
  NexusSettings,
} from '../../common/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WpeSyncProgress {
  active: boolean;
  current: number;
  total: number;
  currentSite: string;
  phase: 'capi' | 'metadata' | 'content';
}

export interface LocalSyncProgress {
  active: boolean;
  current: number;
  total: number;
  currentSite: string;
  phase: 'scan' | 'metadata' | 'content';
  opType: 'sync-graph' | 'reindex' | 'offline-scan';
}

export interface WpeStatusData {
  total: number;
  fresh: number;
  stale: number;
  withPlugins: number;
  withUsers: number;
  withWpVersion: number;
  withPhpVersion: number;
  lastSyncAt: number | null;
}

export interface DashboardStatsData {
  localSites: { total: number; running: number; halted: number };
  wpeConnected: { count: number };
  remoteSites: { total: number; unlinked: number; capiAvailable: boolean; wpeAuthenticated: boolean };
  mcpServer: { running: boolean; toolCount: number; port: number | null; version: string | null };
}

export interface NexusState {
  fleetCompleteness: FleetCompleteness | null;
  wpeStatus: WpeStatusData | null;
  dashboardStats: DashboardStatsData | null;
  indexEntries: IndexEntry[];
  settings: NexusSettings | null;
  wpeSyncProgress: WpeSyncProgress | null;
  localSyncProgress: LocalSyncProgress | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const DEFAULT_STATE: NexusState = {
  fleetCompleteness: null,
  wpeStatus: null,
  dashboardStats: null,
  indexEntries: [],
  settings: null,
  wpeSyncProgress: null,
  localSyncProgress: null,
};

class NexusStateManager {
  private state: NexusState = { ...DEFAULT_STATE };
  private listeners = new Set<() => void>();

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Get the current state snapshot. */
  get(): Readonly<NexusState> {
    return this.state;
  }

  /** Apply a partial state patch and notify all subscribers. */
  update(patch: Partial<NexusState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  /** Reset to defaults (useful for testing). */
  reset(): void {
    this.state = { ...DEFAULT_STATE };
    this.listeners.forEach(fn => fn());
  }
}

export const nexusStore = new NexusStateManager();
