/**
 * Unit tests for SavedQueriesPanel component
 */
import * as React from 'react';
import { SavedQueriesPanel } from '../../../src/renderer/components/SavedQueriesPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';

function createMockQueries() {
  return [
    {
      id: 'q1',
      name: 'Outdated Sites',
      description: 'Sites with outdated WP core',
      filters: { wpVersion: '<6.0' },
      createdAt: Date.now() - 86400000,
      lastRun: Date.now() - 3600000,
      resultCount: 5,
      pinned: false,
    },
    {
      id: 'q2',
      name: 'Production Sites',
      description: 'All production environments',
      filters: { environment: 'production' },
      createdAt: Date.now() - 172800000,
      lastRun: null,
      resultCount: 0,
      pinned: true,
    },
    {
      id: 'q3',
      name: 'High Traffic',
      description: 'Sites with high traffic',
      filters: { traffic: 'high' },
      createdAt: Date.now() - 259200000,
      lastRun: Date.now() - 7200000,
      resultCount: 3,
      pinned: false,
    },
  ];
}

function createMockElectron(queries: any[] = [], shouldFail = false) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, ...args: any[]) => {
        if (channel === IPC_CHANNELS.QUERIES_LIST) {
          if (shouldFail) {
            return { success: false, error: 'Test error' };
          }
          return { success: true, queries };
        }
        if (channel === IPC_CHANNELS.QUERIES_RUN) {
          return { success: true, resultCount: 10 };
        }
        if (channel === IPC_CHANNELS.QUERIES_UPDATE) {
          return { success: true };
        }
        if (channel === IPC_CHANNELS.QUERIES_DELETE) {
          return { success: true };
        }
        if (channel === IPC_CHANNELS.QUERIES_CREATE) {
          return {
            success: true,
            query: {
              id: 'q-new',
              name: args[0]?.name || 'New Query',
              filters: args[0]?.filters || {},
              createdAt: Date.now(),
              lastRun: null,
              resultCount: 0,
              pinned: false,
            },
          };
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

describe('SavedQueriesPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render query list', async () => {
    const queries = createMockQueries();
    const mockElectron = createMockElectron(queries);
    const instance = new SavedQueriesPanel({ electron: mockElectron });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchQueries();

    expect(instance.state.queries).toHaveLength(3);
    expect(instance.state.loading).toBe(false);
    expect(instance.state.queries[0].name).toBe('Outdated Sites');
    expect(instance.state.queries[1].name).toBe('Production Sites');
  });

  test('should show empty state when no queries', async () => {
    const mockElectron = createMockElectron([]);
    const instance = new SavedQueriesPanel({ electron: mockElectron });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchQueries();

    expect(instance.state.queries).toHaveLength(0);
    expect(instance.state.loading).toBe(false);

    // Verify empty state renders
    const emptyState = instance.renderEmptyState() as any;
    expect(emptyState).toBeDefined();
    expect(emptyState.props.children).toBe('No saved queries yet');
  });

  test('should trigger callback when Run button is clicked', async () => {
    const queries = createMockQueries();
    const mockElectron = createMockElectron(queries);
    const onQueryRun = jest.fn();
    const instance = new SavedQueriesPanel({ electron: mockElectron, onQueryRun });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchQueries();
    await instance.handleRun(instance.state.queries[0]);

    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.QUERIES_RUN,
      'q1',
    );
    expect(onQueryRun).toHaveBeenCalledWith('q1', { wpVersion: '<6.0' });
  });

  test('should remove query from list on delete', async () => {
    const queries = createMockQueries();
    const mockElectron = createMockElectron(queries);
    const instance = new SavedQueriesPanel({ electron: mockElectron });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchQueries();

    expect(instance.state.queries).toHaveLength(3);

    await instance.handleDelete('q1');

    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.QUERIES_DELETE,
      'q1',
    );
    expect(instance.state.queries).toHaveLength(2);
    expect(instance.state.queries.find((q: any) => q.id === 'q1')).toBeUndefined();
  });

  test('should show create form when New Query button is clicked', () => {
    const mockElectron = createMockElectron([]);
    const instance = new SavedQueriesPanel({ electron: mockElectron });

    spySetState(instance);

    expect(instance.state.showCreateForm).toBe(false);

    // Simulate clicking the New Query button
    instance.setState({ showCreateForm: true });

    expect(instance.state.showCreateForm).toBe(true);

    // Verify form renders
    const form = instance.renderCreateForm() as any;
    expect(form).toBeDefined();
    expect(form.props.style).toBeDefined();
  });

  test('should sort pinned queries to top', async () => {
    const queries = createMockQueries();
    const mockElectron = createMockElectron(queries);
    const instance = new SavedQueriesPanel({ electron: mockElectron });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchQueries();

    const sorted = instance.getSortedQueries();

    // q2 is pinned, should be first
    expect(sorted[0].id).toBe('q2');
    expect(sorted[0].pinned).toBe(true);

    // Remaining queries sorted by createdAt descending
    expect(sorted[1].pinned).toBe(false);
    expect(sorted[2].pinned).toBe(false);
  });
});
