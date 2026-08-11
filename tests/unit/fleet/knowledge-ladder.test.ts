import { toKnowledgeRung, KNOWLEDGE_LABELS } from '../../../src/main/fleet/knowledgeLadder';

describe('toKnowledgeRung', () => {
  test('an indexed external host reaches searchable', () => {
    // External content indexing shipped (ExternalContentIndexScheduler). Capping
    // here would make the Sites table state something untrue about a host the
    // user has actually indexed. This is the regression test for that claim —
    // DECISIONS.md still says external caps at Detailed. It is wrong.
    expect(toKnowledgeRung('indexed', 'external')).toBe('searchable');
  });

  test('an unindexed external host still reports what it actually has', () => {
    expect(toKnowledgeRung('metadata', 'external')).toBe('detailed');
    expect(toKnowledgeRung('filesystem', 'external')).toBe('basic');
    expect(toKnowledgeRung(null, 'external')).toBe('nothing');
  });

  test('local and wpe are unchanged', () => {
    expect(toKnowledgeRung('indexed', 'local')).toBe('searchable');
    expect(toKnowledgeRung('indexed', 'wpe')).toBe('searchable');
    expect(toKnowledgeRung('metadata', 'wpe')).toBe('detailed');
  });

  test('an unrecognised source still fails closed', () => {
    // The ceiling exists for THIS reason and must survive. A source the ladder
    // was never designed to score must not inherit the most permissive rung.
    expect(toKnowledgeRung('indexed', 'martian' as any)).toBe('nothing');
  });

  test('an unrecognised completeness reads as nothing', () => {
    expect(toKnowledgeRung('quantum' as any, 'local')).toBe('nothing');
  });

  test('every rung has a label', () => {
    for (const rung of ['nothing', 'basic', 'detailed', 'searchable'] as const) {
      expect(KNOWLEDGE_LABELS[rung]).toBeTruthy();
    }
  });
});
