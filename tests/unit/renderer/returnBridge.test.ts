/**
 * WP-46 · THE BRIDGE, AND THE COPY — the two things that are supposed to hold
 * nothing.
 *
 * The IPC bridge's ONE property is thinness. WP-30's contract is designed so the
 * host folds and the surface reads; a transform in the bridge would be a second
 * place the consequence order, a gate's position or a standing approval could be
 * decided, which is precisely the drift the one-fold design removes. "Thin" is
 * not a code-review impression here — it is asserted, by reading the registered
 * handlers out of the real source and pinning their bodies to a pass-through
 * shape.
 *
 * The generated copy module's one property is that it is GENERATED. XD-26
 * ratified exact sentences; a hand-edited copy of them is a second place the
 * ratified wording lives and can drift. The `:check` script fails closed on a
 * stale artifact and this file drives it, which is what makes the tracked file
 * trustworthy rather than merely present (PARALLEL_PROTOCOL, the generated-
 * artifact rule).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';

import { IPC_CHANNELS } from '../../../src/common/constants';
import { allHandlerRegistrations, handlerFor } from './helpers/ipcContracts';
import { RETURN_COPY, RETURN_COPY_SHAPE_VERSION, SEP } from '../../../src/renderer/components/return/returnCopy.generated';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HANDLERS = path.join(REPO_ROOT, 'src', 'main', 'ipc-handlers.ts');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-return-copy.ts');
const GENERATED = path.join(REPO_ROOT, 'src', 'renderer', 'components', 'return', 'returnCopy.generated.ts');
const FIXTURE_JS = path.join(REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'fixtures', 'scenario-return.js');
const SHEET_MD = path.join(REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'from-designer-09-return-arrival.md');

const RETURN_CHANNELS = [
  IPC_CHANNELS.RETURN_TRIAGE,
  IPC_CHANNELS.RETURN_SESSION,
  IPC_CHANNELS.RETURN_CHANGED_SINCE,
  IPC_CHANNELS.RETURN_SNAPSHOT,
];

describe('the IPC bridge — four pass-throughs, and nothing else', () => {
  test('all four channels are registered, exactly once, in ipc-handlers.ts', () => {
    for (const channel of RETURN_CHANNELS) {
      const matches = allHandlerRegistrations().filter((h) => h.channelValue === channel);
      expect({ channel, count: matches.length }).toEqual({ channel, count: 1 });
      expect(matches[0].file).toBe('src/main/ipc-handlers.ts');
    }
  });

  test('the four channel strings are distinct — no channel shadows another', () => {
    expect(new Set(RETURN_CHANNELS).size).toBe(4);
  });

  test('each handler body is a single call onto the registry\'s own method — no derivation', () => {
    const source = fs.readFileSync(HANDLERS, 'utf-8');

    // The exact registered bodies, read out of the source. A handler that grew
    // an `if`, a `.map`, a merge or a cached instance would not match.
    const expected: Array<[string, RegExp]> = [
      ['RETURN_TRIAGE', /safeHandle\(IPC_CHANNELS\.RETURN_TRIAGE, \(\) => createSessionRegistry\(\)\.triage\(\)\);/],
      ['RETURN_SESSION', /safeHandle\(IPC_CHANNELS\.RETURN_SESSION, \(_event: any, id: string\) =>\s*createSessionRegistry\(\)\.session\(String\(id \?\? ''\)\)\);/],
      ['RETURN_CHANGED_SINCE', /safeHandle\(IPC_CHANNELS\.RETURN_CHANGED_SINCE, \(_event: any, cursor\?: string\) =>\s*createSessionRegistry\(\)\.changedSince\(typeof cursor === 'string' \? cursor : undefined\)\);/],
      ['RETURN_SNAPSHOT', /safeHandle\(IPC_CHANNELS\.RETURN_SNAPSHOT, \(\) => createSessionRegistry\(\)\.snapshot\(\)\);/],
    ];
    for (const [name, re] of expected) {
      expect({ name, matched: re.test(source) }).toEqual({ name, matched: true });
    }
  });

  test('the arity of each handler matches the registry method it forwards', () => {
    // `triage()` and `snapshot()` take nothing; `session(id)` and
    // `changedSince(cursor?)` take one. A handler that declared a second
    // parameter would be shaping a call the contract does not have.
    const arity: Record<string, number> = {
      [IPC_CHANNELS.RETURN_TRIAGE]: 0,
      [IPC_CHANNELS.RETURN_SNAPSHOT]: 0,
      [IPC_CHANNELS.RETURN_SESSION]: 1,
      [IPC_CHANNELS.RETURN_CHANGED_SINCE]: 1,
    };
    for (const [channel, expected] of Object.entries(arity)) {
      const handler = handlerFor(channel);
      expect(handler).toBeDefined();
      const inner = (handler as { signature: string }).signature;
      const declared = inner.slice(inner.indexOf('(') + 1, inner.lastIndexOf(')')).trim();
      const count = declared === '' ? 0 : declared.split(',').length - 1; // minus `_event`
      expect({ channel, count }).toEqual({ channel, count: expected });
    }
  });

  test('the bridge is NOT a tool, and has no CLI or GraphQL route', () => {
    // The same boundary GOVERN_SET_GRANT holds, for a different reason: these
    // are reads, but they are reads of a fold that names which production
    // installs are mid-change and which gates a human has not answered. They
    // belong to the surface a person is looking at, not to a tool an agent can
    // call to inventory its operator's attention.
    const dirs = ['mcp', 'agent-runtime', 'chat', 'graphql'].map((d) => path.join(REPO_ROOT, 'src', 'main', d));
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (/RETURN_TRIAGE|RETURN_SESSION|RETURN_CHANGED_SINCE|RETURN_SNAPSHOT/.test(fs.readFileSync(full, 'utf-8'))) {
          hits.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    for (const dir of dirs) if (fs.existsSync(dir)) walk(dir);
    expect(hits).toEqual([]);

    const cliDir = path.join(REPO_ROOT, 'src', 'cli');
    if (fs.existsSync(cliDir)) {
      const cliHits: string[] = [];
      const walkCli = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { walkCli(full); continue; }
          if (!/\.tsx?$/.test(entry.name)) continue;
          if (/nexus-ai:return:/.test(fs.readFileSync(full, 'utf-8'))) cliHits.push(path.relative(REPO_ROOT, full));
        }
      };
      walkCli(cliDir);
      expect(cliHits).toEqual([]);
    }
  });
});

describe('the ratified copy — generated, never retyped', () => {
  test('`fixtures:return-copy:check` passes against the tracked file', () => {
    // The property this buys: a green `:check` is PROOF the committed module is
    // exactly what the designer's two files produce. A spliced or hand-edited
    // copy cannot have that property and cannot be talked into having it.
    const out = execFileSync(
      'npx',
      ['ts-node', GENERATOR, '--check'],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    );
    expect(out).toContain('is up to date');
  });

  test('the generator is deterministic — twice on an unchanged tree, byte-identical', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp46-copy-'));
    try {
      // `--out` rather than the tracked path: a generator run under test must
      // never be able to leave output on the working tree (WP-32's poisoned-
      // fixture rule).
      const a = path.join(dir, 'a.ts');
      const b = path.join(dir, 'b.ts');
      execFileSync('npx', ['ts-node', GENERATOR, '--out', a], { cwd: REPO_ROOT });
      execFileSync('npx', ['ts-node', GENERATOR, '--out', b], { cwd: REPO_ROOT });
      expect(fs.readFileSync(a, 'utf-8')).toBe(fs.readFileSync(b, 'utf-8'));
      expect(fs.readFileSync(a, 'utf-8')).toBe(fs.readFileSync(GENERATED, 'utf-8'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('every ratified string is a VERBATIM substring of a designer file', () => {
    // The copy discipline's own assertion, mechanically: whatever the generator
    // did to split a sentence, each half must still be the designer's bytes.
    const haystack = fs.readFileSync(FIXTURE_JS, 'utf-8') + '\n' + fs.readFileSync(SHEET_MD, 'utf-8');
    // The fixture escapes its curly apostrophes as `’`, so the haystack is
    // normalised the way the interpreter would read it — otherwise a true
    // substring would read as absent.
    const normalised = haystack.replace(/\\u2019/g, '’');

    const misses: string[] = [];
    for (const [key, value] of Object.entries(RETURN_COPY)) {
      const needle = String(value).trim();
      if (needle === '') continue; // AWAY_SUFFIX is legitimately empty
      if (!normalised.includes(needle)) misses.push(`${key}: ${JSON.stringify(needle)}`);
    }
    expect(misses).toEqual([]);
  });

  test('the shape version and the separator are what the surface reads', () => {
    expect(RETURN_COPY_SHAPE_VERSION).toBe(1);
    expect(SEP).toBe(' · ');
  });

  test('the generated module carries its DO-NOT-EDIT header', () => {
    const source = fs.readFileSync(GENERATED, 'utf-8');
    expect(source).toContain('GENERATED — DO NOT EDIT');
    expect(source).toContain('npm run fixtures:return-copy');
  });

  test('the four §6c strings are present and are the ratified ones', () => {
    expect(RETURN_COPY.UNKNOWN_ARM_LEAD).toBe(
      'This session was running a procedure, and the platform can no longer say which',
    );
    expect(RETURN_COPY.UNKNOWN_ARM_DOOR).toBe('Find this run in the record');
    expect(RETURN_COPY.UNKNOWN_ARM_OFFER).toBe('Start a new run from the same selection');
    expect(RETURN_COPY.UNKNOWN_ARM_BODY).toContain('Nothing here is armed now');
  });
});
