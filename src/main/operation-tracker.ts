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

import { ipcMain } from 'electron';

// Status strings emitted by Local during operations
const ACTIVE_STATUSES = new Set([
  'pulling',
  'pulling_provisioning',
  'pushing_v2',
  'exporting',
]);

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
}

const MAX_EVENTS = 30;
const COMPLETED_TTL_MS = 10 * 60 * 1000; // keep completed ops for 10 min

export class OperationTracker {
  private _ops = new Map<string, TrackedOperation>();
  private _listening = false;

  start(): void {
    if (this._listening) return;
    this._listening = true;

    ipcMain.on('updateSiteStatus', (_event: any, siteId: string, status: string) => {
      this._onStatusUpdate(siteId, status);
    });

    ipcMain.on('updateSiteMessage', (_event: any, siteId: string, message: any) => {
      this._onMessageUpdate(siteId, message);
    });
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
  }

  /** Called by MCP tools when starting an operation — sets initial name */
  register(siteId: string, siteName: string, type: 'pull' | 'push' | 'export'): string {
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
