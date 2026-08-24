/**
 * Phase 3 · the per-site needs-you reading, per the round-7 rulings:
 * entity-id join only, a multi-site situation counts in every entity it
 * touches while `situations` states the situation count, and no-entity rows
 * land in the stated remainder — never guessed onto a site.
 */
import { needsYouBreakdown, Situation } from '../sessionRegistry';

function situation(over: Partial<Situation> = {}): Situation {
  return {
    id: 's1', column: 'waiting', tier: 2, tierReason: 'test',
    headline: 'h', ask: 'a', chip: 'c', state: 'st', meta: 'm', rule: 'r',
    headlineTemplate: 't', door: null, signatures: [], lastEventId: '01A',
    ...over,
  } as Situation;
}
const sig = (entityId?: string) => ({ producer: 'p', fact: 'F-1', target: 't', ...(entityId ? { entityId } : {}) });

describe('needsYouBreakdown', () => {
  test('joins on entity id; a multi-site situation counts in every entity it touches', () => {
    const rows = [
      situation({ id: 'a', tier: 3, signatures: [sig('ent-1')] }),
      situation({ id: 'b', tier: 2, signatures: [sig('ent-1'), sig('ent-2')] }), // multi-site
    ];
    const b = needsYouBreakdown(rows);
    expect(b.situations).toBe(2);                       // the situation count, never the row sum
    expect(b.byEntity.find((e) => e.entityId === 'ent-1')).toMatchObject({ count: 2, tier: 3 });
    expect(b.byEntity.find((e) => e.entityId === 'ent-2')).toMatchObject({ count: 1, tier: 2 });
  });

  test('a situation with no entity anywhere is the stated remainder — never guessed', () => {
    const rows = [
      situation({ id: 'a', signatures: [sig()] }),        // signature, no record link
      situation({ id: 'b', signatures: [] }),             // no signatures at all
      situation({ id: 'c', signatures: [sig('ent-1')] }),
    ];
    const b = needsYouBreakdown(rows);
    expect(b.unattributed).toBe(2);
    expect(b.byEntity).toHaveLength(1);
    expect(b.situations).toBe(3);
  });

  test('duplicate entity ids within one situation count it once for that entity', () => {
    const rows = [situation({ signatures: [sig('ent-1'), sig('ent-1')] })];
    expect(needsYouBreakdown(rows).byEntity[0].count).toBe(1);
  });
});
