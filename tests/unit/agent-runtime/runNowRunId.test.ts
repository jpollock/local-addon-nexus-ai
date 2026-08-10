import { collectRunIds } from '../../../src/main/agent-runtime/runNowIds';

describe('collectRunIds', () => {
  it('returns the runner ids, in site order', () => {
    expect(collectRunIds([
      { site: 'a', result: { runId: 'r_1' } },
      { site: 'b', result: { runId: 'r_2' } },
    ] as any)).toEqual(['r_1', 'r_2']);
  });

  it('skips a run that produced no id rather than inserting a hole', () => {
    expect(collectRunIds([
      { site: 'a', result: { runId: 'r_1' } },
      { site: 'b', result: {} },
    ] as any)).toEqual(['r_1']);
  });

  it('is empty, not undefined, when nothing ran', () => {
    expect(collectRunIds([])).toEqual([]);
  });
});
