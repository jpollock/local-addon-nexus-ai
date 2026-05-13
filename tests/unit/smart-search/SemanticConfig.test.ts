import Database from 'better-sqlite3';
import { SemanticConfig } from '../../../src/main/smart-search/SemanticConfig';

let db: InstanceType<typeof Database>;
let config: SemanticConfig;

beforeEach(() => {
  db = new Database(':memory:');
  config = new SemanticConfig(db);
  config.initialize();
});

afterEach(() => db.close());

describe('SemanticConfig', () => {
  it('returns default config when nothing configured', () => {
    const cfg = config.get('site1');
    expect(cfg.fields).toEqual(['post_title', 'post_content']);
    expect(cfg.type).toBe('BASIC');
  });

  it('saves and retrieves a config', () => {
    config.set('site1', ['post_title']);
    const cfg = config.get('site1');
    expect(cfg.fields).toEqual(['post_title']);
    expect(cfg.type).toBe('BASIC');
  });

  it('overwrites existing config on second set', () => {
    config.set('site1', ['post_title']);
    config.set('site1', ['post_title', 'post_content', 'custom_field']);
    expect(config.get('site1').fields).toEqual(['post_title', 'post_content', 'custom_field']);
  });

  it('isolates config by siteId', () => {
    config.set('site1', ['post_title']);
    config.set('site2', ['post_content']);
    expect(config.get('site1').fields).toEqual(['post_title']);
    expect(config.get('site2').fields).toEqual(['post_content']);
  });
});
