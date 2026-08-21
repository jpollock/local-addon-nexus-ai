/**
 * WP-54 · ITEM 2 — THE TIER A CARD DISPLAYS IS THE TIER IT WAS SORTED BY.
 *
 * THE DEFECT, MEASURED BEFORE IT WAS FIXED. `situationOfIncident` assigned
 * `tier: resolved ? 4 : 2` while the ratified `incident.no-run` template's rule
 * line read the literal string **"Tier 1 · nothing is holding it back but you"**.
 * Two facts, two sources. On the owner's real ledger, 2026-08-21, the
 * consequence was total: all seven waiting rows landed at tier 2, so
 * `rankSituations` fell through to `since` and the list degenerated to age
 * order — 82h, 66h, 65h, 65h, 65h, 65h, 64h — with four Tier-1 security
 * findings rendering BELOW a Tier-2 backup step. The order the whole triage
 * rests on (§4a, moments-model 1.3, XD-23) was not in force on screen, and no
 * test caught it: the existing pins assert the SORT is correct GIVEN tiers, and
 * never that the tier a card shows is the tier it was given.
 *
 * THE INSTRUMENT, and it is the one that caught WP-52's divergence: drive the
 * two derivations over one shared table and assert they agree. Here the two
 * derivations are the RULE LINE (what the reader sees) and the RANK (what the
 * comparator used), and they are pinned to be the same NUMBER rather than to be
 * consistent — after the fix there is one number, filled into the rule line's
 * own `{tier}` slot, so the agreement is structural and this suite is what
 * proves the structure is still there.
 *
 * A NOTE ON WHY THIS IS A SEPARATE FILE. `sessionRegistry.test.ts` drives the
 * fold through real emitters and is the right place for behaviour; this drives
 * the AGREEMENT across every row a fold can produce, which is a property of the
 * pair rather than of either.
 */
import { SITUATION_TEMPLATES } from '../situationCopy.generated';
import {
  guardHolds,
  outrankedByTheRecord,
  rankSituations,
  type ConsequenceTier,
  type Situation,
} from '../sessionRegistry';

/** Every tier a rule line can name, read out of the line itself. */
function tierInRuleLine(rule: string): number | null {
  const match = rule.match(/^Tier (\d)/);
  return match ? Number(match[1]) : null;
}

describe('the ratified set declares one tier per class, and the rule line reads it', () => {
  test('every template declares a tier, and its rule line is a SLOT rather than a literal', () => {
    for (const template of SITUATION_TEMPLATES) {
      expect(typeof template.tier).toBe('number');
      // The slot is what makes the displayed tier the ranked one. A literal here
      // would render a number nothing sorted by — the defect, restored.
      expect(template.rule.startsWith('Tier {tier} · ')).toBe(true);
      expect(tierInRuleLine(template.rule)).toBeNull();
    }
  });

  test('the tiers are the ratified ones, class by class', () => {
    const declared = Object.fromEntries(SITUATION_TEMPLATES.map((t) => [t.id, t.tier]));
    expect(declared).toEqual({
      'run.waiting.nothing-written': 2,
      'run.waiting.mid-procedure': 2,
      'run.waiting.part-changed': 1,
      // The one the fold contradicted, and the whole reason this suite exists.
      'incident.no-run': 1,
      // Ratified as tier 3, which `ConsequenceTier` did not hold until WP-54
      // widened it. No producer emits this class yet (WP-54a); the type holds it
      // so the ratified rank is representable the day one does.
      'agent.stuck': 3,
    });
  });
});

