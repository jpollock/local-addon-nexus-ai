import { LoggingSection } from '../../../src/renderer/components/LoggingSection';
import type { NexusSettings } from '../../../src/common/types';

function flatten(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join(' ');
  return node.props ? flatten(node.props.children) : '';
}

const STATS = {
  root: '/Users/x/Library/Application Support/Local/nexus-ai/logs',
  totalBytes: 12 * 1024 * 1024,
  byCategory: { combined: 6 * 1024 * 1024, agent: 4 * 1024 * 1024, transcript: 1024 * 1024, audit: 1024 * 1024 },
  policy: { logDays: 14, transcriptDays: 3, budgetBytes: 250 * 1024 * 1024 },
};

const SETTINGS: NexusSettings = {
  autoIndex: true,
  excludedSiteIds: [],
  logRetentionDays: 14,
  transcriptRetentionDays: 3,
  logBudgetBytes: 250 * 1024 * 1024,
  logLevel: 'INFO',
};

describe('LoggingSection', () => {
  it('shows where the logs are, so the answer is not "somewhere"', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined, settings: SETTINGS });
    expect(flatten(s.render())).toContain('nexus-ai/logs');
  });

  it('breaks the size down by category rather than one opaque total', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined, settings: SETTINGS });
    const text = flatten(s.render());
    for (const label of ['Combined', 'Per-agent', 'Transcripts', 'Audit']) {
      expect(text).toContain(label);
    }
  });

  it('states the budget as well as the usage', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined, settings: SETTINGS });
    expect(flatten(s.render())).toMatch(/12(\.0)? MB.*250(\.0)? MB/s);
  });

  it('says what Clear logs will delete BEFORE deleting it', () => {
    // Deleting evidence on a button press with no statement of what goes is the one thing this
    // panel must not do.
    const s: any = new LoggingSection({ stats: STATS, electron: undefined, settings: SETTINGS });
    s.state = { ...s.state, confirmingClear: true };
    const text = flatten(s.render());
    expect(text).toMatch(/will delete/i);
    expect(text).toContain('MB');
  });

  it('renders without stats, while they are still loading', () => {
    const s: any = new LoggingSection({ stats: null, electron: undefined, settings: SETTINGS });
    expect(() => s.render()).not.toThrow();
  });

  it('renders editable controls for retention and level, not just labels', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined, settings: SETTINGS });
    const rendered = s.render();
    // The controls must be inputs/selects, not just text
    let foundLevelSelect = false;
    let foundLogDaysInput = false;
    let foundTranscriptDaysInput = false;
    let foundBudgetInput = false;

    function walk(node: any): void {
      if (!node) return;
      if (node.type === 'select' && node.props?.onChange === s.handleLevelChange) foundLevelSelect = true;
      if (node.type === 'input' && node.props?.onChange === s.handleLogDaysChange) foundLogDaysInput = true;
      if (node.type === 'input' && node.props?.onChange === s.handleTranscriptDaysChange) foundTranscriptDaysInput = true;
      if (node.type === 'input' && node.props?.onChange === s.handleBudgetChange) foundBudgetInput = true;
      if (node.props?.children) {
        const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
        children.forEach(walk);
      }
    }

    walk(rendered);
    expect(foundLevelSelect).toBe(true);
    expect(foundLogDaysInput).toBe(true);
    expect(foundTranscriptDaysInput).toBe(true);
    expect(foundBudgetInput).toBe(true);
  });

  it('surfaces PRICES_AS_OF so cost figures carry an auditable date', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined, settings: SETTINGS });
    const text = flatten(s.render());
    // Must contain a year-like pattern near "pricing" or "as of"
    expect(text).toMatch(/(?:pricing|as of).*202\d/i);
  });

  it('writes logRetentionDays (not logDays) so retention code reads the change', () => {
    const mockInvoke = jest.fn();
    const electron = { ipcRenderer: { invoke: mockInvoke } };
    const s: any = new LoggingSection({ stats: STATS, electron, settings: SETTINGS });

    s.handleLogDaysChange({ target: { value: '30' } } as any);

    expect(mockInvoke).toHaveBeenCalledWith(expect.anything(), { logRetentionDays: 30 });
    // Must NOT write logDays — retention code does not read it
    expect(mockInvoke).not.toHaveBeenCalledWith(expect.anything(), { logDays: 30 });
  });
});
