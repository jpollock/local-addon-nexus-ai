// Common English stopwords — removed from keyword queries so "sites with >4 plugins"
// doesn't match posts containing "with" or single-digit numbers.
const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'shall','can','need','dare','ought','used','about','above','after',
  'against','along','among','around','as','before','behind','below',
  'beneath','beside','between','beyond','during','except','into',
  'near','off','out','over','past','since','than','that','these','this',
  'those','through','throughout','under','until','up','upon','within',
  'without','get','got','make','go','going','it','its','i','my','we',
  'our','you','your','they','their','he','his','she','her','what',
  'which','who','how','when','where','why','all','not','no','so','just',
  'sites','site','show','find','list','give','tell','which','have',
]);

/**
 * Clean a search query for FTS: remove stopwords and short tokens.
 * Returns null if nothing meaningful remains (caller should skip search).
 */
export function cleanKeywordQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(/[><=!?]/g, ' ')   // strip operators
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9-]/g, ''))
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));

  if (tokens.length === 0) return null;
  return tokens.join(' ');
}

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

  const cleaned = cleanKeywordQuery(query);
  if (!cleaned) return []; // nothing meaningful to search

  try {
    // Try both columns; fall back to content-only if title FTS index is missing
    let raw: any[];
    try {
      raw = await table
        .query()
        .fullTextSearch(cleaned, { columns: ['content', 'title'] })
        .limit(limit * 3)
        .toArray();
    } catch {
      raw = await table
        .query()
        .fullTextSearch(cleaned, { columns: ['content'] })
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
