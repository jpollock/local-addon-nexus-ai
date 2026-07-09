#!/usr/bin/env npx tsx
// scripts/benchmark-vector-backends.ts
// Run: npx tsx scripts/benchmark-vector-backends.ts
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SqliteVecStore } from '../src/main/vector-store/SqliteVecStore';
import { VectorStore } from '../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../src/main/embeddings/EmbeddingService';
import { EMBEDDING_MODEL_DIR } from '../src/common/constants';
import type { IVectorStore } from '../src/main/vector-store/IVectorStore';
import type { VectorDocument } from '../src/common/types';

const CORPUS_SIZE = 200;
const QUERIES = [
  'WooCommerce payment gateway configuration',
  'WordPress plugin development hooks filters',
  'site performance caching optimization',
  'user authentication login security',
  'contact form email SMTP setup',
  'database backup restore migration',
  'SEO meta tags sitemap XML',
  'custom post type taxonomy registration',
  'REST API endpoint authentication JWT',
  'media upload file handling images',
  'child theme template override',
  'security hardening brute force protection',
  'multisite network domain mapping',
  'shortcode block editor Gutenberg',
  'ACF advanced custom fields flexible content',
  'WooCommerce variable products shipping zones',
  'WordPress user roles capabilities',
  'WP Cron scheduled tasks background jobs',
  'AJAX nonce verification handler',
  'internationalization translation WPML',
];

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1)];
}

function topN(results: Array<{ postId: number }>, n: number): Set<number> {
  return new Set(results.slice(0, n).map(r => r.postId));
}

function jaccardOverlap(a: Set<number>, b: Set<number>): number {
  let intersection = 0;
  for (const id of a) { if (b.has(id)) intersection++; }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

async function buildCorpus(embedSvc: EmbeddingService): Promise<VectorDocument[]> {
  const topics = ['checkout', 'plugin', 'theme', 'database', 'security', 'performance', 'api', 'media', 'user', 'cron'];
  const docs: VectorDocument[] = [];
  process.stdout.write(`Building corpus of ${CORPUS_SIZE} documents...\n`);
  for (let i = 0; i < CORPUS_SIZE; i++) {
    const topic = topics[i % topics.length];
    const text = `${topic} related WordPress content for post number ${i}. This covers ${topic} configuration, setup, and best practices for WordPress sites running WooCommerce and other plugins.`;
    const vector = await embedSvc.embed(text);
    docs.push({
      id: `wp_bench_${i}`, siteId: 'bench-site',
      title: `${topic} guide ${i}`, content: text, postType: 'post',
      postId: i, chunkIndex: 0, vector, metadata: '{}',
      indexedAt: Date.now(), post_date_gmt: '', post_modified_gmt: '', doc_url: '',
    });
    if (i % 50 === 0) process.stdout.write(`  ${i}/${CORPUS_SIZE}\r`);
  }
  process.stdout.write(`  ${CORPUS_SIZE}/${CORPUS_SIZE} — done\n`);
  return docs;
}

async function bench(
  name: string,
  store: IVectorStore,
  corpus: VectorDocument[],
  queryVectors: Float32Array[],
): Promise<{ latencies: number[]; resultSets: Array<Array<{ postId: number }>> }> {
  process.stdout.write(`\n[${name}] Indexing ${corpus.length} docs...\n`);
  await store.initialize();
  await store.upsert('bench-site', corpus);

  process.stdout.write(`[${name}] Querying (${QUERIES.length} queries)...\n`);
  const latencies: number[] = [];
  const resultSets: Array<Array<{ postId: number }>> = [];

  for (const vec of queryVectors) {
    const t0 = performance.now();
    const hits = await store.search('bench-site', vec, { limit: 10 });
    latencies.push(performance.now() - t0);
    resultSets.push(hits.map(h => ({ postId: h.postId })));
  }

  await store.close();
  return { latencies, resultSets };
}

async function main() {
  const modelDir = path.join(__dirname, '..', 'models', EMBEDDING_MODEL_DIR);
  if (!fs.existsSync(modelDir)) {
    console.error(`Model not found at ${modelDir}. Run: npm run download-model`);
    process.exit(1);
  }

  const embedSvc = new EmbeddingService(modelDir);
  await embedSvc.initialize();

  const corpus = await buildCorpus(embedSvc);

  process.stdout.write('\nEmbedding queries...\n');
  const queryVectors = await embedSvc.embedBatch(QUERIES);

  const lanceDir = path.join(os.tmpdir(), `bench-lance-${Date.now()}`);
  const sqliteDbPath = path.join(os.tmpdir(), `bench-sqlite-${Date.now()}.db`);

  const lanceOut = await bench('LanceDB', new VectorStore(lanceDir), corpus, queryVectors);
  const sqliteOut = await bench('sqlite-vec', new SqliteVecStore(sqliteDbPath), corpus, queryVectors);

  try { fs.rmSync(lanceDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.unlinkSync(sqliteDbPath); } catch { /* ignore */ }

  const ls = [...lanceOut.latencies].sort((a, b) => a - b);
  const ss = [...sqliteOut.latencies].sort((a, b) => a - b);

  const overlaps = lanceOut.resultSets.map((lHits, i) =>
    jaccardOverlap(topN(lHits, 5), topN(sqliteOut.resultSets[i], 5)),
  );
  const avgOverlap = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;

  console.log('\n=== BENCHMARK RESULTS ===');
  console.log('\nLatency (ms)              LanceDB    sqlite-vec');
  console.log(`  p50                   ${pct(ls, 50).toFixed(2).padStart(8)}   ${pct(ss, 50).toFixed(2).padStart(8)}`);
  console.log(`  p95                   ${pct(ls, 95).toFixed(2).padStart(8)}   ${pct(ss, 95).toFixed(2).padStart(8)}`);
  console.log(`  max                   ${Math.max(...lanceOut.latencies).toFixed(2).padStart(8)}   ${Math.max(...sqliteOut.latencies).toFixed(2).padStart(8)}`);
  console.log('\nTop-5 result overlap (Jaccard)');
  console.log(`  average               ${(avgOverlap * 100).toFixed(1)}%`);
  console.log(`  minimum               ${(Math.min(...overlaps) * 100).toFixed(1)}%`);

  console.log('\n=== PER-QUERY ===');
  QUERIES.forEach((q, i) => {
    const flag = overlaps[i] < 0.8 ? ' ⚠️ ' : '    ';
    console.log(`${flag}Q${String(i + 1).padStart(2)}: ${q.substring(0, 38).padEnd(38)} lance=${lanceOut.latencies[i].toFixed(1)}ms sqlite=${sqliteOut.latencies[i].toFixed(1)}ms overlap=${(overlaps[i] * 100).toFixed(0)}%`);
  });

  await embedSvc.close();
}

main().catch(err => { console.error(err); process.exit(1); });
