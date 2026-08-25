/**
 * fixes-082526 · issue 5 — the Themes filter never populated.
 *
 * Root cause: themes were collected by WP-CLI against RUNNING LOCAL sites,
 * while every other axis was read from graph.db. No running local site (a
 * WPE-only fleet, or a laptop just opened) meant an empty list under an axis
 * the UI still offered. These tests pin the graph read that replaced it.
 *
 * Real SQLite, not a mock: the point of the fix is which rows the SQL
 * selects, and a mocked db cannot get that wrong.
 */
import Database from 'better-sqlite3';
import { collectThemeFacet } from '../../../src/main/fleet/filterOptions';

function graph(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, source TEXT, is_active INTEGER);
    CREATE TABLE themes (id INTEGER PRIMARY KEY, site_id TEXT, slug TEXT, name TEXT, is_active INTEGER);
  `);
  return db;
}

describe('collectThemeFacet', () => {
  it('covers the whole fleet — wpe and external, not just local', () => {
    const db = graph();
    db.exec(`
      INSERT INTO sites VALUES ('l1','local-one','local',1), ('w1','wpe-one','wpe',1), ('x1','ssh-one','external',1);
      INSERT INTO themes VALUES
        (1,'l1','twentytwentyfive','Twenty Twenty-Five',1),
        (2,'w1','twentytwentyfive','Twenty Twenty-Five',1),
        (3,'w1','astra','Astra',0),
        (4,'x1','kadence','Kadence',1);
    `);
    const { values, counts } = collectThemeFacet(db);
    // The WPE and external themes are the ones the old WP-CLI path could never see.
    expect(values).toEqual(['Astra', 'Kadence', 'Twenty Twenty-Five']);
    expect(counts['Twenty Twenty-Five']).toBe(2);
    expect(counts['Kadence']).toBe(1);
    db.close();
  });

  it('counts SITES carrying a theme, not theme rows', () => {
    const db = graph();
    db.exec(`
      INSERT INTO sites VALUES ('a','a','wpe',1), ('b','b','wpe',1);
      INSERT INTO themes VALUES (1,'a','astra','Astra',1), (2,'b','astra','Astra',0);
    `);
    expect(collectThemeFacet(db).counts['Astra']).toBe(2);
    db.close();
  });

  it('excludes soft-deleted sites — nexus host remove must stop a host voting', () => {
    const db = graph();
    db.exec(`
      INSERT INTO sites VALUES ('gone','removed-host','external',0), ('here','live','wpe',1);
      INSERT INTO themes VALUES (1,'gone','ghost','Ghost Theme',1), (2,'here','astra','Astra',1);
    `);
    const { values } = collectThemeFacet(db);
    expect(values).toEqual(['Astra']);
    expect(values).not.toContain('Ghost Theme');
    db.close();
  });

  it('an inactive theme still counts — the axis is what is INSTALLED', () => {
    const db = graph();
    db.exec(`
      INSERT INTO sites VALUES ('a','a','local',1);
      INSERT INTO themes VALUES (1,'a','astra','Astra',0);
    `);
    expect(collectThemeFacet(db).values).toEqual(['Astra']);
    db.close();
  });

  it('skips empty and null names rather than offering a blank menu row', () => {
    const db = graph();
    db.exec(`
      INSERT INTO sites VALUES ('a','a','local',1);
      INSERT INTO themes VALUES (1,'a','x',NULL,1), (2,'a','y','',1), (3,'a','z','Real',1);
    `);
    expect(collectThemeFacet(db).values).toEqual(['Real']);
    db.close();
  });

  it('degrades to an empty axis when there is no db or no themes table', () => {
    expect(collectThemeFacet(null)).toEqual({ values: [], counts: {} });
    const bare = new Database(':memory:');
    bare.exec('CREATE TABLE sites (id TEXT PRIMARY KEY, is_active INTEGER)');
    // An older graph.db predates the table; the other axes must still survive.
    expect(collectThemeFacet(bare)).toEqual({ values: [], counts: {} });
    bare.close();
  });
});
