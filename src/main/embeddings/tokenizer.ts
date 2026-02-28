import * as fs from 'fs';
import { EMBEDDING_MAX_SEQUENCE_LENGTH } from '../../common/constants';

/**
 * Minimal WordPiece tokenizer for all-MiniLM-L6-v2.
 *
 * Implements the BERT tokenization pipeline:
 * 1. Lowercase + strip accents
 * 2. Split on whitespace and punctuation
 * 3. WordPiece subword tokenization
 * 4. Add [CLS] / [SEP] special tokens
 * 5. Truncate to max sequence length
 */
export class WordPieceTokenizer {
  private vocab: Map<string, number> = new Map();
  private unkTokenId: number = 0;
  private clsTokenId: number = 0;
  private sepTokenId: number = 0;
  private padTokenId: number = 0;
  private maxLength: number;

  constructor(maxLength: number = EMBEDDING_MAX_SEQUENCE_LENGTH) {
    this.maxLength = maxLength;
  }

  loadVocab(vocabPath: string): void {
    const content = fs.readFileSync(vocabPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const token = lines[i].trimEnd();
      if (token.length > 0) {
        this.vocab.set(token, i);
      }
    }

    this.unkTokenId = this.vocab.get('[UNK]') ?? 100;
    this.clsTokenId = this.vocab.get('[CLS]') ?? 101;
    this.sepTokenId = this.vocab.get('[SEP]') ?? 102;
    this.padTokenId = this.vocab.get('[PAD]') ?? 0;
  }

  /**
   * Tokenize text into input_ids, attention_mask, and token_type_ids.
   * Returns fixed-length arrays padded to maxLength.
   */
  tokenize(text: string): {
    inputIds: BigInt64Array;
    attentionMask: BigInt64Array;
    tokenTypeIds: BigInt64Array;
  } {
    // Pre-tokenize: lowercase, strip accents, split on whitespace + punctuation
    const tokens = this.preTokenize(text);

    // WordPiece tokenization
    const wordPieceIds: number[] = [this.clsTokenId];

    for (const token of tokens) {
      const subIds = this.wordPieceTokenize(token);
      // Reserve space for [SEP]
      if (wordPieceIds.length + subIds.length >= this.maxLength - 1) {
        // Add as many subwords as fit
        const remaining = this.maxLength - 1 - wordPieceIds.length;
        wordPieceIds.push(...subIds.slice(0, remaining));
        break;
      }
      wordPieceIds.push(...subIds);
    }

    wordPieceIds.push(this.sepTokenId);

    // Pad to maxLength
    const seqLen = wordPieceIds.length;
    const inputIds = new BigInt64Array(this.maxLength);
    const attentionMask = new BigInt64Array(this.maxLength);
    const tokenTypeIds = new BigInt64Array(this.maxLength);

    for (let i = 0; i < this.maxLength; i++) {
      if (i < seqLen) {
        inputIds[i] = BigInt(wordPieceIds[i]);
        attentionMask[i] = 1n;
      } else {
        inputIds[i] = BigInt(this.padTokenId);
        attentionMask[i] = 0n;
      }
      tokenTypeIds[i] = 0n;
    }

    return { inputIds, attentionMask, tokenTypeIds };
  }

  /**
   * Basic pre-tokenization: lowercase, normalize unicode, split on
   * whitespace and punctuation, keeping punctuation as separate tokens.
   */
  private preTokenize(text: string): string[] {
    // Lowercase
    let normalized = text.toLowerCase();

    // Strip accents (NFD decomposition, remove combining marks)
    normalized = normalized
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // Insert spaces around punctuation so they become separate tokens
    normalized = normalized.replace(
      /([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
      ' $1 '
    );

    // Split on whitespace, filter empties
    return normalized.split(/\s+/).filter((t) => t.length > 0);
  }

  /**
   * WordPiece tokenization for a single pre-token.
   * Greedily matches the longest subword from the vocabulary.
   */
  private wordPieceTokenize(token: string): number[] {
    if (token.length === 0) return [];

    const ids: number[] = [];
    let start = 0;

    while (start < token.length) {
      let end = token.length;
      let foundId: number | null = null;

      while (start < end) {
        let substr = token.slice(start, end);
        if (start > 0) {
          substr = '##' + substr;
        }

        const id = this.vocab.get(substr);
        if (id !== undefined) {
          foundId = id;
          break;
        }
        end--;
      }

      if (foundId === null) {
        // Character not in vocab — use [UNK]
        ids.push(this.unkTokenId);
        start++;
      } else {
        ids.push(foundId);
        start = end;
      }
    }

    return ids;
  }
}
