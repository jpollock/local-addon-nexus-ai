/**
 * OperationTracker
 *
 * Intercepts Local's IPC events (updateSiteStatus, updateSiteMessage) that are
 * emitted by sendIPCEvent in Local's main process via ipcMain.emit(). This lets
 * us track push/pull/export operations in real time without modifying Local.
 *
 * Usage:
 *   const tracker = new OperationTracker();
 *   tracker.start();
 *   const op = tracker.getOperation(siteId);
 */

// Dynamic require — this file only runs inside Local's Electron main process.
// Static import would fail in CI where electron is not installed as a package.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcMain } = require('electron') as {
  ipcMain: { on(channel: string, listener: (event: any, ...args: any[]) => void): void };
};

// Status strings emitted by Local during operations
const ACTIVE_STATUSES = new Set([
  'pulling',
  'pulling_provisioning',
  'pushing_v2',
  'exporting',
]);

/**
 * Terminal banner ids, and the ONLY way to tell a sync that worked from one
 * that did not.
 *
 * Local's `WPEBaseService.errorHandler` emits the same
 * `updateSiteStatus → 'running'` the success path emits, so `status` alone
 * says *finished*, never *succeeded*. The banner id is a structural
 * discriminator (an id, not display copy) — verified in Local's source:
 * `WPEPullService.ts` ('site-pulled'), `WPEPushService.ts:205` ('site-pushed'),
 * `WPEBaseService.ts:112` (`${direction}ing-error`).
 *
 * Non-terminal error banners exist too ('cache-purging-error',
 * 'table-prefix-error') and are deliberately absent: they do not end the
 * operation.
 */
const TERMINAL_BANNERS: Record<string, 'succeeded' | 'failed'> = {
  'site-pulled': 'succeeded',
  'site-pushed': 'succeeded',
  'pulling-error': 'failed',
  'pushing-error': 'failed',
};

/**
 * Local labels its database phase under a strict `if (includeSql)` guard, and
 * no other phase label in either service carries the word — so this match has
 * no false-positive path. It is used ONLY to turn `includesDb` ON when no
 * caller declared it (WP-14 scout finding 3); a caller's own value always wins.
 */
const DATABASE_PHASE = /database/i;

function operationTypeFromStatus(status: string): 'pull' | 'push' | 'export' {
  if (status.startsWith('pull')) return 'pull';
  if (status.startsWith('push')) return 'push';
  return 'export';
}

export interface OperationEvent {
  timestamp: number;
  label?: string;
  progressText?: string;
}

/**
 * What a CALLER knew when it started a sync, and the IPC stream never carries.
 * Supplied by the pull/push tool handlers through `register()`; absent for a
 * sync started from Local's own UI (WP-14).
 */
export interface SyncDetail {
  /** WP Engine install this sync moves against. */
  installName?: string;
  installId?: string;
  /** The WPE *site* UUID stored in the local site's hostConnections. */
  wpeSiteId?: string;
  /** Upstream environment as WP Engine labels it ('production', …). */
  environment?: string;
  /** Caller-declared and authoritative. Absent means "observe it". */
  includesDb?: boolean;
  /** Nexus' database-only pull: no files are synced. */
  databaseOnly?: boolean;
}

/** A finished sync, as observed. Consumed by the intelligence sync producer. */
export interface SyncObservation {
  siteId: string;
  siteName: string;
  type: 'pull' | 'push';
  outcome: 'succeeded' | 'failed';
  startedAt: number;
  finishedAt: number;
  /** Present only when a tool started this operation. */
  detail?: SyncDetail;
  /** A database phase was seen in Local's progress stream. */
  databasePhaseObserved: boolean;
}

export type SyncListener = (observation: SyncObservation) => void;

export interface TrackedOperation {
  operationId: string;
  siteId: string;
  siteName: string;
  type: 'pull' | 'push' | 'export';
  status: 'starting' | 'active' | 'completed' | 'error';
  localStatus: string;         // raw Local status string
  startedAt: number;
  completedAt?: number;
  durationSeconds?: number;
  lastMessage: string | null;
  recentEvents: OperationEvent[];
  /** WP-14: caller-declared facts, when `register()` supplied them. */
  detail?: SyncDetail;
  /** WP-14: set when Local reports a database phase for this operation. */
  databasePhaseObserved: boolean;
}

const MAX_EVENTS = 30;
const COMPLETED_TTL_MS = 10 * 60 * 1000; // keep completed ops for 10 min

export class OperationTracker {
  private _ops = new Map<string, TrackedOperation>();
  private _listening = false;
  private _syncListeners: SyncListener[] = [];

  start(): void {
    if (this._listening) return;
    this._listening = true;

    ipcMain.on('updateSiteStatus', (_event: any, siteId: string, status: string) => {
      this._onStatusUpdate(siteId, status);
    });

    ipcMain.on('updateSiteMessage', (_event: any, siteId: string, message: any) => {
      this._onMessageUpdate(siteId, message);
    });

    // WP-14: the outcome signal. See TERMINAL_BANNERS.
    ipcMain.on('showSiteBanner', (_event: any, banner: any) => {
      this._onSiteBanner(banner);
    });
  }

