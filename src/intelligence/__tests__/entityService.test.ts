import { Ledger } from '../ledger/ledger';
import { EntityService } from '../entity/entityService';

test('entity service v0: adoption, resolution with evidence, links, pairing proposals', () => {
  const ledger = new Ledger(':memory:');
  const entities = new EntityService(ledger);

  // Adoption: ensure() for a local site id yields the SAME id the producers derive
  const envId = entities.ensure('env', 'local.site_id', 'abc123');
  expect(envId).toMatch(/^ent_env_[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(entities.ensure('env', 'local.site_id', 'abc123')).toBe(envId); // idempotent

  // Aliases + resolution with evidence
  entities.addAlias(envId, 'user.label', 'my client site', 1.0, 'user_link');
  const candidates = entities.resolve('my client site');
  expect(candidates).toHaveLength(1);
  expect(candidates[0].entityId).toBe(envId);
  expect(candidates[0].matchedAlias.establishedBy).toBe('user_link');

  // Links: logical site has environments
  const siteId = entities.ensure('site', 'local.site_id.logical', 'abc123');
  entities.link(siteId, envId, 'has_environment', 1.0, 'pull_lineage');
  const envs = entities.environmentsOf(siteId);
  expect(envs).toHaveLength(1);
  expect(envs[0].establishedBy).toBe('pull_lineage');

  // Pairing proposals from twin site.core facts: domain match + name heuristic
  const db = ledger.raw();
  const seed = (eid: string, name: string, domain: string) =>
    db.prepare(`INSERT INTO twin_facts VALUES (?, 'site.core', ?, ?, 'observed', 'evt_seed')`)
      .run(eid, JSON.stringify({ name, domain }), new Date().toISOString());
  seed('ent_env_AAAAAAAAAAAAAAAAAAAAAAAAAA', 'acme', 'www.acme.com');
  seed('ent_env_BBBBBBBBBBBBBBBBBBBBBBBBBB', 'acme-local', 'acme.com');
  seed('ent_env_CCCCCCCCCCCCCCCCCCCCCCCCCC', 'jpp-client', 'x.local');
  seed('ent_env_DDDDDDDDDDDDDDDDDDDDDDDDDD', 'jpp-client-staging', 'y.wpengine.com');
  const proposals = entities.proposePairings();
  expect(proposals.find((p) => p.evidence === 'domain_match')?.confidence).toBe(0.9);
  expect(proposals.find((p) => p.evidence === 'name_heuristic')?.detail).toMatch(/suffix/);
  ledger.close();
});
