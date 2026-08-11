/**
 * The main process half of an IPC contract, read out of the real source.
 *
 * A renderer test that mocks `invoke` verifies only that the renderer sends
 * what the renderer thinks it should send. A main-process test that calls a
 * handler directly verifies only that the handler accepts what the handler
 * thinks it will get. Both halves passed on this branch while three contracts
 * were wrong and a fourth channel had no handler at all.
 *
 * This module supplies the missing half without booting Electron: it indexes
 * every `safeHandle(...)` / `ipcMain.handle(...)` registration under
 * `src/main`, resolves the channel to its real string, and hands back the
 * verbatim parameter list the handler declares. A contract table can then be
 * pinned to that text, so it cannot silently drift from the code it describes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../../../src/common/constants';

const MAIN_DIR = path.join(__dirname, '../../../../src/main');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

export interface HandlerRegistration {
  /** The IPC_CHANNELS key, when the channel was referenced through the enum. */
  channelName: string | null;
  /** The resolved channel string — what `invoke()` is actually called with. */
  channelValue: string;
  /** Path relative to the repo root. */
  file: string;
  /**
   * Verbatim text between the channel argument and the handler body's `=>`,
   * i.e. `async (_event: any, params: { installName: string; args: string[] })`.
   * This is the declared parameter shape a call site must satisfy.
   */
  signature: string;
}

// `safeHandle(CH, async (_event, x) => {` / `ipcMain.handle(CH, (…) => {`,
// across line breaks. The lazy `[\s\S]{0,400}?` up to the first `=>` captures
// the parameter list and nothing else.
const REGISTRATION =
  /(?:safeHandle|ipcMain\.handle)\(\s*(?:IPC_CHANNELS\.([A-Z0-9_]+)|['"`]([^'"`]+)['"`])\s*,\s*([\s\S]{0,400}?)=>/g;

let cache: HandlerRegistration[] | null = null;

export function allHandlerRegistrations(): HandlerRegistration[] {
  if (cache) return cache;
  const found: HandlerRegistration[] = [];
  for (const file of walk(MAIN_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(REGISTRATION)) {
      const channelName = m[1] ?? null;
      const value = channelName
        ? (IPC_CHANNELS as Record<string, string>)[channelName]
        : m[2];
      if (!value) continue;
      found.push({
        channelName,
        channelValue: value,
        file: path.relative(path.join(__dirname, '../../../..'), file),
        signature: m[3].trim(),
      });
    }
  }
  cache = found;
  return found;
}

export function handlerFor(channelValue: string): HandlerRegistration | undefined {
  return allHandlerRegistrations().find((h) => h.channelValue === channelValue);
}

export function handlerExistsFor(channelValue: string): boolean {
  return handlerFor(channelValue) !== undefined;
}

/**
 * How many positional arguments the handler reads AFTER the `_event` one
 * Electron always supplies. `() => {}` is 0; `(_event, x) => {}` is 1.
 *
 * Returns null when the signature could not be parsed — the caller should
 * treat that as a test failure, not as "no arguments".
 */
export function declaredArity(signature: string): number | null {
  const open = signature.indexOf('(');
  if (open === -1) {
    // `safeHandle(CH, () => …)` with no parens is impossible; a bare
    // identifier handler (`safeHandle(CH, someFn)`) has no `=>` and so is
    // never captured. Anything else is unparsed.
    return null;
  }
  // Balanced scan to the matching close paren, so an inline object type
  // containing commas or nested parens does not confuse the split.
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i++) {
    const c = signature[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close === -1) return null;
  const inner = signature.slice(open + 1, close).trim();
  if (inner === '') return 0;

  // Split on top-level commas only, then drop empty segments — a trailing
  // comma before the close paren is legal TypeScript and would otherwise
  // inflate the count by one.
  let d = 0;
  const segments: string[] = [];
  let current = '';
  for (const c of inner) {
    if (c === '(' || c === '{' || c === '[' || c === '<') d++;
    else if (c === ')' || c === '}' || c === ']' || c === '>') d--;
    if (c === ',' && d === 0) { segments.push(current); current = ''; }
    else current += c;
  }
  segments.push(current);
  const params = segments.filter((s) => s.trim() !== '').length;

  // Subtract the leading `_event` parameter Electron injects.
  return Math.max(0, params - 1);
}
