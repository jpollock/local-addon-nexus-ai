// tests/unit/vector-store/sqlite-vec-store.test.ts
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SqliteVecStore } from '../../../src/main/vector-store/SqliteVecStore';
import type { VectorDocument } from '../../../src/common/types';
import { VECTOR_DIMENSIONS } from '../../../src/common/constants';

function tmpDb(): string {
  return path.join(os.tmpdir(), `test-vec-${process.hrtime.bigint()}.db`);
}

export function makeDoc(overrides: Partial<VectorDocument> = {}): VectorDocument {
  return {
    id: 'wp_site1_1',
    siteId: 'site-1',
    title: 'Hello World',
    content: 'This is a test post about hello world.',
    postType: 'post',
    postId: 1,
    chunkIndex: 0,
    vector: new Float32Array(VECTOR_DIMENSIONS).fill(0.1),
    metadata: JSON.stringify({ excerpt: 'test' }),
    indexedAt: Date.now(),
    post_date_gmt: '2024-01-01T00:00:00',
    post_modified_gmt: '2024-01-01T00:00:00',
    doc_url: 'https://example.com/hello-world',
    ...overrides,
  };
}

describe('SqliteVecStore — initialize/close', () => {
  it('initializes and closes without error', async () => {
    const dbPath = tmpDb();
    const store = new SqliteVecStore(dbPath);
    await store.initialize();
    await store.close();
    fs.unlinkSync(dbPath);
  });

  it('throws when upsert is called before initialize', async () => {
    const store = new SqliteVecStore(tmpDb());
    await expect(store.upsert('site-1', [])).rejects.toThrow('not initialized');
  });
});
