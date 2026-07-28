import { formatCustomFields } from '../../../src/main/mcp/modules/content/search-content';

describe('formatCustomFields', () => {
  it('renders customFields compactly', () => {
    const meta = JSON.stringify({ customFields: { difficulty: '2', distance: '4.5', region: 'Rocky Mountains' } });
    const out = formatCustomFields(meta);
    expect(out).toContain('difficulty: 2');
    expect(out).toContain('distance: 4.5');
    expect(out).toContain('region: Rocky Mountains');
  });

  it('returns empty string when no customFields', () => {
    expect(formatCustomFields(JSON.stringify({ excerpt: 'x' }))).toBe('');
  });
});
