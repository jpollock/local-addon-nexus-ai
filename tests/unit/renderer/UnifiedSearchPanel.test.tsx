/**
 * Unit tests for UnifiedSearchPanel component
 */
import * as React from 'react';
import { UnifiedSearchPanel } from '../../../src/renderer/components/UnifiedSearchPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockElectron(response?: any) {
  return {
    ipcRenderer: {
      invoke: jest.fn().mockResolvedValue(
        response ?? { results: [], total: 0 },
      ),
    },
  };
}

function createInstance(electronOverride?: any, onResultClick?: (r: any) => void) {
  const electron = electronOverride ?? createMockElectron();
  const instance = new UnifiedSearchPanel({ electron, onResultClick });

  // Wire up setState so it mutates state in-place (no real DOM)
  jest.spyOn(instance, 'setState').mockImplementation(function (
    this: UnifiedSearchPanel,
    updaterOrState: any,
    callback?: () => void,
  ) {
    const update =
      typeof updaterOrState === 'function'
        ? updaterOrState(this.state)
        : updaterOrState;
    Object.assign(this.state, update);
    if (callback) callback();
  });

  return { instance, electron };
}

const sampleResults = [
  {
    id: '1',
    type: 'post',
    title: 'Hello World',
    siteName: 'My Site',
    score: 0.95,
    excerpt: 'Welcome to WordPress.',
  },
  {
    id: '2',
    type: 'plugin',
    title: 'Akismet',
    siteName: 'My Site',
    score: 0.8,
    excerpt: 'Anti-spam plugin.',
  },
  {
    id: '3',
    type: 'theme',
    title: 'Twenty Twenty-Four',
    siteName: 'Blog',
    score: 0.6,
    excerpt: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnifiedSearchPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // 1. Renders search input
  test('should render search input element', () => {
    const { instance } = createInstance();
    const inputNode = instance.renderSearchInput();

    // renderSearchInput returns a React element tree; verify it exists
    expect(inputNode).toBeDefined();
    expect(inputNode).not.toBeNull();
  });

  // 2. Debounces search input
  test('should debounce search input by 300ms', async () => {
    const mockElectron = createMockElectron({ results: sampleResults, total: 3 });
    const { instance } = createInstance(mockElectron);
    instance._mounted = true;

    // Simulate typing
    instance.handleSearchChange({ target: { value: 'hello' } });

    // IPC should NOT have been called yet (still within debounce window)
    expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
    expect(instance.state.query).toBe('hello');

    // Advance past debounce
    jest.advanceTimersByTime(300);

    // performSearch is async; flush promise queue
    await Promise.resolve();

    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.SEARCH_UNIFIED,
      'hello',
      { contentTypes: undefined },
      { limit: 20, offset: 0, vectorSearch: true },
    );
  });

  // 3. Shows loading state during search
  test('should show loading state while search is in progress', () => {
    const { instance } = createInstance();
    instance.state.loading = true;
    instance.state.results = [];

    const rendered = instance.renderResults();
    // Should return the loading element (not empty state)
    expect(rendered).toBeDefined();
    expect(rendered).not.toBeNull();

    // Also verify renderLoadingState directly
    const loadingNode = instance.renderLoadingState();
    expect(loadingNode).toBeDefined();
  });

  // 4. Renders results list
  test('should render results list with items', async () => {
    const mockElectron = createMockElectron({
      results: sampleResults,
      total: 3,
    });
    const { instance } = createInstance(mockElectron);
    instance._mounted = true;

    instance.state.query = 'hello';
    await instance.performSearch();

    expect(instance.state.results).toHaveLength(3);
    expect(instance.state.totalResults).toBe(3);
    expect(instance.state.loading).toBe(false);

    // Verify each result item renders
    sampleResults.forEach((_, i) => {
      const item = instance.renderResultItem(instance.state.results[i], i);
      expect(item).toBeDefined();
      expect(item).not.toBeNull();
    });

    // Full results section should render
    const resultsNode = instance.renderResults();
    expect(resultsNode).toBeDefined();
  });

  // 5. Shows empty state when no results
  test('should show empty state when no results and query is present', () => {
    const { instance } = createInstance();
    instance.state.query = 'nonexistent';
    instance.state.results = [];
    instance.state.totalResults = 0;
    instance.state.loading = false;
    instance.state.error = null;

    const rendered = instance.renderEmptyState();
    expect(rendered).toBeDefined();

    // Also check the default empty state (no query)
    instance.state.query = '';
    const defaultEmpty = instance.renderEmptyState();
    expect(defaultEmpty).toBeDefined();
  });

  // 6. Content type filter toggles work
  test('should toggle content type filters', () => {
    const { instance } = createInstance();
    instance._mounted = true;

    expect(instance.state.contentTypeFilters).toEqual([]);

    // Toggle 'post' on
    instance.toggleFilter('post');
    expect(instance.state.contentTypeFilters).toContain('post');

    // Toggle 'plugin' on
    instance.toggleFilter('plugin');
    expect(instance.state.contentTypeFilters).toContain('post');
    expect(instance.state.contentTypeFilters).toContain('plugin');

    // Toggle 'post' off
    instance.toggleFilter('post');
    expect(instance.state.contentTypeFilters).not.toContain('post');
    expect(instance.state.contentTypeFilters).toContain('plugin');
  });

  // 7. Advanced filters toggle shows/hides
  test('should toggle advanced filters visibility', () => {
    const { instance } = createInstance();

    expect(instance.state.showAdvanced).toBe(false);

    instance.toggleAdvanced();
    expect(instance.state.showAdvanced).toBe(true);

    instance.toggleAdvanced();
    expect(instance.state.showAdvanced).toBe(false);
  });

  // 8. Error state displays correctly
  test('should display error state when search fails', async () => {
    const mockElectron = {
      ipcRenderer: {
        invoke: jest.fn().mockRejectedValue(new Error('Network failure')),
      },
    };
    const { instance } = createInstance(mockElectron);
    instance._mounted = true;
    instance.state.query = 'test';

    await instance.performSearch();

    expect(instance.state.error).toBe('Network failure');
    expect(instance.state.loading).toBe(false);

    const errorNode = instance.renderErrorState();
    expect(errorNode).toBeDefined();
    expect(errorNode).not.toBeNull();

    // renderResults should also return the error state
    const resultsNode = instance.renderResults();
    expect(resultsNode).toBeDefined();
  });

  // Bonus: lifecycle
  test('should clean up timeout on unmount', () => {
    const { instance } = createInstance();
    instance.componentDidMount();
    expect(instance._mounted).toBe(true);

    // Start a search to create a pending timeout
    instance.handleSearchChange({ target: { value: 'test' } });
    expect(instance._searchTimeout).not.toBeNull();

    instance.componentWillUnmount();
    expect(instance._mounted).toBe(false);
    expect(instance._searchTimeout).toBeNull();
  });

  // Bonus: pagination
  test('should load more results', async () => {
    const page1 = sampleResults;
    const page2 = [
      { id: '4', type: 'user', title: 'Admin', siteName: 'Blog', score: 0.5 },
    ];

    let callCount = 0;
    const mockElectron = {
      ipcRenderer: {
        invoke: jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return { results: page1, total: 4 };
          }
          return { results: page2, total: 4 };
        }),
      },
    };

    const { instance } = createInstance(mockElectron);
    instance._mounted = true;
    instance.state.query = 'test';

    // First search
    await instance.performSearch();
    expect(instance.state.results).toHaveLength(3);
    expect(instance.state.totalResults).toBe(4);

    // Load more
    await instance.loadMore();
    expect(instance.state.results).toHaveLength(4);
    expect(instance.state.currentPage).toBe(1);

    // Second call should have offset = 20
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.SEARCH_UNIFIED,
      'test',
      { contentTypes: undefined },
      { limit: 20, offset: 20, vectorSearch: true },
    );
  });
});
