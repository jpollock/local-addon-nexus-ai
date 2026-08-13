import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { secureDbFile } from '../../../src/main/db/secureDbFile';

describe('secureDbFile (P1-4)', () => {
  function tmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'secdb-'));
  }

  it('restricts the db file and its wal/shm sidecars to 0600', () => {
    const dir = tmp();
    const db = path.join(dir, 'graph.db');
    for (const p of [db, `${db}-wal`, `${db}-shm`]) {
      fs.writeFileSync(p, 'x');
      fs.chmodSync(p, 0o644);
    }

    secureDbFile(db);

    for (const p of [db, `${db}-wal`, `${db}-shm`]) {
      expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    }
  });

  it('does not throw when the sidecars do not exist yet', () => {
    const dir = tmp();
    const db = path.join(dir, 'only.db');
    fs.writeFileSync(db, 'x');
    fs.chmodSync(db, 0o644);

    expect(() => secureDbFile(db)).not.toThrow();
    expect(fs.statSync(db).mode & 0o777).toBe(0o600);
  });

  it('does not throw when the path itself is absent (e.g. :memory:)', () => {
    expect(() => secureDbFile(':memory:')).not.toThrow();
  });
});
