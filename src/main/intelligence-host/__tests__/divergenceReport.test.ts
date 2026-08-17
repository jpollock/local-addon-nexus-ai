/**
 * WP-15 · The rendering half — and the Controlled Vocabulary as a test.
 *
 * The vocabulary (docs/intelligence/user-docs/your-copy-and-the-live-site.md)
 * reserves "drift" for change reports and forbids "divergence" outright; a
 * copy is "behind" or "ahead", never "diverged from its upstream". Every
 * internal word this subsystem is built out of — twin, ledger, entity,
 * lineage, sandbox, SLO — is likewise unspeakable at the surface. That is
 * exactly the kind of rule that erodes one helpful sentence at a time, so it
 * is pinned as a scan over every rendered line rather than left to review.
 */
import { renderDivergenceSection } from '../divergenceReport';
import type { DivergenceReport } from '../../../intelligence';

/**
 * The oracle lives HERE, not in the module under test. A forbidden-word list
 * exported from production and imported by the test enforcing it is not a
 * gate — deleting a word from it would make this pass.
 *
 * Two kinds of word, both real: RESERVED (the vocabulary assigns them a
 * different meaning — "drift" belongs to the change reports) and INTERNAL (the
 * reader has no model for them and no reason to acquire one).
 */
const DIVERGENCE_FORBIDDEN_WORDS: readonly string[] = [
  'drift',
  'divergen',
  'upstream',
  'lineage',
  'working copy',
  'sandbox',
  'twin',
  'ledger',
  'entity',
  'slo',
  'stale',
  'snapshot age',
];

const HOUR = 3600;
const DAY = 24 * HOUR;

function report(over: Partial<DivergenceReport> = {}): DivergenceReport {
  return {
    copyEntityId: 'ent_env_AAAAAAAAAAAAAAAAAAAAAAAAAA',
    candidates: [],
    ambiguous: false,
    content: { reason: 'no-lineage' },
    code: { comparedFacts: 0, items: [], ahead: 0, behind: 0, changed: 0, reason: 'no-upstream' },
    ...over,
  };
}

const labels = { copy: 'alpine-outfitters', upstream: 'alpineoutfitters' };

function render(r: DivergenceReport): string {
  return renderDivergenceSection(r, labels).join('\n');
}

describe('divergence rendering — the vocabulary is a gate, not a guideline', () => {
  test('no rendered line uses a reserved or internal word, in any branch', () => {
    const branches: DivergenceReport[] = [
      report(),
      report({ ambiguous: true, candidates: [
        { entityId: 'ent_env_B'.padEnd(30, 'B'), confidence: 0.95, establishedBy: 'host_connection' },
        { entityId: 'ent_env_C'.padEnd(30, 'C'), confidence: 0.95, establishedBy: 'host_connection' },
      ] }),
      report({
        upstream: { entityId: 'ent_env_D'.padEnd(30, 'D'), via: 'content_lineage' },
        content: { upstreamEntityId: 'x', reason: 'no-recorded-sync' },
        code: { comparedFacts: 3, items: [], ahead: 0, behind: 0, changed: 0 },
      }),
      report({
        upstream: { entityId: 'ent_env_D'.padEnd(30, 'D'), via: 'site_environment' },
        anchor: {
          eventId: 'evt_x',
          at: '2026-08-06T12:00:00.000Z',
          ageSeconds: 11 * DAY,
          flow: 'unknown',
          direction: 'down',
        },
        content: { upstreamEntityId: 'x', pulledAt: '2026-08-06T12:00:00.000Z', behindSeconds: 11 * DAY },
        code: {
          comparedFacts: 12,
          ahead: 1,
          behind: 2,
          changed: 1,
          items: [
            { fact: 'plugin:acf', status: 'differs', direction: 'behind', copy: { version: '6.0' }, upstream: { version: '6.1' } },
            { fact: 'plugin:campaign', status: 'only_on_copy', direction: 'ahead', copy: { version: '1.0' } },
            { fact: 'plugin:wpe-cache', status: 'only_on_upstream', direction: 'behind', upstream: { version: '2.0' } },
            { fact: 'wp.version', status: 'differs', direction: 'unknown', copy: { version: 'a' }, upstream: { version: 'b' } },
          ],
          copy: { observedAt: '', ageSeconds: HOUR, sloSeconds: 8 * HOUR, trust: 'observed', fresh: true },
          upstream: { observedAt: '', ageSeconds: 30 * HOUR, sloSeconds: 8 * HOUR, trust: 'observed', fresh: false },
        },
      }),
    ];

    for (const branch of branches) {
      const text = render(branch);
      for (const word of DIVERGENCE_FORBIDDEN_WORDS) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      // And no entity id ever reaches a user-facing line.
      expect(text).not.toMatch(/ent_[a-z]+_/);
    }
  });
});

