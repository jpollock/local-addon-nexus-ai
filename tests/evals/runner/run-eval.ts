#!/usr/bin/env ts-node
/**
 * Eval Runner — Nexus AI CLI/MCP Evaluation Framework
 *
 * Prints eval case prompts and capture instructions for the human reviewer.
 * The reviewer pastes each prompt into Claude Code (CLI/Skills mode) or
 * Claude Desktop (MCP mode), runs to completion, and saves the transcript.
 *
 * Usage:
 *   npx ts-node tests/evals/runner/run-eval.ts --mode cli-skills
 *   npx ts-node tests/evals/runner/run-eval.ts --mode mcp
 *   npx ts-node tests/evals/runner/run-eval.ts --mode mcp --case 02-pull-from-wpe
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const CASES_DIR = path.join(__dirname, '..', 'cases');
const RESULTS_DIR = path.join(__dirname, '..', 'results');

interface EvalCase {
  id: string;
  description: string;
  mode: string[];
  prompt?: string;
  conversation?: Array<{ turn: number; prompt: string }>;
  expected: {
    task_completed: boolean;
    key_steps: string[];
    must_not: string[];
  };
  scoring_weights: Record<string, number>;
  notes?: string;
}

function loadCases(filterCase?: string): EvalCase[] {
  const files = fs.readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.yaml'))
    .sort();

  return files
    .map(f => yaml.load(fs.readFileSync(path.join(CASES_DIR, f), 'utf-8')) as EvalCase)
    .filter(c => !filterCase || c.id === filterCase);
}

function printCase(evalCase: EvalCase, mode: string, index: number, total: number): void {
  const line = '═'.repeat(60);
  const thin = '─'.repeat(60);

  console.log('\n' + line);
  console.log(`EVAL ${index}/${total}: ${evalCase.id}`);
  console.log(`${evalCase.description}`);
  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(thin);

  // Print prompt(s)
  if (evalCase.prompt) {
    console.log('\n📋 PROMPT TO PASTE INTO CLAUDE:\n');
    console.log(`"${evalCase.prompt}"`);
  } else if (evalCase.conversation) {
    console.log('\n📋 MULTI-TURN CONVERSATION — run turns in order:\n');
    for (const turn of evalCase.conversation) {
      console.log(`  Turn ${turn.turn}: "${turn.prompt}"`);
    }
  }

  console.log('\n' + thin);
  console.log('✅ EXPECTED STEPS:');
  evalCase.expected.key_steps.forEach(s => console.log(`  • ${s}`));

  console.log('\n❌ MUST NOT:');
  evalCase.expected.must_not.forEach(s => console.log(`  • ${s}`));

  if (evalCase.notes) {
    console.log('\n💡 REVIEWER NOTES:');
    evalCase.notes.trim().split('\n').forEach(l => console.log(`  ${l.trim()}`));
  }

  console.log('\n' + thin);
  console.log('📝 CAPTURE INSTRUCTIONS:');
  console.log('  1. Paste the prompt into Claude');
  console.log('  2. Let it run to completion (do not hint or correct)');
  console.log('  3. Copy the FULL transcript (all tool calls + responses)');
  console.log(`  4. Save to: tests/evals/results/${new Date().toISOString().slice(0,10)}-${mode}/${evalCase.id}-transcript.txt`);
  console.log('  5. Run: npx ts-node tests/evals/runner/score-eval.ts <transcript-file>');
  console.log('\nPress ENTER when ready for next case...');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const caseIdx = args.indexOf('--case');

  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'cli-skills';
  const filterCase = caseIdx >= 0 ? args[caseIdx + 1] : undefined;

  if (!['cli-skills', 'mcp'].includes(mode)) {
    console.error('--mode must be cli-skills or mcp');
    process.exit(1);
  }

  const cases = loadCases(filterCase).filter(c => c.mode.includes(mode));

  if (cases.length === 0) {
    console.error(`No cases found for mode=${mode}${filterCase ? `, case=${filterCase}` : ''}`);
    process.exit(1);
  }

  // Ensure results dir exists
  const today = new Date().toISOString().slice(0, 10);
  const runDir = path.join(RESULTS_DIR, `${today}-${mode}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log('\n' + '═'.repeat(60));
  console.log('NEXUS AI EVAL RUNNER');
  console.log(`Mode: ${mode.toUpperCase()} | Cases: ${cases.length} | Date: ${today}`);
  console.log('═'.repeat(60));

  if (mode === 'cli-skills') {
    console.log('\n⚙️  SETUP FOR CLI/SKILLS MODE:');
    console.log('  1. Open Claude Code in any project directory');
    console.log('  2. Confirm skills are installed: nexus skills list');
    console.log('  3. Confirm nexus CLI works: nexus doctor');
    console.log('  4. Do NOT enable MCP for this mode');
  } else {
    console.log('\n⚙️  SETUP FOR MCP MODE:');
    console.log('  1. Open Claude Desktop or Claude Code with MCP enabled');
    console.log('  2. Confirm Nexus MCP is connected (should show tools)');
    console.log('  3. Do NOT use nexus skills for this mode');
  }

  console.log('\nPress ENTER to start...');
  await new Promise(r => process.stdin.once('data', r));

  for (let i = 0; i < cases.length; i++) {
    printCase(cases[i], mode, i + 1, cases.length);
    if (i < cases.length - 1) {
      await new Promise(r => process.stdin.once('data', r));
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('All cases complete!');
  console.log(`Transcripts should be in: tests/evals/results/${today}-${mode}/`);
  console.log('Score them with: npx ts-node tests/evals/runner/score-eval.ts <transcript>');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
