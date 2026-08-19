#!/usr/bin/env ts-node
/**
 * WP-39 · The host-seam probe — load everything the sitting's own process
 * loads, under the sitting's own invocation, and exit non-zero if any of it
 * fails to compile or resolve.
 *
 *   npx ts-node --project tsconfig.test.json \
 *     tests/intelligence-evals/hostSeamProbe.ts
 *
 * WHY A CHILD PROCESS AND NOT AN ASSERTION. The failure this exists to catch
 * only happens under ts-node: ts-node type-checks each file as it requires it
 * and does NOT read the tsconfig `include`, so `src/types/electron.d.ts` — the
 * ambient declaration that makes every `electron` import in `src/` resolvable —
 * is out of reach unless something pulls it in. Under jest none of that is
 * true: `electron` is mapped by `moduleNameMapper` and the whole program is
 * type-checked as one. A jest assertion therefore CANNOT observe this class;
 * only really running ts-node can. `hostSeam.test.ts` spawns this file.
 *
 * WHAT IT LOADS, and why in this order:
 *   1. `sitting.ts` FIRST, because that is the entry point whose process shape
 *      is under test and whose own first import is `./hostShim`. Requiring it
 *      first is not a favour to the probe — it IS the sitting's ordering. If
 *      `sitting.ts` ever stops importing the shim, everything after this line
 *      fails, which is the regression.
 *   2. Every other harness module EXCEPT `hostShim.ts` itself, so a host
 *      acquisition anywhere in the harness is reached whether or not a probe
 *      happens to run it — and so the shim only ever arrives the way production
 *      arrives at it, through an entry point that imported it.
 *   3. Every module the harness requires LAZILY into `src/` — discovered by
 *      reading the sources, not by a hand-kept list, so WP-24's lazy edge and
 *      any future one are covered without anyone remembering to add them.
 *
 * `run.ts` is excluded from (2) on purpose: it calls `main()` at module scope,
 * so requiring it would run the whole eval suite and `process.exit`. Its shim
 * import is pinned statically instead — see `hostSeam.test.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';

export const HARNESS_DIR = __dirname;

/**
 * Harness modules safe to require. Three exclusions, each load-bearing:
 *
 *   `*.test.ts`      jest suites, not harness code.
 *   `run.ts`         calls `main()` at module scope — requiring it would run
 *                    the whole eval suite and `process.exit`. Its shim import
 *                    is pinned statically instead (`hostSeam.test.ts`).
 *   `hostShim.ts`    THE SUBTLE ONE, and the battery caught it: requiring the
 *                    shim directly installs it without any entry point having
 *                    asked, which makes this probe blind to the exact
 *                    regression it exists for — an entry point that drops its
 *                    shim import. The shim must arrive the way production
 *                    arrives at it, through `sitting.ts`'s own first import.
 *   this file        it is the probe.
 */
export function harnessModules(dir: string = HARNESS_DIR): string[] {
  const EXCLUDED = new Set(['run.ts', 'hostShim.ts', 'hostSeamProbe.ts']);
  return fs
    .readdirSync(dir)
    .filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && !EXCLUDED.has(f)
    )
    .sort();
}

/**
 * Relative specifiers the harness requires at RUNTIME rather than importing —
 * WP-24's `require('../../src/main/agent-runtime/AgentDispatcher')` is the
 * founding case. A lazy require is invisible to every static reader, which is
 * exactly why it must be read out of the source rather than remembered.
 */
export function lazyHostEdges(dir: string = HARNESS_DIR): string[] {
  const found = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/\brequire\(\s*'(\.\.?\/[^']+)'\s*\)/g)) {
      const resolved = path.resolve(dir, match[1]);
      // Only edges that leave the harness for the product tree matter here.
      if (resolved.includes(`${path.sep}src${path.sep}`)) found.add(resolved);
    }
  }
  return [...found].sort();
}

/**
 * The order the probe loads in: the ENTRY POINT first, everything else after.
 *
 * Load-bearing in one direction only, and it is worth being exact about which.
 * It does not catch anything today — after WP-24 no harness module pulls a host
 * module at module scope, so any order works. It prevents a FALSE POSITIVE
 * tomorrow: the day some harness module acquires a module-scope host import,
 * alphabetical order would load it before the entry point had installed the
 * shim and this probe would fail on a chain the real CLI loads fine. The real
 * CLI's shim always arrives first, so the probe's must too. Pinned structurally
 * in `hostSeam.test.ts` because there is no behaviour to pin it by.
 */
export const ENTRY_POINT = 'sitting.ts';

export function harnessLoadOrder(dir: string = HARNESS_DIR): string[] {
  const modules = harnessModules(dir);
  if (!modules.includes(ENTRY_POINT)) return modules;
  return [ENTRY_POINT, ...modules.filter((m) => m !== ENTRY_POINT)];
}

function main(): number {
  const modules = harnessModules();
  if (!modules.includes(ENTRY_POINT)) {
    process.stderr.write(`host-seam probe: ${ENTRY_POINT} is not in the harness directory\n`);
    return 1;
  }
  const ordered = harnessLoadOrder();

  for (const file of ordered) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(path.join(HARNESS_DIR, file));
  }
  const edges = lazyHostEdges();
  for (const edge of edges) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(edge);
  }

  process.stdout.write(
    `host-seam probe OK — ${ordered.length} harness module(s), ${edges.length} lazy host edge(s)\n`
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
