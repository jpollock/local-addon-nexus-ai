/**
 * WP-39 · The guard that ends the harness/host-seam rot class.
 *
 * THE CLASS, stated once. The eval harness runs under ts-node as a plain-Node
 * CLI. `src/` is full of modules that legitimately import `electron` and the
 * Local host packages — `KeyVault`, `index.ts`, `token-manager`,
 * `CredentialTokenVault`, `OAuthFlowRunner`, `ipc-handlers` — and the harness
 * reaches them BY DESIGN: `probeGatewayEmission` builds a real
 * `AgentDispatcher` precisely so the contributed-tool emission it measures is
 * the production one. So "nothing on the harness's graph may touch electron"
 * is not the invariant; it is unachievable, and stating it that way is how the
 * class keeps coming back. The invariant is:
 *
 *   every ts-node entry point in the harness installs `hostShim` before it
 *   loads anything, and the whole graph it then loads compiles and resolves.
 *
 * WHY IT KEEPS RECURRING. ts-node type-checks each file as it requires it and
 * does NOT read the tsconfig `include`, so `src/types/electron.d.ts` never
 * loads on its own; and jest maps `electron` through `moduleNameMapper` and
 * type-checks the program as a whole, so under jest EVERY form of this defect
 * is invisible. That is why the second pin below spawns a real ts-node child
 * instead of asserting in-process: an in-process assertion cannot see the
 * thing it is guarding.
 *
 * THREE OCCURRENCES, so the shape is on the record:
 *   WP-20e  `probes.ts` imported `AgentDispatcher` at module scope — the CLI
 *           died at load. Fixed by a stub require-hook plus
 *           `TS_NODE_TRANSPILE_ONLY=1` (both since deleted).
 *   WP-24   the same, fixed properly: the import became lazy, so the CLI loads
 *           with no electron on its chain. Verified at `--help` and at "no API
 *           key" — both of which exit BEFORE the sheet phase.
 *   WP-39   the sheet phase, which WP-24's verification never reached, loads
 *           the host chain anyway (see above) and `sitting.ts` had no shim.
 *           A judgment sheet degraded mid-sitting: criteria printed, judging
 *           instructions blank.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ENTRY_POINT, harnessLoadOrder, harnessModules, lazyHostEdges } from './hostSeamProbe';

const HARNESS_DIR = __dirname;
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..');

/**
 * The probe is itself a ts-node CLI and deliberately does NOT import the shim:
 * it requires `sitting.ts` first and inherits whatever that entry point
 * installs, which is the only way it can observe `sitting.ts` losing its shim.
 * A shim import here would mask exactly the regression the probe exists for.
 */
const EXEMPT_FROM_SHIM = new Set(['hostSeamProbe.ts']);

function cliEntryPoints(): string[] {
  return fs
    .readdirSync(HARNESS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => fs.readFileSync(path.join(HARNESS_DIR, f), 'utf8').startsWith('#!'))
    .sort();
}

function firstImportLine(file: string): string | undefined {
  return fs
    .readFileSync(path.join(HARNESS_DIR, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('import ') || l.startsWith('import('));
}

describe('WP-39 · the harness/host seam', () => {
  it('finds the CLI entry points it claims to guard', () => {
    // A guard whose subject list is empty passes for the wrong reason. Both
    // known CLIs must be found, by shebang, without being named here first.
    const entries = cliEntryPoints();
    expect(entries).toContain('run.ts');
    expect(entries).toContain('sitting.ts');
    expect(entries.length).toBeGreaterThanOrEqual(3); // + the probe
  });

  it.each(cliEntryPoints().filter((f) => !EXEMPT_FROM_SHIM.has(f)))(
    '%s installs hostShim as its first import',
    (file) => {
      expect(firstImportLine(file)).toBe("import './hostShim';");
    }
  );

  it('loads the entry point before anything else, and never the shim directly', () => {
    // Structural, because there is nothing behavioural to pin it by: after WP-24
    // no harness module pulls a host module at module scope, so every load order
    // currently works. Both halves guard the probe's own honesty rather than the
    // product — the first against a false POSITIVE the day some harness module
    // acquires a module-scope host import, the second against a false NEGATIVE,
    // which the WP-39 battery actually caught: requiring `hostShim.ts` in the
    // sweep installed the shim with no entry point having asked, and the probe
    // then survived `sitting.ts` losing its shim import entirely.
    expect(harnessLoadOrder()[0]).toBe(ENTRY_POINT);
    expect(harnessModules()).not.toContain('hostShim.ts');
    expect(harnessModules()).not.toContain('run.ts');
  });

  it('reads the lazy host edges out of the source rather than a kept list', () => {
    // WP-24's `require('../../src/main/agent-runtime/AgentDispatcher')` is the
    // founding case, and the probe must actually be finding it — otherwise the
    // deepest edge on the chain is silently unloaded and the child exits 0
    // having proved nothing.
    const edges = lazyHostEdges();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.endsWith(path.join('agent-runtime', 'AgentDispatcher')))).toBe(true);
  });

  it('loads the whole harness graph under a real ts-node, with no host module unresolved', () => {
    const tsNode = path.join(REPO_ROOT, 'node_modules', '.bin', 'ts-node');
    let output: string;
    try {
      output = execFileSync(
        tsNode,
        ['--project', 'tsconfig.test.json', 'tests/intelligence-evals/hostSeamProbe.ts'],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        'The eval harness no longer loads under ts-node — a judgment sheet would degrade mid-sitting.\n' +
          'This is the WP-20e/WP-24/WP-39 class. Read the header of this file, then:\n' +
          '  · TS2307 "Cannot find module \'electron\'" → an entry point lost its hostShim import,\n' +
          "    or hostShim lost its /// <reference path=\"../../src/types/electron.d.ts\" />.\n" +
          '  · TS2305 "no exported member" → a module in src/ now uses an electron surface that\n' +
          '    src/types/electron.d.ts does not declare. Declare it there.\n' +
          '  · MODULE_NOT_FOUND on a @getflywheel package → add it to hostShim\'s ALIASES.\n' +
          'Do NOT fix this with TS_NODE_TRANSPILE_ONLY or a tsconfig exclusion: both would\n' +
          'switch off the type checking that caught it.\n\n' +
          `--- child stdout ---\n${e.stdout ?? ''}\n--- child stderr ---\n${e.stderr ?? ''}`
      );
    }

    // Anchored, not a substring: "OK" alone is satisfied by a line that says
    // the probe is NOT ok (WP-32's rule), and the counts must be non-zero or
    // the child proved nothing by loading nothing.
    const line = output.trim().split('\n').pop() ?? '';
    const match = /^host-seam probe OK — (\d+) harness module\(s\), (\d+) lazy host edge\(s\)$/.exec(
      line
    );
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(harnessModules().length);
    expect(Number(match?.[2])).toBe(lazyHostEdges().length);
    expect(Number(match?.[1])).toBeGreaterThan(0);
    expect(Number(match?.[2])).toBeGreaterThan(0);
  }, 180_000);
});
