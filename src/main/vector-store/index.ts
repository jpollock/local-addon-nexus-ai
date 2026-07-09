// src/main/vector-store/index.ts
import * as path from 'path';
import { VectorStore } from './VectorStore';
import { SqliteVecStore } from './SqliteVecStore';
import type { IVectorStore } from './IVectorStore';

// Flip this constant to compare backends. Rebuild + restart Local after changing.
const VECTOR_BACKEND: 'lancedb' | 'sqlite-vec' = 'lancedb';

export function createVectorStore(dataDir: string): IVectorStore {
  if (VECTOR_BACKEND === 'sqlite-vec') {
    return new SqliteVecStore(path.join(dataDir, 'vectors.db'));
  }
  return new VectorStore(path.join(dataDir, 'vectors'));
}

export type { IVectorStore };
