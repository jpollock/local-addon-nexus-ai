import { phpUnserialize } from '../../../src/main/content/extractors/php-unserialize';

describe('phpUnserialize', () => {
  test('parses strings', () => {
    expect(phpUnserialize('s:5:"hello";')).toBe('hello');
    expect(phpUnserialize('s:0:"";')).toBe('');
    expect(phpUnserialize('s:11:"hello world";')).toBe('hello world');
  });

  test('parses integers', () => {
    expect(phpUnserialize('i:42;')).toBe(42);
    expect(phpUnserialize('i:0;')).toBe(0);
    expect(phpUnserialize('i:-7;')).toBe(-7);
  });

  test('parses booleans', () => {
    expect(phpUnserialize('b:1;')).toBe(true);
    expect(phpUnserialize('b:0;')).toBe(false);
  });

  test('parses null', () => {
    expect(phpUnserialize('N;')).toBe(null);
  });

  test('parses doubles', () => {
    expect(phpUnserialize('d:3.14;')).toBeCloseTo(3.14);
    expect(phpUnserialize('d:0;')).toBe(0);
    expect(phpUnserialize('d:-1.5;')).toBeCloseTo(-1.5);
  });

  test('parses sequential arrays', () => {
    const result = phpUnserialize('a:3:{i:0;s:3:"foo";i:1;s:3:"bar";i:2;s:3:"baz";}');
    expect(result).toEqual(['foo', 'bar', 'baz']);
  });

  test('parses associative arrays', () => {
    const result = phpUnserialize('a:2:{s:4:"name";s:5:"Alice";s:3:"age";i:30;}');
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  test('parses nested arrays', () => {
    const result = phpUnserialize(
      'a:2:{s:4:"list";a:2:{i:0;i:1;i:1;i:2;}s:4:"name";s:4:"test";}'
    );
    expect(result).toEqual({ list: [1, 2], name: 'test' });
  });

  test('parses real ACF-style serialized data', () => {
    // ACF field group config (simplified)
    const acfData = 'a:3:{s:4:"type";s:4:"text";s:5:"label";s:10:"First Name";s:8:"required";i:1;}';
    const result = phpUnserialize(acfData) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result.type).toBe('text');
    expect(result.label).toBe('First Name');
    expect(result.required).toBe(1);
  });

  test('parses WordPress attachment metadata style', () => {
    const meta = 'a:2:{s:5:"width";i:1024;s:6:"height";i:768;}';
    const result = phpUnserialize(meta) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });

  test('returns null for objects', () => {
    expect(phpUnserialize('O:8:"stdClass":0:{}')).toBeNull();
  });

  test('returns null for malformed input', () => {
    expect(phpUnserialize('')).toBeNull();
    expect(phpUnserialize('garbage')).toBeNull();
    expect(phpUnserialize('s:99:"too short";')).toBeNull();
    expect(phpUnserialize('a:1:{broken')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(phpUnserialize(null as any)).toBeNull();
    expect(phpUnserialize(undefined as any)).toBeNull();
    expect(phpUnserialize(123 as any)).toBeNull();
  });

  test('parses empty array', () => {
    expect(phpUnserialize('a:0:{}')).toEqual({});
  });

  test('parses mixed-type array values', () => {
    const result = phpUnserialize('a:4:{s:1:"a";s:3:"str";s:1:"b";i:42;s:1:"c";b:1;s:1:"d";N;}');
    expect(result).toEqual({ a: 'str', b: 42, c: true, d: null });
  });
});
