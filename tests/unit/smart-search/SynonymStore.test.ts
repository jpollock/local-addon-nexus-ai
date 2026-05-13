import Database from 'better-sqlite3';
import { SynonymStore } from '../../../src/main/smart-search/SynonymStore';

let db: InstanceType<typeof Database>;
let store: SynonymStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new SynonymStore(db);
  store.initialize();
});

afterEach(() => db.close());

describe('SynonymStore', () => {
  it('saves and retrieves a synonym rule', () => {
    const rule = store.saveRule('site1', 'laptop, notebook, computer');
    expect(rule.id).toBeTruthy();
    expect(rule.synonyms).toBe('laptop, notebook, computer');

    const rules = store.getRules('site1');
    expect(rules).toHaveLength(1);
    expect(rules[0].synonyms).toBe('laptop, notebook, computer');
  });

  it('updates an existing rule when id provided', () => {
    const rule = store.saveRule('site1', 'laptop, notebook');
    const updated = store.saveRule('site1', 'laptop, notebook, computer', rule.id);
    expect(updated.id).toBe(rule.id);

    const rules = store.getRules('site1');
    expect(rules).toHaveLength(1);
    expect(rules[0].synonyms).toBe('laptop, notebook, computer');
  });

  it('deletes a rule by id', () => {
    const rule = store.saveRule('site1', 'laptop, notebook');
    store.deleteRule('site1', rule.id);
    expect(store.getRules('site1')).toHaveLength(0);
  });

  it('deleteAll removes all rules for a site', () => {
    store.saveRule('site1', 'laptop, notebook');
    store.saveRule('site1', 'phone, mobile');
    store.deleteAllRules('site1');
    expect(store.getRules('site1')).toHaveLength(0);
  });

  it('getRule returns a single rule by id', () => {
    const saved = store.saveRule('site1', 'phone, mobile');
    const found = store.getRule('site1', saved.id);
    expect(found).not.toBeNull();
    expect(found!.synonyms).toBe('phone, mobile');
  });

  it('isolates rules by siteId', () => {
    store.saveRule('site1', 'laptop, notebook');
    store.saveRule('site2', 'phone, mobile');
    expect(store.getRules('site1')).toHaveLength(1);
    expect(store.getRules('site2')).toHaveLength(1);
  });

  it('getRules supports offset and limit', () => {
    for (let i = 0; i < 5; i++) store.saveRule('site1', `term${i}, alias${i}`);
    const page = store.getRules('site1', { offset: 2, limit: 2 });
    expect(page).toHaveLength(2);
  });
});
