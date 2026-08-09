import { toKnowledgeRung, KNOWLEDGE_LABELS } from '../../../src/main/fleet/knowledgeLadder';

describe('toKnowledgeRung', () => {
  test('maps the stored completeness values onto the four rungs', () => {
    expect(toKnowledgeRung('none', 'local')).toBe('nothing');
    expect(toKnowledgeRung('filesystem', 'local')).toBe('basic');
    expect(toKnowledgeRung('metadata', 'local')).toBe('detailed');
    expect(toKnowledgeRung('indexed', 'local')).toBe('searchable');
  });

  test('an external host can never reach searchable', () => {
    expect(toKnowledgeRung('indexed', 'external')).toBe('detailed');
    expect(toKnowledgeRung('metadata', 'external')).toBe('detailed');
    expect(toKnowledgeRung('filesystem', 'external')).toBe('basic');
  });

  test('an unrecognised or missing value is "nothing", never a guess', () => {
    expect(toKnowledgeRung(null, 'wpe')).toBe('nothing');
    expect(toKnowledgeRung(undefined, 'wpe')).toBe('nothing');
    expect(toKnowledgeRung('banana', 'wpe')).toBe('nothing');
  });

  test('every rung has a user-facing label', () => {
    expect(KNOWLEDGE_LABELS.nothing).toBe('Nothing yet');
    expect(KNOWLEDGE_LABELS.basic).toBe('Basic');
    expect(KNOWLEDGE_LABELS.detailed).toBe('Detailed');
    expect(KNOWLEDGE_LABELS.searchable).toBe('Searchable');
  });

  test('a WP Engine install is not capped — it can reach searchable', () => {
    expect(toKnowledgeRung('indexed', 'wpe')).toBe('searchable');
    expect(toKnowledgeRung('metadata', 'wpe')).toBe('detailed');
  });

  test('an unrecognised source fails closed, never to the most permissive ceiling', () => {
    expect(toKnowledgeRung('indexed', 'staging-mirror' as never)).toBe('nothing');
  });
});
