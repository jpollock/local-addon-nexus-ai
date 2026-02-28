/**
 * @jest-environment ./tests/environments/onnx-environment.js
 */
import * as path from 'path';
import * as fs from 'fs';
import { VECTOR_DIMENSIONS } from '../../src/common/constants';

// These tests use the real ONNX Runtime and model.
// They require the model to be downloaded first: npm run download-model
// Tests are skipped if the model is not present.

const MODEL_DIR = path.join(__dirname, '..', '..', 'models', 'all-MiniLM-L6-v2-quantized');
const MODEL_EXISTS =
  fs.existsSync(path.join(MODEL_DIR, 'model.onnx')) &&
  fs.existsSync(path.join(MODEL_DIR, 'vocab.txt'));

const describeWithModel = MODEL_EXISTS ? describe : describe.skip;

describeWithModel('EmbeddingService (requires model)', () => {
  // Dynamic import to avoid loading onnxruntime-node when model isn't present
  let EmbeddingService: any;

  beforeAll(async () => {
    const mod = await import('../../src/main/embeddings/EmbeddingService');
    EmbeddingService = mod.EmbeddingService;
  });

  test('initializes and produces 384-dim embeddings', async () => {
    const service = new EmbeddingService(MODEL_DIR);
    await service.initialize();

    expect(service.isReady()).toBe(true);

    const embedding = await service.embed('Hello world');
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(VECTOR_DIMENSIONS);

    await service.close();
  });

  test('same text produces same embedding (deterministic)', async () => {
    const service = new EmbeddingService(MODEL_DIR);
    await service.initialize();

    const a = await service.embed('WordPress is a content management system');
    const b = await service.embed('WordPress is a content management system');

    for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
      expect(a[i]).toBeCloseTo(b[i], 6);
    }

    await service.close();
  });

  test('similar texts have higher cosine similarity than unrelated texts', async () => {
    const service = new EmbeddingService(MODEL_DIR);
    await service.initialize();

    const wp = await service.embed('WordPress is a popular CMS for building websites');
    const cms = await service.embed('Content management systems help people create web pages');
    const unrelated = await service.embed('The quick brown fox jumps over the lazy dog');

    const simRelated = cosine(wp, cms);
    const simUnrelated = cosine(wp, unrelated);

    expect(simRelated).toBeGreaterThan(simUnrelated);

    await service.close();
  });

  test('batch embedding matches individual embeddings', async () => {
    const service = new EmbeddingService(MODEL_DIR);
    await service.initialize();

    const texts = ['Hello world', 'WordPress plugins', 'Database migration'];
    const batch = await service.embedBatch(texts);

    for (let i = 0; i < texts.length; i++) {
      const individual = await service.embed(texts[i]);
      for (let j = 0; j < VECTOR_DIMENSIONS; j++) {
        expect(batch[i][j]).toBeCloseTo(individual[j], 1);
      }
    }

    await service.close();
  });

  test('handles empty string', async () => {
    const service = new EmbeddingService(MODEL_DIR);
    await service.initialize();

    const embedding = await service.embed('');
    expect(embedding.length).toBe(VECTOR_DIMENSIONS);

    await service.close();
  });

  test('handles very long text (truncation)', async () => {
    const service = new EmbeddingService(MODEL_DIR);
    await service.initialize();

    const longText = 'word '.repeat(1000);
    const embedding = await service.embed(longText);
    expect(embedding.length).toBe(VECTOR_DIMENSIONS);

    await service.close();
  });

  test('embeddings are L2-normalized (unit length)', async () => {
    const service = new EmbeddingService(MODEL_DIR);
    await service.initialize();

    const embedding = await service.embed('Test normalization');
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    expect(norm).toBeCloseTo(1.0, 4);

    await service.close();
  });
});

// Tokenizer unit tests (no model required)
describe('WordPieceTokenizer', () => {
  const vocabPath = path.join(MODEL_DIR, 'vocab.txt');
  const vocabExists = fs.existsSync(vocabPath);

  const describeWithVocab = vocabExists ? describe : describe.skip;

  describeWithVocab('with vocab', () => {
    let WordPieceTokenizer: any;

    beforeAll(async () => {
      const mod = await import('../../src/main/embeddings/tokenizer');
      WordPieceTokenizer = mod.WordPieceTokenizer;
    });

    test('tokenizes simple text', () => {
      const tokenizer = new WordPieceTokenizer(32);
      tokenizer.loadVocab(vocabPath);

      const { inputIds, attentionMask } = tokenizer.tokenize('hello world');

      // First token should be [CLS] (101), last real token should be [SEP] (102)
      expect(Number(inputIds[0])).toBe(101);

      // attentionMask should have 1s for real tokens and 0s for padding
      const realTokenCount = Array.from(attentionMask).filter((v) => v === 1n).length;
      expect(realTokenCount).toBeGreaterThan(2); // At least [CLS] + some tokens + [SEP]
      expect(realTokenCount).toBeLessThanOrEqual(32);
    });

    test('truncates long input to maxLength', () => {
      const tokenizer = new WordPieceTokenizer(16);
      tokenizer.loadVocab(vocabPath);

      const longText = 'word '.repeat(100);
      const { inputIds } = tokenizer.tokenize(longText);

      expect(inputIds.length).toBe(16);
    });

    test('output arrays are correct length', () => {
      const maxLen = 64;
      const tokenizer = new WordPieceTokenizer(maxLen);
      tokenizer.loadVocab(vocabPath);

      const { inputIds, attentionMask, tokenTypeIds } = tokenizer.tokenize('test');

      expect(inputIds.length).toBe(maxLen);
      expect(attentionMask.length).toBe(maxLen);
      expect(tokenTypeIds.length).toBe(maxLen);
    });
  });
});

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
