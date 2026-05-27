/**
 * Lightweight markdown → React element renderer for the ChatTab.
 * Handles the subset Claude actually uses: headings, bold, italic,
 * code, horizontal rules, blockquotes, and unordered lists.
 *
 * No external dependencies. React.createElement only — no JSX.
 */
import * as React from 'react';

// ---------------------------------------------------------------------------
// Inline parser — handles **bold**, *italic*, `code`
// ---------------------------------------------------------------------------

let _inlineKey = 0;
function inlineKey() { return `i${_inlineKey++}`; }

function parseInline(text: string): React.ReactNode[] {
  if (!text) return [];
  // Split on **bold**, *italic*, `code` — non-greedy, single-line only
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/);
  return parts.map(part => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return React.createElement('strong', { key: inlineKey() }, part.slice(2, -2));
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2 && !part.startsWith('**')) {
      return React.createElement('em', { key: inlineKey() }, part.slice(1, -1));
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return React.createElement('code', {
        key: inlineKey(),
        style: { background: 'rgba(110,118,129,.4)', padding: '1px 5px', borderRadius: 3, fontSize: '0.88em', fontFamily: 'monospace' },
      }, part.slice(1, -1));
    }
    return part || null;
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Block renderer
// ---------------------------------------------------------------------------

let _blockKey = 0;
function blockKey() { return `b${_blockKey++}`; }

export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  _inlineKey = 0;
  _blockKey  = 0;

  const lines  = text.split('\n');
  const blocks: React.ReactNode[] = [];
  const listBuf: string[] = [];
  const tableBuf: string[] = [];

  const flushList = () => {
    if (listBuf.length === 0) return;
    blocks.push(
      React.createElement('ul', {
        key: blockKey(),
        style: { margin: '4px 0', paddingLeft: 18, listStyleType: 'disc' },
      },
        ...listBuf.map(item =>
          React.createElement('li', { key: blockKey(), style: { margin: '2px 0', lineHeight: 1.55 } },
            ...parseInline(item),
          ),
        ),
      ),
    );
    listBuf.length = 0;
  };

  const flushTable = () => {
    if (tableBuf.length === 0) return;
    const parseRow = (row: string) =>
      row.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    const rows = tableBuf.filter(r => !/^[|\s:-]+$/.test(r)); // strip separator rows
    tableBuf.length = 0;
    if (rows.length === 0) return;
    const [headerRow, ...dataRows] = rows;
    const headers = parseRow(headerRow);
    const thStyle: React.CSSProperties = { padding: '5px 10px', textAlign: 'left', borderBottom: '2px solid #30363d', fontWeight: 700, fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)', whiteSpace: 'nowrap' };
    const tdStyle: React.CSSProperties = { padding: '5px 10px', borderBottom: '1px solid #21262d', fontSize: 12, verticalAlign: 'top' };
    blocks.push(
      React.createElement('div', { key: blockKey(), style: { overflowX: 'auto', margin: '8px 0' } },
        React.createElement('table', { style: { borderCollapse: 'collapse', width: '100%', background: 'var(--nxai-card-bg, #21262d)', borderRadius: 6, overflow: 'hidden' } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              ...headers.map(h => React.createElement('th', { key: blockKey(), style: thStyle }, ...parseInline(h))),
            ),
          ),
          React.createElement('tbody', null,
            ...dataRows.map(row => {
              const cells = parseRow(row);
              return React.createElement('tr', { key: blockKey() },
                ...cells.map((c, ci) => React.createElement('td', { key: blockKey(), style: { ...tdStyle, ...(ci === 0 ? { fontWeight: 500 } : {}) } }, ...parseInline(c ?? ''))),
              );
            }),
          ),
        ),
      ),
    );
  };

  for (const raw of lines) {
    const line = raw;

    // Table row — starts and ends with |
    if (line.startsWith('|') && line.trim().endsWith('|')) {
      flushList();
      tableBuf.push(line);
      continue;
    }

    // Non-table line — flush any pending table
    if (tableBuf.length > 0) flushTable();

    // Horizontal rule
    if (/^[-*]{3,}$/.test(line.trim())) {
      flushList();
      blocks.push(React.createElement('hr', { key: blockKey(), style: { border: 'none', borderTop: '1px solid #30363d', margin: '8px 0' } }));
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      flushList();
      blocks.push(React.createElement('div', {
        key: blockKey(),
        style: { fontWeight: 700, fontSize: 14, margin: '10px 0 3px', color: 'var(--nxai-card-text, #e6edf3)' },
      }, ...parseInline(line.slice(4))));
      continue;
    }

    // H2
    if (line.startsWith('## ')) {
      flushList();
      blocks.push(React.createElement('div', {
        key: blockKey(),
        style: { fontWeight: 700, fontSize: 15, margin: '12px 0 3px', color: 'var(--nxai-card-text, #e6edf3)' },
      }, ...parseInline(line.slice(3))));
      continue;
    }

    // H1
    if (line.startsWith('# ')) {
      flushList();
      blocks.push(React.createElement('div', {
        key: blockKey(),
        style: { fontWeight: 700, fontSize: 16, margin: '14px 0 4px', color: 'var(--nxai-card-text, #e6edf3)' },
      }, ...parseInline(line.slice(2))));
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      blocks.push(React.createElement('div', {
        key: blockKey(),
        style: { borderLeft: '3px solid #f59e0b', paddingLeft: 10, margin: '6px 0', color: '#fbbf24', fontSize: 13, lineHeight: 1.5 },
      }, ...parseInline(line.slice(2))));
      continue;
    }

    // Unordered list item
    if (/^[-*+] /.test(line)) {
      listBuf.push(line.slice(2));
      continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      flushList();
      blocks.push(React.createElement('div', { key: blockKey(), style: { height: 5 } }));
      continue;
    }

    // Normal paragraph
    flushList();
    blocks.push(React.createElement('div', {
      key: blockKey(),
      style: { lineHeight: 1.6 },
    }, ...parseInline(line)));
  }

  flushList();
  flushTable();
  return React.createElement('div', { style: { fontSize: 14, color: 'var(--nxai-card-text, #e6edf3)' } }, ...blocks);
}
