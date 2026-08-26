/**
 * fixes-082526 · the Background Work activity line — formatted once, in the
 * module the handoff names for every Settings number ("never restate a number
 * in a string literal"). The component renders the string; this owns it.
 */
import { formatPipelineActivityLine } from '../../../src/renderer/components/settings/derived';

const NOW = Date.parse('2026-08-26T14:00:00.000Z');

describe('formatPipelineActivityLine', () => {
  it('unavailable → says recording is off, not that nothing ran', () => {
    expect(formatPipelineActivityLine(null, NOW)).toBe(
      'Run history unavailable — background record-keeping is not running.'
    );
  });

  it('a live day → counts and the last finish, relative', () => {
    expect(
      formatPipelineActivityLine(
        { runs: 890, ok: 862, skip: 26, fail: 2, lastFinishedAt: new Date(NOW - 12 * 60_000).toISOString() },
        NOW,
      )
    ).toBe('Last 24 hours: 890 runs · 862 ok · 26 skipped · 2 failed · last finished 12 min ago');
  });

  it('zero failures drops the failed clause — a 0 in a failure slot reads as an all-clear claim', () => {
    expect(
      formatPipelineActivityLine(
        { runs: 4, ok: 4, skip: 0, fail: 0, lastFinishedAt: new Date(NOW - 2 * 3600_000).toISOString() },
        NOW,
      )
    ).toBe('Last 24 hours: 4 runs · 4 ok · last finished 2 h ago');
  });

  it('idle since yesterday ≠ never ran — both say so', () => {
    expect(
      formatPipelineActivityLine(
        { runs: 0, ok: 0, skip: 0, fail: 0, lastFinishedAt: new Date(NOW - 30 * 3600_000).toISOString() },
        NOW,
      )
    ).toBe('No background runs in the last 24 hours · last finished 30 h ago');
    expect(
      formatPipelineActivityLine({ runs: 0, ok: 0, skip: 0, fail: 0, lastFinishedAt: null }, NOW)
    ).toBe('No background runs recorded yet.');
  });

  it('a singular run reads as one', () => {
    expect(
      formatPipelineActivityLine(
        { runs: 1, ok: 1, skip: 0, fail: 0, lastFinishedAt: new Date(NOW - 30_000).toISOString() },
        NOW,
      )
    ).toBe('Last 24 hours: 1 run · 1 ok · last finished just now');
  });
});

// ---------------------------------------------------------------------------
// The section places the line (render pin, both states)
// ---------------------------------------------------------------------------
import * as React from 'react';
import { BackgroundWorkSection } from '../../../src/renderer/components/settings/BackgroundWorkSection';

function walk(node: any, out: any[] = []): any[] {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((x) => walk(x, out)); return out; }
  out.push(node);
  const kids = node?.props?.children;
  if (kids) walk(Array.isArray(kids) ? kids : [kids], out);
  return out;
}

const derived = {
  rows: [], summary: { wpe: null, ext: null, time: { minsPerDay: null, nextInHours: null, minsLabel: null, nextLabel: null } },
  navNote: '', switchableTotal: 0, switchableOn: 0, paused: false,
} as never;

describe('BackgroundWorkSection × the activity line', () => {
  it('renders the formatted line for a live day', () => {
    const tree = new BackgroundWorkSection({
      derived, onSave: () => {},
      activity: { runs: 3, ok: 3, skip: 0, fail: 0, lastFinishedAt: new Date(Date.now() - 30_000).toISOString() },
    } as never).render();
    const node = walk(tree).find((x) => x?.props?.['data-nexus-pipeline-activity']);
    expect(node.props.children).toBe('Last 24 hours: 3 runs · 3 ok · last finished just now');
  });

  it('a down core renders the unavailable sentence, never a false quiet', () => {
    const tree = new BackgroundWorkSection({ derived, onSave: () => {}, activity: null } as never).render();
    const node = walk(tree).find((x) => x?.props?.['data-nexus-pipeline-activity']);
    expect(node.props.children).toBe('Run history unavailable — background record-keeping is not running.');
  });
});
