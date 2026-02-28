import { VECTOR_DIMENSIONS } from '../../common/constants';

/**
 * LanceDB table schema for site content.
 *
 * LanceDB infers schema from the first inserted record.
 * This function produces a seed record with the correct types
 * so the table is created with the right column types.
 */
export function createSeedRecord() {
  return {
    id: '__seed__',
    siteId: '',
    title: '',
    content: '',
    postType: '',
    postId: 0,
    chunkIndex: 0,
    vector: new Array(VECTOR_DIMENSIONS).fill(0),
    metadata: '{}',
    indexedAt: 0,
  };
}

/**
 * Convert a VectorDocument to a plain object suitable for LanceDB insertion.
 * LanceDB doesn't accept Float32Array directly — convert to number[].
 */
export function toRecord(doc: {
  id: string;
  siteId: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  chunkIndex: number;
  vector: Float32Array | number[];
  metadata: string;
  indexedAt: number;
}) {
  return {
    id: doc.id,
    siteId: doc.siteId,
    title: doc.title,
    content: doc.content,
    postType: doc.postType,
    postId: doc.postId,
    chunkIndex: doc.chunkIndex,
    vector: Array.from(doc.vector),
    metadata: doc.metadata,
    indexedAt: doc.indexedAt,
  };
}
