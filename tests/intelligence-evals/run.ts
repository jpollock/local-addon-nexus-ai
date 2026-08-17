#!/usr/bin/env ts-node
/**
 * WP-13 · CLI entry for the anchor-slice eval runner.
 *
 *   npx ts-node tests/intelligence-evals/run.ts
 *   npx ts-node tests/intelligence-evals/run.ts --only E-02-emission-on-completion
 *   npx ts-node tests/intelligence-evals/run.ts --json > report.json
 *   npx ts-node tests/intelligence-evals/run.ts --seed-dir /tmp/wp13-fixture
 *
 * `--seed-dir` materialises the fixture ledger and LEAVES IT ON DISK, which is
 * what makes the OWNER-PENDING instructions actionable rather than
 * aspirational: the owner points a development build at that dataDir and runs
 * the printed prompt against a fleet whose history is already planted.
 *
 * EXIT CODES — chosen so CI cannot mistake an absence for a pass:
 *   0  no FAIL and no BLOCKED and no SPEC-DEFECT (everything either passed or
 *      is legitimately awaiting the owner's judgement)
 *   1  at least one FAIL — something is broken
 *   2  at least one BLOCKED or SPEC-DEFECT — nothing is broken, but the run
 *      could not answer the question. A distinct code because "we could not
 *      check" and "it failed" call for different responses.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createEvalFixture } from './fixture';
import { nativeModuleRemedy } from './nativeModule';
import { runEvals } from './runner';
import { renderReport } from './report';
import { tally } from './types';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  // Every path below opens a real SQLite ledger. Without this, a tree left in
  // the Electron ABI state fails deep inside `initIntelligenceCore` with a raw
  // NODE_MODULE_VERSION stack trace naming a number the reader has no reason to
  // connect to `npm run pretest` (WP-13c follow-up; the helper is shared with
  // the sitting harness rather than copied).
  const abi = nativeModuleRemedy();
  if (abi) {
    process.stderr.write(`${abi}\n`);
    return 2;
  }

  const seedDir = valueOf('--seed-dir');
  if (seedDir) {
    const fixture = await createEvalFixture();
    const target = path.resolve(seedDir);
    fs.mkdirSync(target, { recursive: true });
    // Close first: WAL contents must be checkpointed into the db file before
    // it is copied, or the copy is missing the most recent events.
    fixture.core.close();
    for (const file of fs.readdirSync(fixture.dir)) {
      fs.copyFileSync(path.join(fixture.dir, file), path.join(target, file));
    }
    fs.rmSync(fixture.dir, { recursive: true, force: true });
    process.stdout.write(
      [
        `Seeded fixture ledger at ${target}`,
        `  fleet: ${fixture.fleet.length} sites (${fixture.fleet.filter((s) => s.halted).length} halted, ` +
          `${fixture.fleet.filter((s) => s.gatewayX).length} on payment gateway X)`,
        `  synthetic topics (no producer emits these): ${fixture.syntheticTopics.join(', ') || 'none'}`,
        '',
        'Point a development build of Local at this dataDir. Never seed over a real ledger.',
        '',
      ].join('\n')
    );
    return 0;
  }

  const report = await runEvals({ only: valueOf('--only') });

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderReport(report));
  }

  const counts = tally(report);
  const specDefects = report.specs.flatMap((s) => s.findings.filter((f) => f.kind === 'SPEC-DEFECT'));
  if (counts.FAIL > 0) return 1;
  if (counts.BLOCKED > 0 || specDefects.length > 0) return 2;
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`eval runner crashed: ${(err as Error).stack}\n`);
    process.exit(1);
  }
);
