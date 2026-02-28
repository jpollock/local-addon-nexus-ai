/**
 * Minimal PHP unserialize() implementation for reading ACF field values
 * and WordPress serialized metadata (_wp_attachment_metadata, etc.).
 *
 * Handles: s:N:"string", i:N, b:0|1, a:N:{...}, d:N.N, N; (null)
 * Returns null for objects (O:) and malformed input — never throws.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface PhpArray extends Array<PhpValue> {}
interface PhpRecord { [key: string]: PhpValue }
type PhpValue = string | number | boolean | null | PhpArray | PhpRecord;

interface ParseState {
  data: string;
  pos: number;
}

function readInt(state: ParseState): number | null {
  const start = state.pos;
  // Read until we hit a non-digit/non-minus character
  while (state.pos < state.data.length && /[-0-9]/.test(state.data[state.pos])) {
    state.pos++;
  }
  if (state.pos === start) return null;
  const val = parseInt(state.data.slice(start, state.pos), 10);
  return isNaN(val) ? null : val;
}

function readFloat(state: ParseState): number | null {
  const start = state.pos;
  while (state.pos < state.data.length && /[-0-9.eE+]/.test(state.data[state.pos])) {
    state.pos++;
  }
  if (state.pos === start) return null;
  const val = parseFloat(state.data.slice(start, state.pos));
  return isNaN(val) ? null : val;
}

function expect(state: ParseState, char: string): boolean {
  if (state.pos < state.data.length && state.data[state.pos] === char) {
    state.pos++;
    return true;
  }
  return false;
}

function parseValue(state: ParseState): PhpValue | undefined {
  if (state.pos >= state.data.length) return undefined;

  const type = state.data[state.pos];

  switch (type) {
    case 'N': {
      // N;
      state.pos++;
      if (!expect(state, ';')) return undefined;
      return null;
    }

    case 'b': {
      // b:0; or b:1;
      state.pos++;
      if (!expect(state, ':')) return undefined;
      const val = readInt(state);
      if (val === null) return undefined;
      if (!expect(state, ';')) return undefined;
      return val === 1;
    }

    case 'i': {
      // i:123;
      state.pos++;
      if (!expect(state, ':')) return undefined;
      const val = readInt(state);
      if (val === null) return undefined;
      if (!expect(state, ';')) return undefined;
      return val;
    }

    case 'd': {
      // d:1.5;
      state.pos++;
      if (!expect(state, ':')) return undefined;
      const val = readFloat(state);
      if (val === null) return undefined;
      if (!expect(state, ';')) return undefined;
      return val;
    }

    case 's': {
      // s:5:"hello";
      state.pos++;
      if (!expect(state, ':')) return undefined;
      const len = readInt(state);
      if (len === null || len < 0) return undefined;
      if (!expect(state, ':')) return undefined;
      if (!expect(state, '"')) return undefined;
      // Read exactly `len` bytes
      if (state.pos + len > state.data.length) return undefined;
      const str = state.data.slice(state.pos, state.pos + len);
      state.pos += len;
      if (!expect(state, '"')) return undefined;
      if (!expect(state, ';')) return undefined;
      return str;
    }

    case 'a': {
      // a:2:{...}
      state.pos++;
      if (!expect(state, ':')) return undefined;
      const count = readInt(state);
      if (count === null || count < 0) return undefined;
      if (!expect(state, ':')) return undefined;
      if (!expect(state, '{')) return undefined;

      // Determine if associative or sequential
      const entries: Array<[PhpValue, PhpValue]> = [];
      let isSequential = true;

      for (let i = 0; i < count; i++) {
        const key = parseValue(state);
        if (key === undefined) return undefined;
        const value = parseValue(state);
        if (value === undefined) return undefined;
        entries.push([key, value]);
        if (key !== i) isSequential = false;
      }

      if (!expect(state, '}')) return undefined;

      if (isSequential && entries.length > 0) {
        return entries.map(([, v]) => v);
      }

      const obj: Record<string, PhpValue> = {};
      for (const [k, v] of entries) {
        obj[String(k)] = v;
      }
      return obj;
    }

    case 'O': {
      // Object — not supported, skip gracefully
      return undefined;
    }

    default:
      return undefined;
  }
}

/**
 * Unserialize a PHP serialized string.
 * Returns null for objects, malformed input, or any parse error.
 */
export function phpUnserialize(input: string): PhpValue | null {
  if (!input || typeof input !== 'string') return null;

  try {
    const state: ParseState = { data: input, pos: 0 };
    const result = parseValue(state);
    if (result === undefined) return null;
    return result;
  } catch {
    return null;
  }
}
