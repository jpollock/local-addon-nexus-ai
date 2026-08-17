/**
 * WP-19 · Host-module shim for the ts-node CLI.
 *
 * The eval runner drives REAL production seams, and one of them —
 * `AgentDispatcher` (audit chokepoint two, where contributed-tool emission
 * lives) — reaches `ipc-handlers.ts`, which imports `electron`. Under jest
 * that import is mapped to `tests/__mocks__/electron.ts`; under ts-node
 * nothing maps it, and the require fails before a single check runs.
 *
 * So the CLI applies the SAME mapping jest uses, through the module resolver
 * rather than a config file. Deliberately the same stub file, not a second
 * one: two divergent electron fakes is how a suite and its CLI start
 * disagreeing about what production does.
 *
 * IMPORT THIS FIRST in `run.ts` — before anything that transitively pulls a
 * host module in. ES import evaluation follows declaration order, so first
 * line means first executed.
 */
/// <reference path="../../src/types/electron.d.ts" />
// The reference is load-bearing under ts-node: `src/types/electron.d.ts`
// declares the `electron` module ambiently and reaches tsc through the
// tsconfig's `include`, which ts-node does not read (files: false). Without it
// the CLI dies on a TYPE error in a host module it only ever loads at runtime.
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};

const ALIASES: Record<string, string> = {
  electron: path.join(__dirname, '..', '__mocks__', 'electron.ts'),
  '@getflywheel/local/main': path.join(__dirname, '..', '__mocks__', 'local-main.ts'),
  '@getflywheel/local-components': path.join(__dirname, '..', '__mocks__', 'local-components.ts'),
};

/**
 * The stubs are written for jest and call `jest.fn()`. Rather than fork them —
 * two divergent electron fakes is how a suite and its CLI start disagreeing
 * about production — the CLI supplies the ONE jest API they use. `fn(impl)`
 * returns the implementation itself, which is all a runtime caller needs;
 * nothing here records calls, because nothing here asserts on them.
 */
const globals = globalThis as { jest?: { fn: (impl?: unknown) => unknown } };
if (!globals.jest) {
  globals.jest = { fn: (impl?: unknown) => impl ?? (() => undefined) };
}

const original = Module._resolveFilename;
Module._resolveFilename = function patched(request: string, ...rest: unknown[]): string {
  const alias = ALIASES[request];
  return alias ? alias : original.call(this, request, ...rest);
};
