# Hybrid Search Implementation Plan

## Changes to SqliteVecStore.search()

Add mode branching at the start of search():
```typescript
const mode = options.searchMode ?? 'semantic';
if (mode === 'semantic') {
  // Existing vector-only path (lines 127-190)
} else if (mode === 'keyword') {
  // Pure FTS5 BM25 search
} else if (mode === 'hybrid') {
  // Vector + BM25 + metadata fusion
}
```

## FTS5 BM25 Search Method

```typescript
private searchBM25(
  siteId: string,
  queryText: string,
  limit: number,
  postTypeFilter?: string
): Array<{rowid: number; rank: number}> {
  const p = this.tablePrefix(siteId);
  let sql = `SELECT rowid, rank FROM "${p}_fts" WHERE "${p}_fts" MATCH ? ORDER BY rank LIMIT ?`;
  const params: any[] = [queryText, limit * 3];
  
  // Note: FTS rank is negative (better = more negative)
  return this.conn.prepare(sql).all(...params);
}
```

## Reciprocal Rank Fusion

```typescript
function rrfScore(rank: number, k = 60): number {
  return 1 / (k + rank);
}

// Merge vector and BM25 results
const vectorRanks = new Map<number, number>(); // postId -> rank (1-based)
vecRows.forEach((r, i) => vectorRanks.set(r.post_id, i + 1));

const bm25Ranks = new Map<number, number>();
bm25Rows.forEach((r, i) => bm25Ranks.set(r.post_id, i + 1));

const allPostIds = new Set([...vectorRanks.keys(), ...bm25Ranks.keys()]);
const fusedScores = new Map<number, number>();

for (const postId of allPostIds) {
  const vecRank = vectorRanks.get(postId) ?? 1000;
  const bm25Rank = bm25Ranks.get(postId) ?? 1000;
  fusedScores.set(postId, rrfScore(vecRank) + rrfScore(bm25Rank));
}
```

## Metadata Filtering/Boosting

```typescript
const filters = options.metadataFilters;
if (filters) {
  for (const doc of docRows) {
    const meta = JSON.parse(doc.metadata);
    const custom = meta.customFields ?? {};
    
    // Difficulty filter
    if (filters.minDifficulty || filters.maxDifficulty) {
      const diff = parseInt(custom.difficulty);
      if (filters.minDifficulty && diff < filters.minDifficulty) continue;
      if (filters.maxDifficulty && diff > filters.maxDifficulty) continue;
    }
    
    // Distance filter
    if (filters.maxDistance) {
      const dist = parseFloat(custom.distance_miles);
      if (dist > filters.maxDistance) continue;
    }
    
    // Elevation filter
    if (filters.maxElevation) {
      const elev = parseFloat(custom.elevation_gain_ft);
      if (elev > filters.maxElevation) continue;
    }
    
    // Difficulty boost: exact match gets +0.3
    if (custom.difficulty === '1' || custom.difficulty === '2') {
      fusedScores.set(doc.post_id, fusedScores.get(doc.post_id)! * 1.3);
    }
  }
}
```

## Implementation Order

1. Add `searchBM25()` helper method
2. Add RRF fusion logic
3. Add metadata filtering/boosting
4. Wire it all together in search() with mode branching
5. Test with "beginner trails" query
