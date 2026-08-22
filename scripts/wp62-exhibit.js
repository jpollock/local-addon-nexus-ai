#!/usr/bin/env node
/**
 * WP-62 acceptance exhibit — the REAL extractor against a REAL install.
 *
 * A composition proved through a fake transport never reaches the boundary
 * (WP-56). This drives `RemoteContentExtractor` over `WpeSshTransport`
 * against an install with more than 200 published posts and prints, for the
 * BEFORE and AFTER shapes: row count, chunk count, custom-field coverage, and
 * one long post's indexed text length against its published length.
 *
 * Read-only: `wp post list` and `wp export --stdout`. Nothing is written to
 * the server, and nothing is written to the local index — this constructs the
 * documents and measures them rather than upserting them.
 *
 *   node scripts/wp62-exhibit.js <install-name>
 */

const path = require('path');
const { performance } = require('perf_hooks');

const { RemoteContentExtractor, REMOTE_PAGE_SIZE } = require('../lib/main/content/RemoteContentExtractor');
const { WpeSshTransport } = require('../lib/main/transport/WpeSshTransport');
const { chunkPosts, buildSearchableText } = require('../lib/main/content/chunker');
const { WordPieceTokenizer } = require('../lib/main/embeddings/tokenizer');
const { EMBEDDING_MODELS } = require('../lib/common/constants');

const install = process.argv[2];
if (!install) {
  console.error('usage: node scripts/wp62-exhibit.js <install-name>');
  process.exit(2);
}

const MODEL = EMBEDDING_MODELS['bge-small'];
const tokenizer = new WordPieceTokenizer(MODEL.contextWindow);
tokenizer.loadVocab(path.join(__dirname, '..', 'models', MODEL.dir, 'vocab.txt'));

/** Tokens the model would actually see, and how many the text really has. */
function tokenStats(text) {
  const { attentionMask } = tokenizer.tokenize(text);
  let kept = 0;
  for (const v of attentionMask) if (Number(v) === 1) kept++;
  // Count the untruncated length by tokenizing in windows.
  const words = text.split(/\s+/).filter(Boolean);
  let total = 0;
  const STRIDE = 100;
  for (let i = 0; i < words.length; i += STRIDE) {
    const piece = words.slice(i, i + STRIDE).join(' ');
    const m = tokenizer.tokenize(piece).attentionMask;
    let n = 0;
    for (const v of m) if (Number(v) === 1) n++;
    total += Math.max(0, n - 2); // drop [CLS]/[SEP] per window
  }
  return { kept, total: total + 2 };
}

const bytes = (s) => Buffer.byteLength(s, 'utf8');

(async () => {
  const transport = new WpeSshTransport(install);
  const logger = {
    info: (...a) => console.log('   ', ...a),
    warn: (...a) => console.log('  !', ...a),
    error: (...a) => console.log('  X', ...a),
  };

  console.log(`\n=== WP-62 EXHIBIT · ${install} ===`);
  console.log(`page size ${REMOTE_PAGE_SIZE} · model ${MODEL.dir} · context window ${MODEL.contextWindow} tokens\n`);

  // ---- the population, straight from WordPress, independent of the extractor
  const countRes = await transport.runWpCli(
    ['post', 'list', '--post_type=any', '--post_status=publish', '--format=count'],
    { skipPlugins: false, skipThemes: false },
  );
  const published = Number(String(countRes.stdout).trim());
  console.log(`PUBLISHED (wp post list --format=count): ${published}`);

  // ---- BEFORE: exactly the query the old extractor issued
  console.log('\n-- BEFORE (one --posts_per_page=200 call, no offset, no meta) --');
  const t0 = performance.now();
  const beforeRes = await transport.runWpCli([
    'post', 'list', '--post_type=any', '--post_status=publish',
    '--fields=ID,post_title,post_content,post_excerpt,post_type,post_status,post_author,post_date',
    '--posts_per_page=200', '--format=json',
  ], { skipPlugins: false, skipThemes: false });
  const beforeMs = performance.now() - t0;
  const beforeRows = JSON.parse(beforeRes.stdout);
  console.log(`rows read      : ${beforeRows.length}   (logged as "${beforeRows.length} total")`);
  console.log(`documents      : ${beforeRows.length}   (one per post, no chunking)`);
  console.log(`custom fields  : none requested`);
  console.log(`elapsed        : ${Math.round(beforeMs)} ms`);

  // ---- AFTER: the real extractor
  console.log('\n-- AFTER (paged, ordered, truncation-aware, meta-collecting) --');
  const t1 = performance.now();
  const memBefore = process.memoryUsage().heapUsed;
  const extracted = await new RemoteContentExtractor({ logger }).extract(transport, install);
  const afterMs = performance.now() - t1;

  const chunks = chunkPosts(`wpe-${install}`, extracted.posts, { source: 'wpe' });
  const peakHeap = process.memoryUsage().heapUsed;

  const withFields = extracted.posts.filter(p => Object.keys(p.customFields).length > 0);
  console.log(`\nrows read      : ${extracted.coverage.rowsReturned} over ${extracted.coverage.pagesFetched} pages`);
  console.log(`indexable posts: ${extracted.posts.length}`);
  console.log(`documents      : ${new Set(chunks.map(c => c.doc.postId)).size}`);
  console.log(`chunks         : ${chunks.length}`);
  console.log(`coverage       : ${extracted.coverage.complete ? 'COMPLETE' : 'PARTIAL — ' + extracted.coverage.truncatedDetail}`);
  console.log(`custom fields  : ${extracted.coverage.customFields} — ${withFields.length} of ${extracted.posts.length} posts carry public meta`);
  console.log(`elapsed        : ${Math.round(afterMs)} ms`);
  console.log(`heap delta     : ${Math.round((peakHeap - memBefore) / 1048576)} MB`);

  // ---- ONE LONG POST: published vs indexed
  const longest = extracted.posts
    .slice()
    .sort((a, b) => buildSearchableText(b).length - buildSearchableText(a).length)[0];
  if (longest) {
    const text = buildSearchableText(longest);
    const stats = tokenStats(text);
    const its = chunks.filter(c => c.doc.postId === longest.id);
    const indexedNow = its.map(c => c.doc.content).join(' ');
    console.log(`\n-- ONE LONG POST · id ${longest.id} · "${longest.title.slice(0, 60)}" --`);
    console.log(`published text     : ${bytes(text)} bytes, ~${stats.total} tokens`);
    console.log(`BEFORE indexed text: ${stats.kept} tokens (cut at the ${MODEL.contextWindow}-token window)`);
    console.log(`                     ${stats.total > stats.kept ? `${stats.total - stats.kept} tokens DROPPED` : 'nothing dropped'}`);
    console.log(`AFTER  indexed text: ${bytes(indexedNow)} bytes across ${its.length} chunk(s)`);
    const fieldKeys = Object.keys(longest.customFields);
    console.log(`custom fields      : ${fieldKeys.length ? fieldKeys.join(', ') : '(none on this post)'}`);
  }

  const fieldy = withFields[0];
  if (fieldy) {
    const line = buildSearchableText(fieldy).split('\n\n').pop();
    console.log(`\n-- CUSTOM FIELDS NOW IN THE SEARCHABLE TEXT (post ${fieldy.id}) --`);
    console.log(`    ${String(line).slice(0, 300)}`);
  }

  console.log('\n=== end exhibit ===\n');
})().catch((e) => { console.error(e); process.exit(1); });
