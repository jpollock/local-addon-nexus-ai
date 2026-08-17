/**
 * WP-18 · Pins on this directory's own layout.
 *
 * Two rules keep the journeys honest, and neither is expressible in code that
 * runs — they are properties of file names and imports. Both have a real
 * failure mode that is SILENT, which is the only reason a layout test earns
 * its place:
 *
 *   1. A journey renamed to `*.test.ts` would be collected by `npm test`,
 *      which would then require a running Local — an environment-dependent
 *      test in the default suite, the thing TESTING_STRATEGY.md forbids by
 *      name.
 *   2. A journey that imported better-sqlite3 (directly, or via the ledger)
 *      would be unrunnable in the state it is designed for: while Local holds
 *      the addon, better-sqlite3 in this tree is built for Electron, and any
 *      such import fails with a NODE_MODULE_VERSION error that reads as a
 *      broken intelligence layer.
 *
 * And one rule about where pins may live: the root jest config ignores any
 * path containing `/lib/`, so a `lib/` directory here would silently collect
 * zero tests. That cost this packet a puzzled minute; it costs the next reader
 * nothing.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = __dirname;
const JOURNEYS = path.join(ROOT, 'journeys');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('journey files stay out of `npm test`', () => {
  const journeyFiles = walk(JOURNEYS);

  it('has journeys to check — an empty directory would make every pin below vacuous', () => {
    expect(journeyFiles.length).toBeGreaterThan(0);
  });

  it('names every journey `*.journey.ts`', () => {
    const wrong = journeyFiles.filter((f) => !f.endsWith('.journey.ts'));
    expect(wrong).toEqual([]);
  });

  it('has no file jest\'s default testMatch would collect', () => {
    const collected = journeyFiles.filter((f) => /\.(test|spec)\.[jt]sx?$/.test(f));
    expect(collected).toEqual([]);
  });

  it('has no `__tests__` directory — the other half of the default testMatch', () => {
    expect(walk(ROOT).filter((f) => f.includes(`${path.sep}__tests__${path.sep}`))).toEqual([]);
  });
});

describe('journeys never open the ledger directly', () => {
  /** Module specifiers that would drag better-sqlite3 into the journey process. */
  const FORBIDDEN = [/better-sqlite3/, /src\/intelligence/, /intelligence-host/];

  /**
   * IMPORTS only, not raw text.
   *
   * The first version of this guard matched the whole file and fired on a
   * COMMENT explaining why better-sqlite3 must not be imported — the same trap
   * the mutation rules call out ("a mutation can land in a comment quoting the
   * code"). A guard that cannot tell the code from the prose about the code is
   * not a guard.
   */
  function moduleSpecifiers(source: string): string[] {
    const out: string[] = [];
    const patterns = [/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm, /require\(\s*['"]([^'"]+)['"]\s*\)/g];
    for (const pattern of patterns) {
      for (let m = pattern.exec(source); m; m = pattern.exec(source)) out.push(m[1]);
    }
    return out;
  }

  it.each(walk(JOURNEYS))('%s imports no native SQLite', (file) => {
    // The journeys run while Local holds the addon, which means this tree's
    // better-sqlite3 is built for Electron. Evidence about the ledger comes
    // from the live MCP surface instead — see the README.
    const specifiers = moduleSpecifiers(fs.readFileSync(file, 'utf-8'));
    for (const specifier of specifiers) {
      for (const forbidden of FORBIDDEN) {
        expect({ file, specifier, forbidden: forbidden.source }).toMatchObject({
          specifier: expect.not.stringMatching(forbidden),
        });
      }
    }
  });

  it('the specifier scan actually finds imports — an empty scan guards nothing', () => {
    const anyJourney = walk(JOURNEYS)[0];
    expect(moduleSpecifiers(fs.readFileSync(anyJourney, 'utf-8')).length).toBeGreaterThan(0);
  });

  it('the specifier scan ignores prose', () => {
    const commentOnly = "// never import better-sqlite3 here\nimport { x } from './safe';\n";
    expect(moduleSpecifiers(commentOnly)).toEqual(['./safe']);
  });

  it('the specifier scan catches a real offender', () => {
    expect(moduleSpecifiers("import Database from 'better-sqlite3';\n")).toEqual(['better-sqlite3']);
  });
});

describe('runner pins are somewhere jest will actually look', () => {
  it('has no `lib` directory — the root config ignores every path containing /lib/', () => {
    const libDirs = fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name === 'lib');
    expect(libDirs).toEqual([]);
  });
});
