/**
 * The bulk bar's four states, one per acceptance criterion in BULK-OPERATIONS.md.
 *
 * SERIALIZATION: as in sites-tab.test.ts, these drive `new SitesTab(props).render()`.
 * Serializing `createElement(SitesTab, props)` would serialize the props bag, making
 * every assertion here vacuous — the job object would "appear" in the output whatever
 * the component drew.
 */
import { SitesTab, bulkJobLabel, formatStartedAt, type BulkJobView } from '../../../src/renderer/components/tabs/SitesTab';
import { bulkTypeLabel } from '../../../src/renderer/components/BulkOperationsPanel';
import { serializeTree } from './helpers/serializeTree';

const row = (over: any = {}) => ({
  id: 'L1', name: 'My Site', source: 'local', host: null, domain: null,
  status: 'running', wpVersion: '6.5', phpVersion: '8.2',
  knowledge: 'searchable', lastSyncAt: null, ...over,
});

const props = (over: any = {}) => ({
  loaded: true, failed: false,
  rows: [row(), row({ id: 'W1', name: 'Remote', source: 'wpe' })],
  total: { count: 2, scope: 'installs' },
  selected: [], onToggle: jest.fn(), onToggleAll: jest.fn(),
  onBulk: jest.fn(), onIndexHost: jest.fn(), onRetry: jest.fn(),
  job: null, onCancelJob: jest.fn(), onDismissJob: jest.fn(), onSelectFailed: jest.fn(),
  ...over,
});

const render = (over: any = {}) => new (SitesTab as any)(props(over)).render();
const text = (over: any = {}) => JSON.stringify(serializeTree(render(over)));

const job = (over: Partial<BulkJobView> = {}): BulkJobView => ({
  phase: 'running', type: 'reindex', siteIds: ['L1', 'W1'],
  startedAt: Date.now(), completed: 1, total: 2, failed: 0, failedIds: [], ...over,
});

