/**
 * Entity service v0 (unwired draft — see WP-07 and
 * `docs/intelligence/reconciliation-entity-identity.md`).
 *
 * Pins the four properties the eventual wiring depends on: `ensure()` is
 * idempotent AND mints the same id the producers already derive
 * (`provisionalEntity.ts`) so adoption changes no ids; resolution carries its
 * evidence rather than a bare answer; a user link outranks any heuristic; and
 * pairing proposals stay proposals — nothing here pairs automatically.
 */
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

// WP-07: the site_links mirror needs 'host_connection' as evidence, the
// freshness carrier (verified_at → created_at), the user-outranks-heuristic
// ordering, and proposal scoping to the resolver's unresolved report.
describe('entity service wiring contracts (WP-07)', () => {
  test("'host_connection' is a valid EstablishedBy and round-trips through an alias", () => {
    const ledger = new Ledger(':memory:');
    const entities = new EntityService(ledger);
    const envId = entities.ensure('env', 'local.site_id', 'row-1');
    entities.addAlias(envId, 'wpe.install_id', 'inst-1', 0.95, 'host_connection');
    const [candidate] = entities.resolve('inst-1', 'wpe.install_id');
    expect(candidate.matchedAlias.establishedBy).toBe('host_connection');
    expect(candidate.matchedAlias.confidence).toBe(0.95);
    ledger.close();
  });

  test('a user link outranks any heuristic in resolution ORDER, not just value', () => {
    const ledger = new Ledger(':memory:');
    const entities = new EntityService(ledger);
    const heuristicFirst = entities.ensure('env', 'local.site_id', 'row-a');
    const userSecond = entities.ensure('env', 'local.site_id', 'row-b');
    // Insert the heuristic alias FIRST so raw insertion order would rank it
    // first; only the confidence ordering puts the user link on top.
    entities.addAlias(heuristicFirst, 'wpe.install_name', 'acme', 0.5, 'name_heuristic');
    entities.addAlias(userSecond, 'user.label', 'acme', 1.0, 'user_link');
    const candidates = entities.resolve('acme');
    expect(candidates).toHaveLength(2);
    expect(candidates[0].entityId).toBe(userSecond);
    expect(candidates[0].matchedAlias.establishedBy).toBe('user_link');
    expect(candidates[1].matchedAlias.establishedBy).toBe('name_heuristic');
    ledger.close();
  });

  test('a heuristic write never clobbers an existing user_link alias or link', () => {
    const ledger = new Ledger(':memory:');
    const entities = new EntityService(ledger);
    const a = entities.ensure('env', 'local.site_id', 'row-a');
    const b = entities.ensure('env', 'local.site_id', 'row-b');
    const site = entities.ensure('site', 'wpe.site_id', 'site-uuid');

    entities.addAlias(a, 'user.label', 'client-x', 1.0, 'user_link');
    entities.addAlias(b, 'user.label', 'client-x', 0.5, 'name_heuristic'); // must be refused
    const [candidate] = entities.resolve('client-x', 'user.label');
    expect(candidate.entityId).toBe(a);
    expect(candidate.matchedAlias.establishedBy).toBe('user_link');

    entities.link(site, a, 'has_environment', 1.0, 'user_link');
    entities.link(site, a, 'has_environment', 0.5, 'name_heuristic'); // must be refused
    const envs = entities.environmentsOf(site);
    expect(envs).toEqual([{ entityId: a, confidence: 1.0, establishedBy: 'user_link' }]);

    // A user_link CAN update a user_link (re-assertion is allowed).
    entities.addAlias(b, 'user.label', 'client-x', 1.0, 'user_link');
    expect(entities.resolve('client-x', 'user.label')[0].entityId).toBe(b);
    ledger.close();
  });

  test('addAlias and link carry an explicit freshness timestamp (verified_at), updated on re-assertion', () => {
    const ledger = new Ledger(':memory:');
    const entities = new EntityService(ledger);
    const envId = entities.ensure('env', 'local.site_id', 'row-a');
    const site = entities.ensure('site', 'wpe.site_id', 'site-uuid');
    const verifiedAt = '2026-08-01T12:00:00.000Z';

    entities.addAlias(envId, 'wpe.install_id', 'inst-1', 0.95, 'host_connection', verifiedAt);
    entities.link(site, envId, 'has_environment', 0.95, 'host_connection', verifiedAt);

    const db = ledger.raw();
    const alias = db
      .prepare(`SELECT created_at FROM entity_aliases WHERE namespace = 'wpe.install_id' AND value = 'inst-1'`)
      .get() as { created_at: string };
    expect(alias.created_at).toBe(verifiedAt);
    const link = db
      .prepare(`SELECT created_at FROM entity_links WHERE from_entity = ? AND to_entity = ?`)
      .get(site, envId) as { created_at: string };
    expect(link.created_at).toBe(verifiedAt);

    // Re-assertion with a newer verified_at refreshes the carrier in place.
    const later = '2026-08-10T12:00:00.000Z';
    entities.addAlias(envId, 'wpe.install_id', 'inst-1', 0.95, 'host_connection', later);
    const refreshed = db
      .prepare(`SELECT created_at, COUNT(*) OVER () AS n FROM entity_aliases WHERE namespace = 'wpe.install_id' AND value = 'inst-1'`)
      .get() as { created_at: string; n: number };
    expect(refreshed).toEqual({ created_at: later, n: 1 });
    ledger.close();
  });

  test('proposePairings(unresolvedOnly) returns only proposals involving the given entities', () => {
    const ledger = new Ledger(':memory:');
    const entities = new EntityService(ledger);
    const db = ledger.raw();
    const seed = (eid: string, name: string, domain: string) =>
      db.prepare(`INSERT INTO twin_facts VALUES (?, 'site.core', ?, ?, 'observed', 'evt_seed')`)
        .run(eid, JSON.stringify({ name, domain }), new Date().toISOString());
    // Two independent pairs; only the first involves the "unresolved" entity.
    seed('ent_env_AAAAAAAAAAAAAAAAAAAAAAAAAA', 'acme-local', 'acme.com');
    seed('ent_env_BBBBBBBBBBBBBBBBBBBBBBBBBB', 'acme', 'www.acme.com');
    seed('ent_env_CCCCCCCCCCCCCCCCCCCCCCCCCC', 'blog-staging', 'x.wpengine.com');
    seed('ent_env_DDDDDDDDDDDDDDDDDDDDDDDDDD', 'blog', 'y.com');

    const all = entities.proposePairings();
    expect(all.length).toBeGreaterThanOrEqual(2);

    const scoped = entities.proposePairings(['ent_env_AAAAAAAAAAAAAAAAAAAAAAAAAA']);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].evidence).toBe('domain_match');

    // An empty unresolved set means nothing is proposed — not everything.
    expect(entities.proposePairings([])).toHaveLength(0);
    ledger.close();
  });
});

