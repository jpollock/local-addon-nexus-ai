// tests/unit/startup/writeExternalHostData.graphservice.test.ts
//
// Runs writeExternalHostData against a real GraphService (temp-file sqlite),
// not the mock GraphWriter used in writeExternalHostData.test.ts. The mock's
// upsertSite is a naive object-merge, which cannot detect a case where the
// real GraphService.upsertSite's fixed SQL column list silently drops a field
// the mock happily "persisted" — exactly the mistake the original task brief
// made (see writeExternalHostData.ts's "WHY TWO WRITES, NOT ONE" docblock).
// This test exists so a future regression on that boundary fails here.
import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';
import { writeExternalHostData } from '../../../src/main/startup/writeExternalHostData';

describe('writeExternalHostData against a real GraphService', () => {
  let graphService: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-write-external-${Date.now()}-${Math.random()}.db`);
    graphService = new GraphService(testDbPath);
    await graphService.initialize();
  });

  afterEach(async () => {
    await graphService.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('round-trips core and extended columns, and preserves them on a subsequent partial cycle', async () => {
    const now = Date.now();
    await graphService.upsertSite({
      id: 'ssh:myhost', name: 'myhost', domain: 'myhost', source: 'external', host: 'external',
      is_active: true, created_at: now, updated_at: now,
    } as any);

    await writeExternalHostData(graphService as any, 'ssh:myhost', 'myhost', {
      wpVersion: '6.8.0',
      phpVersion: '8.3.1',
      siteUrl: 'https://real.example.com',
      adminEmail: 'a@b.com',
      postCount: 5,
      userCount: 2,
      adminCount: 1,
      plugins: [{ slug: 'akismet', name: 'Akismet', version: '5.3', isActive: true }],
      themes: [{ slug: 'tt4', name: 'TT4', version: '1.0', isActive: true }],
    }, now + 1000);

    const db = graphService.getDb()!;
    const row: any = db.prepare('SELECT * FROM sites WHERE id=?').get('ssh:myhost');
    expect(row.wp_version).toBe('6.8.0');
    expect(row.php_version).toBe('8.3.1');
    expect(row.site_url).toBe('https://real.example.com');
    expect(row.admin_email).toBe('a@b.com');
    expect(row.post_count).toBe(5);
    expect(row.user_count).toBe(2);
    expect(row.user_count_by_role).toBe(JSON.stringify({ administrator: 1 }));
    expect(row.ssh_last_sync_at).toBe(now + 1000);
    expect(row.domain).toBe('real.example.com'); // upgraded from the alias via siteUrl

    const plugins: any[] = db.prepare('SELECT * FROM plugins WHERE site_id=?').all('ssh:myhost');
    expect(plugins.map((p) => p.slug)).toEqual(['akismet']);
    const themes: any[] = db.prepare('SELECT * FROM themes WHERE site_id=?').all('ssh:myhost');
    expect(themes.map((t) => t.slug)).toEqual(['tt4']);

    // Next cycle only collects wp_version — every other extended field, and
    // php_version, must survive untouched (the honesty rule, against real SQL).
    await writeExternalHostData(graphService as any, 'ssh:myhost', 'myhost', {
      wpVersion: '6.8.1',
    }, now + 2000);

    const row2: any = db.prepare('SELECT * FROM sites WHERE id=?').get('ssh:myhost');
    expect(row2.wp_version).toBe('6.8.1');
    expect(row2.php_version).toBe('8.3.1');
    expect(row2.post_count).toBe(5);
    expect(row2.user_count).toBe(2);
    expect(row2.site_url).toBe('https://real.example.com');
    // Plugin/theme rows untouched — this cycle's data had no plugins/themes keys.
    const pluginsAfter: any[] = db.prepare('SELECT * FROM plugins WHERE site_id=?').all('ssh:myhost');
    expect(pluginsAfter).toHaveLength(1);
  });

  it('does not stamp ssh_last_sync_at or touch any row when nothing was collected', async () => {
    const now = Date.now();
    await graphService.upsertSite({
      id: 'ssh:myhost', name: 'myhost', domain: 'myhost', source: 'external', host: 'external',
      is_active: true, created_at: now, updated_at: now,
    } as any);

    await writeExternalHostData(graphService as any, 'ssh:myhost', 'myhost', {}, now + 5000);

    const db = graphService.getDb()!;
    const row: any = db.prepare('SELECT * FROM sites WHERE id=?').get('ssh:myhost');
    expect(row.ssh_last_sync_at).toBeNull();
    expect(row.updated_at).toBe(now); // unchanged
  });
});
