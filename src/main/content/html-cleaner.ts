/**
 * Cleans WordPress/Gutenberg content into plain text suitable for embedding.
 *
 * Strips block comments, HTML tags, decodes entities, and normalises whitespace.
 */

const BLOCK_COMMENT_RE = /<!--\s*\/?wp:\S[^]*?-->/g;
const HTML_TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&hellip;': '\u2026',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
};

const ENTITY_RE = /&(?:#(?:x[0-9a-fA-F]+|[0-9]+)|[a-zA-Z]+);/g;

function decodeEntities(text: string): string {
  return text.replace(ENTITY_RE, (match) => {
    // Named entity
    const known = HTML_ENTITIES[match.toLowerCase()];
    if (known) return known;

    // Numeric entity: &#123; or &#x1A;
    if (match.startsWith('&#x') || match.startsWith('&#X')) {
      const code = parseInt(match.slice(3, -1), 16);
      return isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (match.startsWith('&#')) {
      const code = parseInt(match.slice(2, -1), 10);
      return isNaN(code) ? match : String.fromCodePoint(code);
    }

    return match;
  });
}

export function cleanWordPressContent(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // 1. Remove Gutenberg block comments
  text = text.replace(BLOCK_COMMENT_RE, ' ');

  // 2. Strip HTML tags
  text = text.replace(HTML_TAG_RE, ' ');

  // 3. Decode HTML entities
  text = decodeEntities(text);

  // 4. Collapse whitespace
  text = text.replace(WHITESPACE_RE, ' ');

  // 5. Trim
  return text.trim();
}
