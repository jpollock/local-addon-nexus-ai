import { LoggingSection } from '../../../src/renderer/components/LoggingSection';

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

describe('LoggingSection', () => {
  it('shows where the logs are, so the answer is not "somewhere"', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    expect(flatten(s.render())).toContain('nexus-ai/logs');
  });

  it('breaks the size down by category rather than one opaque total', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    const text = flatten(s.render());
    for (const label of ['Combined', 'Per-agent', 'Transcripts', 'Audit']) {
      expect(text).toContain(label);
    }
  });

  it('states the budget as well as the usage', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    expect(flatten(s.render())).toMatch(/12(\.0)? MB.*250(\.0)? MB/s);
  });

  it('says what Clear logs will delete BEFORE deleting it', () => {
    // Deleting evidence on a button press with no statement of what goes is the one thing this
    // panel must not do.
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    s.state = { ...s.state, confirmingClear: true };
    const text = flatten(s.render());
    expect(text).toMatch(/will delete/i);
    expect(text).toContain('MB');
  });

  it('renders without stats, while they are still loading', () => {
    const s: any = new LoggingSection({ stats: null, electron: undefined });
    expect(() => s.render()).not.toThrow();
  });
});
