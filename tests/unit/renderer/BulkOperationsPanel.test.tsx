/**
 * Unit tests for BulkOperationsPanel component
 */
import * as React from 'react';
import { BulkOperationsPanel } from '../../../src/renderer/components/BulkOperationsPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';
import type { BulkOperationStatus } from '../../../src/common/types';

function createMockOperations(): BulkOperationStatus[] {
  return [
    {
      id: 'op-1',
      type: 'reindex',
      siteIds: ['site-1', 'site-2', 'site-3'],
      status: 'running',
      progress: { completed: 1, total: 3, errors: [] },
      siteResults: {
        'site-1': { status: 'completed', startedAt: Date.now() - 5000, completedAt: Date.now() - 3800 },
        'site-2': { status: 'running', startedAt: Date.now() - 2000 },
        'site-3': { status: 'pending', startedAt: 0 },
      },
      createdAt: Date.now() - 60000,
      completedAt: null,
    },
    {
      id: 'op-2',
      type: 'plugin-update',
      siteIds: ['site-1', 'site-2'],
      status: 'completed',
      progress: { completed: 2, total: 2, errors: [] },
      siteResults: {
        'site-1': { status: 'completed', startedAt: Date.now() - 10000, completedAt: Date.now() - 9200 },
        'site-2': { status: 'completed', startedAt: Date.now() - 9000, completedAt: Date.now() - 8050 },
      },
      createdAt: Date.now() - 120000,
      completedAt: Date.now() - 60000,
    },
    {
      id: 'op-3',
      type: 'health-refresh',
      siteIds: ['site-4'],
      status: 'failed',
      progress: { completed: 1, total: 1, errors: ['Site not running'] },
      siteResults: {
        'site-4': { status: 'failed', startedAt: Date.now() - 30000, completedAt: Date.now() - 25000, error: 'Site not running' },
      },
      createdAt: Date.now() - 30000,
      completedAt: Date.now() - 25000,
    },
    {
      id: 'op-4',
      type: 'start',
      siteIds: ['site-5', 'site-6'],
      status: 'cancelled',
      progress: { completed: 1, total: 2, errors: [] },
      siteResults: {
        'site-5': { status: 'completed', startedAt: Date.now() - 45000, completedAt: Date.now() - 44500 },
        'site-6': { status: 'pending', startedAt: 0 },
      },
      createdAt: Date.now() - 45000,
      completedAt: Date.now() - 40000,
    },
  ];
}

function createMockElectron(
  operations: BulkOperationStatus[] = [],
  shouldFail = false,
) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, ..._args: any[]) => {
        if (channel === IPC_CHANNELS.BULK_LIST) {
          if (shouldFail) {
            return { success: false, error: 'Failed to fetch operations' };
          }
          return { success: true, operations };
        }
        if (channel === IPC_CHANNELS.BULK_CANCEL) {
          return { success: true };
        }
        return { success: false, error: 'Unknown channel' };
      }),
    },
  };
}

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