/**
 * WP-14 · the Layer-3 traversals and the exclusive link.
 *
 * ADR-21 froze the ids and put layer membership on the EDGES, so these three
 * methods are the only thing that can distinguish a working copy from an
 * environment. `workingCopiesOf` must not answer with environments, `siteOf`
 * must find the Site from either containment edge, and `linkExclusive` must
 * actually retire the pointer it replaces — plain `link()` does not.
 */
test('WP-14: working-copy traversal, reverse site lookup, and an exclusive pointer', () => {
  const ledger = new Ledger(':memory:');
  const entities = new EntityService(ledger);

  const site = entities.ensure('site', 'wpe.site_id', 'site-uuid');
  const copy = entities.ensure('env', 'local.site_id', 'local-1');
  const prod = entities.ensure('env', 'graph.site_row', 'row-prod');
  const stage = entities.ensure('env', 'graph.site_row', 'row-stage');

  entities.link(site, prod, 'has_environment', 0.95, 'host_connection');
  entities.link(site, stage, 'has_environment', 0.95, 'host_connection');
  // The copy carries BOTH edges — additive, per audit A6.
  entities.link(site, copy, 'has_environment', 1.0, 'user_link');
  entities.link(site, copy, 'has_working_copy', 1.0, 'user_link');

  // Every shipped reader still sees all three; only the new traversal narrows.
  expect(entities.environmentsOf(site).map((e) => e.entityId).sort()).toEqual([copy, prod, stage].sort());
  expect(entities.workingCopiesOf(site).map((e) => e.entityId)).toEqual([copy]);

  // Reverse: from a copy AND from a plain environment.
  expect(entities.siteOf(copy)).toBe(site);
  expect(entities.siteOf(prod)).toBe(site);
  expect(entities.siteOf('ent_env_ZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBeUndefined();

  // An env→env edge must never be mistaken for a Site (the type filter).
  entities.link(prod, copy, 'content_pulled_from', 1.0, 'pull_lineage');
  expect(entities.siteOf(copy)).toBe(site);

  // linkExclusive MOVES the pointer; plain link would have left both.
  entities.linkExclusive(copy, prod, 'content_pulled_from', 1.0, 'pull_lineage', '2026-08-17T00:00:00.000Z');
  entities.linkExclusive(copy, stage, 'content_pulled_from', 1.0, 'pull_lineage', '2026-08-18T00:00:00.000Z');
  const pointers = ledger
    .raw()
    .prepare(`SELECT to_entity, created_at FROM entity_links WHERE from_entity = ? AND kind = 'content_pulled_from'`)
    .all(copy) as Array<{ to_entity: string; created_at: string }>;
  expect(pointers).toEqual([{ to_entity: stage, created_at: '2026-08-18T00:00:00.000Z' }]);

  // A human's assertion is never retired by an observation.
  entities.link(copy, prod, 'content_pulled_from', 1.0, 'user_link');
  entities.linkExclusive(copy, stage, 'content_pulled_from', 1.0, 'pull_lineage');
  const withUserLink = ledger
    .raw()
    .prepare(`SELECT to_entity FROM entity_links WHERE from_entity = ? AND kind = 'content_pulled_from' ORDER BY to_entity`)
    .all(copy) as Array<{ to_entity: string }>;
  expect(withUserLink.map((r) => r.to_entity).sort()).toEqual([prod, stage].sort());

  ledger.close();
});