describe('divergence rendering — content in time, code in items', () => {
  test('content is stated as an age, code as a count of items', () => {
    const text = render(
      report({
        upstream: { entityId: 'e', via: 'content_lineage' },
        content: { upstreamEntityId: 'e', pulledAt: '2026-08-06T12:00:00.000Z', behindSeconds: 11 * DAY },
        code: {
          comparedFacts: 12,
          ahead: 1,
          behind: 2,
          changed: 0,
          items: [
            { fact: 'plugin:acf', status: 'differs', direction: 'behind', copy: { version: '6.0' }, upstream: { version: '6.1' } },
            { fact: 'plugin:campaign', status: 'only_on_copy', direction: 'ahead', copy: { version: '1.0' } },
            { fact: 'plugin:wpe-cache', status: 'only_on_upstream', direction: 'behind', upstream: { version: '2.0' } },
          ],
        },
      }),
    );

    expect(text).toContain('pulled from alpineoutfitters 11d ago');
    expect(text).toMatch(/2 items behind/);
    expect(text).toMatch(/1 ahead/);
    // The units never cross: no item count on the content line, no age on the code line.
    const contentLine = text.split('\n').find((l) => l.startsWith('**Content:**'))!;
    const codeLine = text.split('\n').find((l) => l.startsWith('**Code:**'))!;
    expect(contentLine).not.toMatch(/item/);
    expect(codeLine).not.toMatch(/\d+[dhm] ago/);
  });

  test('no differences is said plainly, not as an empty table', () => {
    const text = render(
      report({
        upstream: { entityId: 'e', via: 'content_lineage' },
        content: { upstreamEntityId: 'e', pulledAt: 'x', behindSeconds: 2 * HOUR },
        code: { comparedFacts: 9, items: [], ahead: 0, behind: 0, changed: 0 },
      }),
    );

    expect(text).toContain('no differences');
    expect(text).not.toContain('| Item |');
  });
});

describe('divergence rendering — the three absences read as three answers', () => {
  test('no lineage says nothing on record, and offers no number', () => {
    const text = render(report());
    expect(text).toMatch(/nothing on record says which site this copy tracks/i);
    // The heading legitimately says "behind or ahead"; what must not appear is
    // a NUMBER — an age or an item count claimed with no basis for either.
    expect(text).not.toMatch(/\d+\s*(items?|[dhm] ago)/);
  });

  test('an undecidable pair says so, and says how many it could not choose between', () => {
    const text = render(
      report({
        ambiguous: true,
        candidates: [
          { entityId: 'a', confidence: 0.95, establishedBy: 'host_connection' },
          { entityId: 'b', confidence: 0.95, establishedBy: 'host_connection' },
        ],
      }),
    );
    expect(text).toMatch(/2 places/);
    expect(text).not.toMatch(/nothing on record says which site this copy tracks/i);
  });

  test('lineage with no recorded sync names the gap without inventing an age', () => {
    const text = render(
      report({
        upstream: { entityId: 'e', via: 'content_lineage' },
        content: { upstreamEntityId: 'e', reason: 'no-recorded-sync' },
        code: { comparedFacts: 4, items: [], ahead: 0, behind: 0, changed: 0 },
      }),
    );
    expect(text).toContain('no recorded sync');
    expect(text).not.toMatch(/\d+ (days?|d) ago/);
  });

  test("a sync of unknown flow renders the architect's ruled sentence", () => {
    const text = render(
      report({
        upstream: { entityId: 'e', via: 'content_lineage' },
        anchor: {
          eventId: 'evt_x',
          at: '2026-08-16T12:00:00.000Z',
          ageSeconds: DAY,
          flow: 'unknown',
          direction: 'down',
        },
        content: { upstreamEntityId: 'e', reason: 'no-recorded-sync' },
        code: { comparedFacts: 4, items: [], ahead: 0, behind: 0, changed: 0 },
      }),
    );
    expect(text).toContain("a sync happened; what it included couldn't be determined");
  });

  test('a known flow names what moved instead', () => {
    const text = render(
      report({
        upstream: { entityId: 'e', via: 'content_lineage' },
        anchor: {
          eventId: 'evt_x',
          at: '2026-08-16T12:00:00.000Z',
          ageSeconds: DAY,
          flow: 'full',
          direction: 'down',
          includesDb: true,
        },
        content: { upstreamEntityId: 'e', pulledAt: 'x', behindSeconds: DAY },
        code: { comparedFacts: 4, items: [], ahead: 0, behind: 0, changed: 0 },
      }),
    );
    expect(text).toMatch(/files and content/i);
    expect(text).not.toContain("couldn't be determined");
  });
});

describe('divergence rendering — per-side ages', () => {
  test('both sides are dated, and an out-of-date side is marked', () => {
    const text = render(
      report({
        upstream: { entityId: 'e', via: 'content_lineage' },
        content: { upstreamEntityId: 'e', pulledAt: 'x', behindSeconds: DAY },
        code: {
          comparedFacts: 4,
          items: [],
          ahead: 0,
          behind: 0,
          changed: 0,
          copy: { observedAt: '', ageSeconds: HOUR, sloSeconds: 8 * HOUR, trust: 'observed', fresh: true },
          upstream: { observedAt: '', ageSeconds: 20 * HOUR, sloSeconds: 8 * HOUR, trust: 'observed', fresh: false },
        },
      }),
    );

    expect(text).toContain('alpine-outfitters checked 1h ago');
    expect(text).toContain('alpineoutfitters checked 20h ago');
    expect(text).toMatch(/may be out of date/);
  });

  test('an unnamed side is never rendered as an id', () => {
    const text = renderDivergenceSection(
      report({
        upstream: { entityId: 'ent_env_ZZZZZZZZZZZZZZZZZZZZZZZZZZ', via: 'site_environment' },
        content: { upstreamEntityId: 'e', pulledAt: 'x', behindSeconds: DAY },
        code: { comparedFacts: 1, items: [], ahead: 0, behind: 0, changed: 0 },
      }),
      { copy: 'my-site' },
    ).join('\n');

    expect(text).not.toMatch(/ent_env_/);
    expect(text).toMatch(/the site it tracks/);
  });
});