describe('bulk bar — criterion 1: nothing runs on an empty selection', () => {
  it('disables both actions at 0 selected', () => {
    const out = text({ selected: [] });
    // Both buttons present and both disabled — "cannot start anything" is the claim.
    expect(out).toContain('Refresh metadata');
    expect(out).toContain('Index content');
    expect((out.match(/"disabled":true/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('does not call onBulk when invoked programmatically with an empty selection', () => {
    // `disabled` is a visual guard a keyboard or programmatic caller walks straight past.
    // This drives the handler directly, which is the path that actually dispatches.
    const p = props({ selected: [] });
    new (SitesTab as any)(p).handleBulk('reindex');
    expect(p.onBulk).not.toHaveBeenCalled();
  });

  it('passes exactly the ticked ids, never the whole fleet', () => {
    const p = props({ selected: ['L1'] });
    new (SitesTab as any)(p).handleBulk('reindex');
    expect(p.onBulk).toHaveBeenCalledWith('reindex', ['L1']);
  });
});

describe('bulk bar — criterion 2: acting on everything is explicit', () => {
  it('offers "Select all" once the filtered set is fully ticked', () => {
    const inst = new (SitesTab as any)(props({ selected: ['W1'] }));
    inst.state = { filter: 'wpe' }; // one visible row, and it is selected
    expect(JSON.stringify(serializeTree(inst.render()))).toContain('Select all 2');
  });

  it('does not offer it when the filtered set is only partly ticked', () => {
    const inst = new (SitesTab as any)(props({ selected: [] }));
    inst.state = { filter: 'wpe' };
    // 'Select all N' — the bare phrase collides with the header checkbox's aria-label.
    expect(JSON.stringify(serializeTree(inst.render()))).not.toContain('Select all 2');
  });

  it('does not offer it when the filter already shows everything', () => {
    // Nothing beyond the visible set, so there is nothing to escalate to.
    const inst = new (SitesTab as any)(props({ selected: ['L1', 'W1'] }));
    inst.state = { filter: 'all' };
    expect(JSON.stringify(serializeTree(inst.render()))).not.toContain('Select all 2');
  });
});

describe('bulk bar — criterion 3/6: the job replaces the bar, in place', () => {
  it('shows the job instead of the selection bar, not alongside it', () => {
    const out = text({ selected: ['L1', 'W1'], job: job() });
    expect(out).toContain('Indexing content on 2 sites');
    // The selection bar's own controls are gone — one bar, one position, four states.
    expect(out).not.toContain('2 of 2 selected');
  });

  it('renders a job in the very first phase, before any opId exists', () => {
    // This is the frame the old code left empty: clicked, selection cleared, panel below
    // not yet rendered. 'starting' exists so the bar changes in the same paint.
    const out = text({ selected: ['L1', 'W1'], job: job({ phase: 'starting' }) });
    expect(out).toContain('Indexing content on 2 sites');
    expect(out).toContain('Starting');
  });

  it('offers Cancel while running and Dismiss when finished', () => {
    expect(text({ job: job() })).toContain('Cancel');
    expect(text({ job: job({ phase: 'result', completed: 2 }) })).toContain('Dismiss');
  });

  it('cannot cancel before the job has an id to cancel', () => {
    const out = text({ job: job({ phase: 'starting' }) });
    expect(out).toContain('"disabled":true');
  });
});

describe('bulk bar — criterion 4: rows stay checked for the duration', () => {
  it('dims the rows in the job but leaves them ticked', () => {
    const out = text({ selected: ['L1', 'W1'], job: job() });
    expect(out).toContain('"opacity":0.6');
    // Still checked: the selection is the input to the action, not consumed by it.
    expect(out).toContain('"checked":true');
  });

  it('dims only the rows the job is acting on', () => {
    const out = text({ selected: ['L1'], job: job({ siteIds: ['L1'] }) });
    expect((out.match(/"opacity":0\.6/g) || []).length).toBe(1);
  });

  it('stops dimming once the job finishes', () => {
    const out = text({ selected: ['L1', 'W1'], job: job({ phase: 'result', completed: 2 }) });
    expect(out).not.toContain('"opacity":0.6');
  });
});

describe('bulk bar — criterion 5: the label is the action, not the job class', () => {
  it('never renders the internal type', () => {
    const out = text({ job: job({ type: 'sync-graph' }) });
    expect(out).not.toContain('sync-graph');
    expect(out).toContain('Refreshing metadata on 2 sites');
  });

  it('derives running and finished labels from the button that started it', () => {
    expect(bulkJobLabel(job({ type: 'reindex' }))).toBe('Indexing content on 2 sites');
    expect(bulkJobLabel(job({ type: 'sync-graph' }))).toBe('Refreshing metadata on 2 sites');
    expect(bulkJobLabel(job({ phase: 'result', type: 'reindex' }))).toBe('Indexed 2 sites');
  });

  it('names failures in the result, and says nothing when there are none', () => {
    expect(bulkJobLabel(job({ phase: 'result', failed: 4 }))).toBe('Indexed 2 sites · 4 failed');
    expect(bulkJobLabel(job({ phase: 'result', failed: 0 }))).toBe('Indexed 2 sites');
  });

  it('singularises one site', () => {
    expect(bulkJobLabel(job({ total: 1 }))).toBe('Indexing content on 1 site');
  });

  it('offers the failures as a selection in one click', () => {
    const out = text({ job: job({ phase: 'result', failed: 1, failedIds: ['W1'] }) });
    expect(out).toContain('Select failed');
  });

  it('does not offer it when nothing failed', () => {
    expect(text({ job: job({ phase: 'result' }) })).not.toContain('Select failed');
  });

  it('BulkOperationsPanel maps every job type to words', () => {
    // The other surface that renders a job type. It printed op.type raw.
    expect(bulkTypeLabel('sync-graph')).toBe('Refresh metadata');
    expect(bulkTypeLabel('reindex')).toBe('Index content');
    // Unmapped types de-slug rather than leaking the identifier verbatim.
    expect(bulkTypeLabel('some-new-op')).toBe('Some new op');
  });
});

describe('bulk bar — supporting behaviour', () => {
  it('reports elapsed time without inventing an estimate', () => {
    const t0 = 1_700_000_000_000;
    expect(formatStartedAt(t0, t0 + 5_000)).toBe('started just now');
    expect(formatStartedAt(t0, t0 + 300_000)).toBe('started 5 min ago');
  });

  it('surfaces a start failure instead of a stuck progress bar', () => {
    const out = text({ job: job({ phase: 'error', error: 'Manager unavailable' }) });
    expect(out).toContain('Manager unavailable');
    expect(out).not.toContain('Running');
  });

  it('changing the filter dismisses a finished job', () => {
    const p = props({ job: job({ phase: 'result' }) });
    const inst = new (SitesTab as any)(p);
    inst.setState = (s: any) => { inst.state = { ...inst.state, ...s }; };
    // Drive the rendered filter button rather than calling the handler by name.
    const filters = serializeTree(inst.render());
    expect(JSON.stringify(filters)).toContain('This Mac');
    inst.render();
    const btn = findFilterButton(inst.render(), 'This Mac');
    btn.props.onClick();
    expect(p.onDismissJob).toHaveBeenCalled();
  });

  it('does not dismiss a still-running job on a filter change', () => {
    const p = props({ job: job({ phase: 'running' }) });
    const inst = new (SitesTab as any)(p);
    inst.setState = (s: any) => { inst.state = { ...inst.state, ...s }; };
    findFilterButton(inst.render(), 'This Mac').props.onClick();
    expect(p.onDismissJob).not.toHaveBeenCalled();
  });
});

/** Depth-first search for a button element whose only child is `label`. */
function findFilterButton(node: any, label: string): any {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && node.props?.children === label) return node;
  const kids = node.props?.children;
  const flat = Array.isArray(kids) ? kids : [kids];
  for (const k of flat) {
    const hit = findFilterButton(k, label);
    if (hit) return hit;
  }
  return null;
}
