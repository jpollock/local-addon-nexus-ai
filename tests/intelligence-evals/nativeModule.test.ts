/**
 * WP-13c follow-up 2 (pre-approved) · pins for the shared ABI preflight.
 *
 * These three behavioural tests moved here verbatim from `sitting.test.ts` when
 * the helper was lifted out of `sitting.ts`: it is not the sitting harness's
 * property, it is every system-Node CLI in this tree's property. The fourth
 * test is the reason the lift happened at all — `run.ts` used to inherit the
 * bare `NODE_MODULE_VERSION` stack trace.
 */
import * as fs from 'fs';
import * as path from 'path';
import { nativeModuleRemedy } from './nativeModule';

describe('native-module preflight', () => {
  test('a loadable binding produces no remedy', () => {
    expect(nativeModuleRemedy(() => ({}))).toBeNull();
  });

  test('an ABI mismatch names npm run pretest, not a bare stack trace', () => {
    const remedy = nativeModuleRemedy(() => {
      throw new Error(
        'The module was compiled against a different Node.js version using ' +
          'NODE_MODULE_VERSION 146. This version of Node.js requires NODE_MODULE_VERSION 141.'
      );
    });
    expect(remedy).toContain('npm run pretest');
    expect(remedy).toContain('npm run rebuild');
    expect(remedy).toContain('WRONG Node ABI');
    // The original message survives — the reader needs the numbers.
    expect(remedy).toContain('NODE_MODULE_VERSION 146');
  });

  test('a non-ABI load failure is still surfaced with the remedy rather than swallowed', () => {
    const remedy = nativeModuleRemedy(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    expect(remedy).toContain('could not be loaded');
    expect(remedy).toContain('ENOENT');
    expect(remedy).not.toContain('WRONG Node ABI');
  });

  /**
   * SOURCE-LEVEL pin, and labelled as one. `run.ts` calls `main()` at module
   * scope, so importing it from jest would execute the whole eval suite; there
   * is no way to observe its preflight behaviourally without restructuring how
   * it runs, which is a separate change. What CAN be pinned cheaply is the one
   * property that makes the preflight worth anything: it has to run BEFORE the
   * first thing that touches the native module, or the crash it explains has
   * already happened.
   */
  test('run.ts consults the remedy before it reaches the ledger (source-level pin)', () => {
    const source = fs.readFileSync(path.join(__dirname, 'run.ts'), 'utf-8');
    expect(source).toContain("from './nativeModule'");

    const preflight = source.indexOf('nativeModuleRemedy()');
    expect(preflight).toBeGreaterThan(-1);
    // Both entry paths build a fixture (`--seed-dir`) or run the evals, and
    // both open a real SQLite ledger.
    for (const afterwards of ['createEvalFixture(', 'runEvals(']) {
      expect(source.indexOf(afterwards)).toBeGreaterThan(preflight);
    }
  });
});