describe('BulkOperationsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render loading state initially', () => {
    const mockElectron = createMockElectron([]);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    expect(instance.state.loading).toBe(true);
    expect(instance.state.operations).toEqual([]);
    expect(instance.state.error).toBeNull();
    expect(instance.state.expandedId).toBeNull();
  });

  test('should render empty state when no operations', async () => {
    const mockElectron = createMockElectron([]);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.loading).toBe(false);
    expect(instance.state.operations).toEqual([]);
    expect(instance.state.error).toBeNull();
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.BULK_LIST);
  });

  test('should render operations list', async () => {
    const operations = createMockOperations();
    const mockElectron = createMockElectron(operations);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.loading).toBe(false);
    expect(instance.state.operations).toHaveLength(4);
    expect(instance.state.operations[0].id).toBe('op-1');
    expect(instance.state.operations[0].type).toBe('reindex');
    expect(instance.state.operations[1].id).toBe('op-2');
    expect(instance.state.operations[1].type).toBe('plugin-update');
  });

  test('should show status badge with correct values', async () => {
    const operations = createMockOperations();
    const mockElectron = createMockElectron(operations);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    const statuses = instance.state.operations.map((op: BulkOperationStatus) => op.status);
    expect(statuses).toContain('running');
    expect(statuses).toContain('completed');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('cancelled');

    expect(instance.state.operations[0].status).toBe('running');
    expect(instance.state.operations[1].status).toBe('completed');
    expect(instance.state.operations[2].status).toBe('failed');
    expect(instance.state.operations[3].status).toBe('cancelled');
  });

  test('should show progress for running operations', async () => {
    const operations = createMockOperations();
    const mockElectron = createMockElectron(operations);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    const runningOp = instance.state.operations.find((op: BulkOperationStatus) => op.status === 'running');
    expect(runningOp).toBeDefined();
    expect(runningOp!.progress.completed).toBe(1);
    expect(runningOp!.progress.total).toBe(3);

    const completedOp = instance.state.operations.find((op: BulkOperationStatus) => op.status === 'completed');
    expect(completedOp).toBeDefined();
    expect(completedOp!.progress.completed).toBe(completedOp!.progress.total);
  });

  test('should expand operation to show per-site results', async () => {
    const operations = createMockOperations();
    const mockElectron = createMockElectron(operations);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.expandedId).toBeNull();

    instance.handleToggleExpand('op-2');
    expect(instance.state.expandedId).toBe('op-2');

    const expandedOp = instance.state.operations.find((op: BulkOperationStatus) => op.id === 'op-2');
    expect(expandedOp).toBeDefined();
    expect(Object.keys(expandedOp!.siteResults)).toHaveLength(2);
    expect(expandedOp!.siteResults['site-1'].status).toBe('completed');
    expect(expandedOp!.siteResults['site-2'].status).toBe('completed');

    instance.handleToggleExpand('op-2');
    expect(instance.state.expandedId).toBeNull();
  });

  test('should handle cancel button click for running ops', async () => {
    const operations = createMockOperations();
    const mockElectron = createMockElectron(operations);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    const mockEvent = { stopPropagation: jest.fn() } as any;
    await instance.handleCancel(mockEvent, 'op-1');

    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.BULK_CANCEL, 'op-1');
  });

  test('should handle fetch error gracefully', async () => {
    const mockElectron = createMockElectron([], true);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.loading).toBe(false);
    expect(instance.state.operations).toEqual([]);
    expect(instance.state.error).toBe('Failed to fetch operations');
  });

  test('should show completedAt for finished operations', async () => {
    const operations = createMockOperations();
    const mockElectron = createMockElectron(operations);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    const completedOp = instance.state.operations.find((op: BulkOperationStatus) => op.status === 'completed');
    expect(completedOp).toBeDefined();
    expect(completedOp!.completedAt).toBeDefined();
    expect(typeof completedOp!.completedAt).toBe('number');

    const failedOp = instance.state.operations.find((op: BulkOperationStatus) => op.status === 'failed');
    expect(failedOp).toBeDefined();
    expect(failedOp!.completedAt).toBeDefined();

    const runningOp = instance.state.operations.find((op: BulkOperationStatus) => op.status === 'running');
    expect(runningOp).toBeDefined();
    expect(runningOp!.completedAt).toBeNull();
  });

  test('should identify cancellable vs non-cancellable operations', async () => {
    const operations = createMockOperations();
    const mockElectron = createMockElectron(operations);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    spySetState(instance);
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    const cancellable = instance.state.operations.filter(
      (op: BulkOperationStatus) => op.status === 'running',
    );
    const nonCancellable = instance.state.operations.filter(
      (op: BulkOperationStatus) => op.status !== 'running',
    );

    expect(cancellable).toHaveLength(1);
    expect(cancellable[0].id).toBe('op-1');
    expect(nonCancellable).toHaveLength(3);
  });

  test('should format time correctly', () => {
    const mockElectron = createMockElectron([]);
    const instance = new BulkOperationsPanel({ electron: mockElectron });

    expect(instance.formatTime(Date.now())).toBe('Just now');
    expect(instance.formatTime(Date.now() - 120000)).toBe('2m ago');
    expect(instance.formatTime(Date.now() - 7200000)).toBe('2h ago');
  });
});
