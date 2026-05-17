export interface KeywordResult {
  id: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  score: number;
  metadata: string;
}

export async function keywordSearch(
  table: any,
  query: string,
  limit: number,
): Promise<KeywordResult[]> {
  if (!table) return [];
  try {
    // Try both columns; fall back to content-only if title FTS index is missing
    let raw: any[];
    try {
      raw = await table
        .query()
        .fullTextSearch(query, { columns: ['content', 'title'] })
        .limit(limit * 3)
        .toArray();
    } catch {
      raw = await table
        .query()
        .fullTextSearch(query, { columns: ['content'] })
        .limit(limit * 3)
        .toArray();
    }

    const seen = new Set<number>();
    const deduped: KeywordResult[] = [];
    for (const row of raw) {
      if (seen.has(row.postId)) continue;
      seen.add(row.postId);
      deduped.push({
        id: row.id,
        title: row.title,
        content: row.content,
        postType: row.postType,
        postId: row.postId,
        score: 1.0,
        metadata: row.metadata ?? '{}',
      });
      if (deduped.length >= limit) break;
    }
    return deduped;
  } catch {
    return [];
  }
}
