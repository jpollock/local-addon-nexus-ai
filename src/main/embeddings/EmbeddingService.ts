import * as ort from 'onnxruntime-node';
import * as path from 'path';
import { VECTOR_DIMENSIONS, EMBEDDING_MAX_SEQUENCE_LENGTH } from '../../common/constants';
import { WordPieceTokenizer } from './tokenizer';

export class EmbeddingService {
  private session: ort.InferenceSession | null = null;
  private tokenizer: WordPieceTokenizer;
  private modelPath: string;
  private vocabPath: string;

  constructor(modelDir: string) {
    this.modelPath = path.join(modelDir, 'model.onnx');
    this.vocabPath = path.join(modelDir, 'vocab.txt');
    this.tokenizer = new WordPieceTokenizer(EMBEDDING_MAX_SEQUENCE_LENGTH);
  }

  async initialize(): Promise<void> {
    this.tokenizer.loadVocab(this.vocabPath);

    this.session = await ort.InferenceSession.create(this.modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
  }

  isReady(): boolean {
    return this.session !== null;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.session) {
      throw new Error('EmbeddingService not initialized. Call initialize() first.');
    }

    const batchSize = texts.length;
    const seqLen = EMBEDDING_MAX_SEQUENCE_LENGTH;

    // Tokenize all texts
    const allInputIds = new BigInt64Array(batchSize * seqLen);
    const allAttentionMask = new BigInt64Array(batchSize * seqLen);
    const allTokenTypeIds = new BigInt64Array(batchSize * seqLen);

    for (let i = 0; i < batchSize; i++) {
      const { inputIds, attentionMask, tokenTypeIds } = this.tokenizer.tokenize(texts[i]);
      const offset = i * seqLen;
      allInputIds.set(inputIds, offset);
      allAttentionMask.set(attentionMask, offset);
      allTokenTypeIds.set(tokenTypeIds, offset);
    }

    // Create ONNX tensors
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', allInputIds, [batchSize, seqLen]),
      attention_mask: new ort.Tensor('int64', allAttentionMask, [batchSize, seqLen]),
      token_type_ids: new ort.Tensor('int64', allTokenTypeIds, [batchSize, seqLen]),
    };

    // Run inference
    const output = await this.session.run(feeds);

    // The model outputs last_hidden_state with shape [batch, seq_len, hidden_size]
    // We need to find the right output name
    const outputName = this.session.outputNames[0];
    const hiddenStates = output[outputName];

    if (!hiddenStates) {
      throw new Error(`Model output "${outputName}" not found`);
    }

    const hiddenData = hiddenStates.data as Float32Array;
    const hiddenSize = VECTOR_DIMENSIONS;

    // Mean pooling + L2 normalization for each item in the batch
    const embeddings: Float32Array[] = [];

    for (let b = 0; b < batchSize; b++) {
      const embedding = this.meanPool(
        hiddenData,
        allAttentionMask,
        b,
        seqLen,
        hiddenSize
      );
      this.l2Normalize(embedding);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  /**
   * Mean pooling: average hidden states weighted by attention mask.
   * Only non-padding tokens contribute to the mean.
   */
  private meanPool(
    hiddenData: Float32Array,
    attentionMask: BigInt64Array,
    batchIndex: number,
    seqLen: number,
    hiddenSize: number
  ): Float32Array {
    const result = new Float32Array(hiddenSize);
    let tokenCount = 0;

    for (let t = 0; t < seqLen; t++) {
      const maskVal = Number(attentionMask[batchIndex * seqLen + t]);
      if (maskVal === 0) continue;

      tokenCount++;
      const offset = (batchIndex * seqLen + t) * hiddenSize;
      for (let h = 0; h < hiddenSize; h++) {
        result[h] += hiddenData[offset + h];
      }
    }

    if (tokenCount > 0) {
      for (let h = 0; h < hiddenSize; h++) {
        result[h] /= tokenCount;
      }
    }

    return result;
  }

  /**
   * In-place L2 normalization.
   */
  private l2Normalize(vec: Float32Array): void {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }
}
