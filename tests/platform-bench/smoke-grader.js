#!/usr/bin/env node
/**
 * Grader wiring smoke test: proves promptfoo's llm-rubric assertion actually
 * routes through providers/grader.js and that a right answer passes while a
 * wrong one fails. Two echo cells, two haiku grading calls (~$0.05).
 *
 * Usage:  node tests/platform-bench/smoke-grader.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');
const { PF_VERSION } = require('./providers/isolation');

const RUBRIC = 'PASS only if the text states that Paris is the capital of France. FAIL otherwise.';
const cfg = {
  description: 'grader smoke',
  providers: [{ id: 'echo' }],
  defaultTest: {
    options: { provider: `file://${path.join(__dirname, 'providers', 'grader.js')}` },
  },
  tests: [
    { description: 'right', vars: { prompt: 'The capital of France is Paris.' },
      assert: [{ type: 'llm-rubric', value: RUBRIC }] },
    { description: 'wrong', vars: { prompt: 'The capital of France is Berlin.' },
      assert: [{ type: 'llm-rubric', value: RUBRIC }] },
  ],
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-grader-smoke-'));
const cfgPath = path.join(dir, 'cfg.yaml');
const outPath = path.join(dir, 'out.json');
fs.writeFileSync(cfgPath, yaml.dump(cfg));
try {
  execFileSync('npx', [`promptfoo@${PF_VERSION}`, 'eval', '-c', cfgPath, '--no-cache', '-o', outPath],
    { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
} catch { /* promptfoo exits non-zero when a cell fails — expected: one should */ }

const results = JSON.parse(fs.readFileSync(outPath, 'utf8')).results.results;
const byDesc = (d) => results.find((r) => r.testCase.description === d);
const right = byDesc('right'), wrong = byDesc('wrong');
fs.rmSync(dir, { recursive: true, force: true });

let bad = 0;
if (!right || right.success !== true) { console.log('FAIL: correct answer did not pass', right?.gradingResult?.reason); bad++; }
if (!wrong || wrong.success !== false) { console.log('FAIL: wrong answer did not fail', wrong?.gradingResult?.reason); bad++; }
console.log(bad === 0 ? 'OK: grader wiring works — right passes, wrong fails' : `${bad} smoke case(s) misbehaved`);
process.exit(bad === 0 ? 0 : 1);
