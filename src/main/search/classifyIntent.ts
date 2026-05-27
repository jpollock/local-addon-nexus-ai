import type { SearchIntent } from '../../common/types';

const METADATA_SIGNALS = [
  /\bsites?\s+with\b/i,
  /\bwhich\s+sites?\b/i,
  /\brunning\s+php\b/i,
  /\bon\s+wp\s+\d/i,
  /\bphp\s+\d/i,
  /\bwp\s+\d+\.\d/i,
  /\bplugin\b/i,
  /\btheme\b/i,
  /\bversion\b/i,
  /\binstalled\b/i,
  /\bactive\b/i,
  /\binactive\b/i,
];

/**
 * Classify a search query as content, metadata, or both.
 * Returns 'both' when any metadata signal is detected so users always see
 * metadata results when relevant — they can override via the mode pill.
 */
export function classifyIntent(query: string): SearchIntent {
  if (METADATA_SIGNALS.some(p => p.test(query))) return 'both';
  return 'content';
}