  /**
   * Subscribe to finished syncs (WP-14). Listeners are called for pulls and
   * pushes only — an export is not a sync — and their throws are contained:
   * an observer must never break the operation it observes.
   */
  onSync(listener: SyncListener): void {
    this._syncListeners.push(listener);
  }

  private _onStatusUpdate(siteId: string, status: string): void {
    if (ACTIVE_STATUSES.has(status)) {
      const existing = this._ops.get(siteId);
      if (!existing) {
        this._ops.set(siteId, {
          operationId: `${siteId}-${Date.now()}`,
          siteId,
          siteName: '',
          type: operationTypeFromStatus(status),
          status: 'active',
          localStatus: status,
          startedAt: Date.now(),
          lastMessage: null,
          recentEvents: [],
          databasePhaseObserved: false,
        });
      } else {
        existing.localStatus = status;
        existing.status = 'active';
      }
    } else if (status === 'running' || status === 'halted') {
      const op = this._ops.get(siteId);
      if (op && op.status === 'active') {
        op.status = 'completed';
        op.localStatus = status;
        op.completedAt = Date.now();
        op.durationSeconds = Math.round((op.completedAt - op.startedAt) / 1000);
        // Auto-clean after TTL
        setTimeout(() => {
          const current = this._ops.get(siteId);
          if (current?.operationId === op.operationId) {
            this._ops.delete(siteId);
          }
        }, COMPLETED_TTL_MS);
      }
    }
  }

  private _onMessageUpdate(siteId: string, message: any): void {
    const op = this._ops.get(siteId);
    if (!op) return;

    const label = typeof message === 'string' ? message : message?.label;
    const progressText = typeof message === 'object' ? message?.progressText : undefined;
    const text = [label, progressText].filter(Boolean).join(' — ');

    op.lastMessage = text || op.lastMessage;
    op.recentEvents.push({ timestamp: Date.now(), label, progressText });
    if (op.recentEvents.length > MAX_EVENTS) op.recentEvents.shift();

    // WP-14: the phase label is the only evidence a UI-initiated sync carried
    // the database. Latched ON only — a later file-copy label must not clear
    // a database phase that already happened.
    if (DATABASE_PHASE.test(label ?? '')) op.databasePhaseObserved = true;
  }

  /**
   * WP-14: a terminal banner ends the operation and says whether it worked.
   * Local sends this AFTER `updateSiteStatus → 'running'` on both paths, so
   * the operation is still in `_ops` (its cleanup is on a 10-minute TTL).
   */
  private _onSiteBanner(banner: any): void {
    const outcome = TERMINAL_BANNERS[String(banner?.id ?? '')];
    if (!outcome) return;
    const siteId = String(banner?.siteID ?? '');
    const op = this._ops.get(siteId);
    if (!op || (op.type !== 'pull' && op.type !== 'push')) return;

    const finishedAt = op.completedAt ?? Date.now();
    op.status = outcome === 'failed' ? 'error' : 'completed';
    op.completedAt = finishedAt;
    op.durationSeconds = Math.round((finishedAt - op.startedAt) / 1000);

    const observation: SyncObservation = {
      siteId: op.siteId,
      siteName: op.siteName,
      type: op.type,
      outcome,
      startedAt: op.startedAt,
      finishedAt,
      detail: op.detail,
      databasePhaseObserved: op.databasePhaseObserved,
    };
    for (const listener of this._syncListeners) {
      try {
        listener(observation);
      } catch {
        /* an observer must never break the operation it observes */
      }
    }
  }

  /**
   * Called by MCP tools when starting an operation — sets initial name.
   * `detail` (WP-14) carries what the caller knows and the IPC stream does
   * not; omitting it leaves the sync observed rather than declared.
   */
  register(
    siteId: string,
    siteName: string,
    type: 'pull' | 'push' | 'export',
    detail?: SyncDetail,
  ): string {
    const operationId = `${siteId}-${Date.now()}`;
    this._ops.set(siteId, {
      operationId,
      siteId,
      siteName,
      type,
      status: 'starting',
      localStatus: 'starting',
      startedAt: Date.now(),
      lastMessage: null,
      recentEvents: [],
      detail,
      databasePhaseObserved: false,
    });
    return operationId;
  }

  /** Mark an operation complete (used by export which doesn't emit IPC status events) */
  complete(siteId: string, message?: string): void {
    const op = this._ops.get(siteId);
    if (op) {
      op.status = 'completed';
      op.localStatus = 'completed';
      op.completedAt = Date.now();
      op.durationSeconds = Math.round((op.completedAt - op.startedAt) / 1000);
      if (message) op.lastMessage = message;
    }
  }

  /** Mark an operation failed */
  fail(siteId: string, message?: string): void {
    const op = this._ops.get(siteId);
    if (op) {
      op.status = 'error';
      op.localStatus = 'error';
      op.completedAt = Date.now();
      if (message) op.lastMessage = message;
    }
  }

  getOperation(siteId: string): TrackedOperation | undefined {
    return this._ops.get(siteId);
  }

  getAllActive(): TrackedOperation[] {
    return Array.from(this._ops.values()).filter((op) => op.status !== 'completed');
  }
}
