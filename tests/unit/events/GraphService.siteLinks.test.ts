import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { GraphService } from '../../../src/main/events/GraphService';

function tmpDbPath(): string {
  return path.join(__dirname, `links-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('GraphService site_links migration', () => {
  const openDbs: string[] = [];

  async function freshService(dbPath: string): Promise<GraphService> {
    openDbs.push(dbPath);
    const svc = new GraphService(dbPath, { info: jest.fn(), error: jest.fn() });
    await svc.initialize();
    return svc;
  }

  afterEach(() => {
    for (const p of openDbs) {
      for (const suffix of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(p + suffix); } catch { /* ignore */ }
      }
    }
    openDbs.length = 0;
  });

  it('creates site_links with the expected columns on a fresh database', async () => {
    const dbPath = tmpDbPath();
    const svc = await freshService(dbPath);
    const db = svc.getDb() as Database.Database;

    const cols = (db.pragma('table_info(site_links)') as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();

    expect(cols).toEqual([
      'link_source',
      'local_site_id',
      'verified_at',
      'wpe_install_id',
      'wpe_install_name',
    ]);
    await svc.close();
  });

  it('creates the install index', async () => {
    const dbPath = tmpDbPath();
    const svc = await freshService(dbPath);
    const db = svc.getDb() as Database.Database;

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_site_links_install'")
      .get() as { name: string } | undefined;

    expect(idx?.name).toBe('idx_site_links_install');
    await svc.close();
  });

  it('is idempotent — re-initializing an existing database does not throw', async () => {
    const dbPath = tmpDbPath();
    const first = await freshService(dbPath);
    await first.close();

    const second = new GraphService(dbPath, { info: jest.fn(), error: jest.fn() });
    await expect(second.initialize()).resolves.not.toThrow();
    await second.close();
  });
});
