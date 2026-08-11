import * as React from 'react';

// Import the RunIdDisplay component indirectly by importing the whole module
// and extracting it since it's not exported
const RunDrawerModule = require('../../../src/renderer/components/agents/RunDrawer');

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

// Extract RunIdDisplay from the module's private scope by rendering a drawer with runIds
function getRunIdDisplayInstance(runIds: string[]) {
  // We need to access the private RunIdDisplay class, but since it's not exported,
  // we'll test it through the RunDrawer instead
  const { RunDrawer } = RunDrawerModule;
  const runStore = require('../../../src/renderer/components/agents/RunStore').runStore;

  // Set up a completed run with runIds
  runStore.startRun({
    runId: 'test-run',
    agentId: 'test-agent',
    agentName: 'Test Agent',
    siteNames: runIds.map((_, i) => `site-${i}`),
  });
  runStore.completeRun({
    runId: 'test-run',
    runIds,
    doneCount: runIds.length,
    failedCount: 0,
    findingsSites: [],
  });
  runStore.setState({ drawerOpen: true });

  const drawer = new RunDrawer({ electron: {} });
  spySetState(drawer);
  return { drawer, runStore };
}

function flattenText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
}

function findElementsByType(node: any, type: string): any[] {
  const results: any[] = [];
  if (node?.type === type) results.push(node);
  if (Array.isArray(node)) {
    node.forEach(child => results.push(...findElementsByType(child, type)));
  } else if (node?.props?.children) {
    const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    children.forEach((child: any) => results.push(...findElementsByType(child, type)));
  }
  return results;
}

describe('RunDrawer runIds display', () => {
  afterEach(() => {
    const runStore = require('../../../src/renderer/components/agents/RunStore').runStore;
    runStore.dismissRun();
  });

  it('shows the Run IDs section when run completes with runIds', () => {
    const { drawer, runStore: store } = getRunIdDisplayInstance(['r_abc123']);
    const tree = drawer.render();

    // Verify the run has runIds
    const run = store.getState().currentRun;
    expect(run).toBeTruthy();
    expect(run!.runIds).toEqual(['r_abc123']);
    expect(run!.phase).toBe('done');

    const text = flattenText(tree);
    expect(text).toContain('Run IDs (for grep)');
  });

  it('shows the Run IDs section for multiple runIds', () => {
    const { drawer, runStore: store } = getRunIdDisplayInstance(['r_first', 'r_second', 'r_third']);
    const tree = drawer.render();

    const run = store.getState().currentRun;
    expect(run).toBeTruthy();
    expect(run!.runIds).toEqual(['r_first', 'r_second', 'r_third']);

    const text = flattenText(tree);
    expect(text).toContain('Run IDs (for grep)');
  });

  it('does not show the run IDs section when runIds is empty', () => {
    const { drawer } = getRunIdDisplayInstance([]);
    const tree = drawer.render();
    const text = flattenText(tree);

    expect(text).not.toContain('Run IDs (for grep)');
  });

  it('does not show the run IDs section when the run is still running', () => {
    const runStore = require('../../../src/renderer/components/agents/RunStore').runStore;
    runStore.startRun({
      runId: 'running-test',
      agentId: 'test-agent',
      agentName: 'Test Agent',
      siteNames: ['site-1'],
    });
    runStore.setState({ drawerOpen: true });

    const { RunDrawer } = RunDrawerModule;
    const drawer = new RunDrawer({ electron: {} });
    spySetState(drawer);
    const tree = drawer.render();
    const text = flattenText(tree);

    expect(text).not.toContain('Run IDs (for grep)');
  });
});
