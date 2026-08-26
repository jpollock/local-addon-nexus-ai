/**
 * B-03 candidate selector · hybrid lexical + semantic (P5 stage 4).
 *
 * Runs the REAL pipeline: the compiled ToolRanker over MiniLM embeddings via
 * the production EmbeddingService — the same code path search_tools uses in
 * Local. Requires a built lib/ (npx tsc -p tsconfig.json).
 *
 *   node tests/eval/b03-tool-selection/run.mjs --selector tests/eval/b03-tool-selection/hybrid-selector.mjs
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(repo, 'package.json'));

let rankerPromise = null;
function getRanker() {
  if (!rankerPromise) {
    rankerPromise = (async () => {
      const { EmbeddingService } = require('./lib/main/embeddings/EmbeddingService.js');
      const { ToolRanker } = require('./lib/main/mcp/tool-ranker.js');
      const svc = new EmbeddingService(join(repo, 'models/all-MiniLM-L6-v2-quantized'), 384, 256);
      await svc.initialize();
      return new ToolRanker((texts) => svc.embedBatch(texts));
    })();
  }
  return rankerPromise;
}

export default async function hybridSelector(request, _context, defs) {
  const ranker = await getRanker();
  ranker.ensureIndex(defs);
  await ranker.whenIdle();
  const ranked = await ranker.rank(request, defs, 50);
  return ranked.map((r) => r.name);
}