describe('the agreement pin — display and rank are one number', () => {
  /**
   * A row as the fold hands it over, with the two facts under test set
   * independently — so a card whose rule line and rank disagreed WOULD be
   * constructible here. A test that could not build the defect cannot detect it.
   */
  const row = (tier: ConsequenceTier, rule: string): Situation => ({
    id: `sit_${tier}_${rule.length}`,
    kind: 'incident',
    column: 'waiting',
    tier,
    tierReason: 'x',
    places: { tokens: [], highest: null, atHighest: 0, total: 0, unresolved: 0, summary: '' },
    since: '2026-08-18T00:00:00.000Z',
    lastEventId: 'evt_1',
    parts: [],
    headline: 'h',
    ask: '',
    chip: '',
    state: '',
    meta: '',
    rule,
    headlineTemplate: null,
    door: null,
    signature: null,
    written: { done: 0, failed: 0, total: null },
  });

  test('THE INSTRUMENT · a card whose rule line names a tier it was not sorted by is a defect', () => {
    // The shape the surface shipped: sorted at 2, printed as "Tier 1".
    const divergent = row(2, 'Tier 1 · nothing is holding it back but you');
    expect(tierInRuleLine(divergent.rule)).not.toBe(divergent.tier);

    // And the shape after the fix, from the same builder — so the pin is a
    // comparison rather than a restatement of a constant.
    const agreeing = row(1, 'Tier 1 · nothing is holding it back but you');
    expect(tierInRuleLine(agreeing.rule)).toBe(agreeing.tier);
  });

  test('the sort key and the printed tier cannot disagree, over the whole ranked list', () => {
    const rows = [
      row(1, 'Tier 1 · nothing is holding it back but you'),
      row(2, 'Tier 2 · the world is untouched'),
      row(3, 'Tier 3 · the agent is asking, not the fleet'),
      row(4, 'the run is complete; nothing is waiting on you'),
    ];
    const ranked = rankSituations(rows);

    // Ranked most-consequential first…
    expect(ranked.map((s) => s.tier)).toEqual([1, 2, 3, 4]);
    // …and every row that NAMES a tier names the one it was ranked at. A derived
    // row names none, which is honest and is not a disagreement.
    for (const s of ranked) {
      const printed = tierInRuleLine(s.rule);
      if (printed !== null) expect(printed).toBe(s.tier);
    }
  });
});

describe('the record outranks the class, and says so by falling back', () => {
  /**
   * §4a can derive a MORE urgent tier than the class its sentence was written
   * for — a write landed in scope, or the delay has a derivable deadline. The
   * class's sentence is then no longer true of that row ("Tier 1 · the world is
   * untouched" would be a number and a reason from two different facts), so the
   * row takes the derived sentence and the derived tier together.
   */
  test('a more urgent derived tier refuses the class; an equal or lower one does not', () => {
    const midProcedure = SITUATION_TEMPLATES.filter((t) => t.id === 'run.waiting.mid-procedure')[0];
    expect(midProcedure.tier).toBe(2);

    expect(outrankedByTheRecord(midProcedure, 1)).toBe(true);
    expect(outrankedByTheRecord(midProcedure, 2)).toBe(false);
    expect(outrankedByTheRecord(midProcedure, 4)).toBe(false);
    // No class, nothing to outrank.
    expect(outrankedByTheRecord(null, 1)).toBe(false);
  });

  test('the guards are untouched by the tier work — the same five, selecting the same rows', () => {
    // A cheap regression fence around the amendment: adding `tier` to the
    // fixture must not have moved a guard. `situationHeadlines.test.ts` proves
    // exclusivity by brute force; this proves the five still select at all.
    const gate = { checkpointId: 'cp.a', index: 1, of: 2, awaits: 'approval' as const, runbookId: 'rb.x', capability: 'cap.x' };
    const cases: Array<[string, Parameters<typeof guardHolds>[1]]> = [
      ['run.waiting.nothing-written', { kind: 'run', done: 0, failed: 0, total: 0, gate: null, runId: 'r' }],
      ['run.waiting.mid-procedure', { kind: 'run', done: 0, failed: 0, total: null, gate, runId: 'r' }],
      ['run.waiting.part-changed', { kind: 'run', done: 1, failed: 0, total: 2, gate, runId: 'r' }],
      ['incident.no-run', { kind: 'incident', done: 0, failed: 0, total: 0, gate: null, runId: null }],
      ['agent.stuck', { kind: 'agentFailure', done: 0, failed: 0, total: null, gate: null, runId: null }],
    ];
    for (const [id, input] of cases) {
      const selected = SITUATION_TEMPLATES.filter((t) => guardHolds(t, input));
      expect(selected.map((t) => t.id)).toEqual([id]);
    }
  });
});
