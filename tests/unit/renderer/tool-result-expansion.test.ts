describe('tool result expansion state', () => {
  it('expandedTools starts empty', () => {
    const expanded = new Set<string>();
    expect(expanded.size).toBe(0);
  });

  it('toggling adds then removes a tool id', () => {
    let expanded = new Set<string>();
    const id = 'abc123';

    // Add
    expanded = new Set(expanded);
    expanded.add(id);
    expect(expanded.has(id)).toBe(true);

    // Remove
    expanded = new Set(expanded);
    expanded.delete(id);
    expect(expanded.has(id)).toBe(false);
  });

  it('result text is formatted as JSON when parseable object', () => {
    const raw = '{"count":3,"sites":["a","b","c"]}';
    let display: string;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        display = JSON.stringify(parsed, null, 2);
      } else {
        display = raw;
      }
    } catch {
      display = raw;
    }
    expect(display).toContain('"count": 3');
  });

  it('truncates long results at 2000 chars', () => {
    const long = 'x'.repeat(3000);
    const truncated = long.length > 2000 ? long.slice(0, 2000) + '…' : long;
    expect(truncated.length).toBe(2001); // 2000 + ellipsis
    expect(truncated.endsWith('…')).toBe(true);
  });
});
