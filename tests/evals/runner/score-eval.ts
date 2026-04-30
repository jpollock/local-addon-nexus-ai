#!/usr/bin/env ts-node
/**
 * Eval Scorer — generates scorecard from a saved transcript
 *
 * Usage:
 *   npx ts-node tests/evals/runner/score-eval.ts <transcript-file> [--model <model-id>]
 *
 * The scorer:
 * 1. Extracts auto-measurable metrics from the transcript
 * 2. Presents a scoring template for the reviewer to fill in
 * 3. Estimates token cost (Plan 3)
 * 4. Outputs a complete markdown scorecard
 *
 * Example:
 *   npx ts-node tests/evals/runner/score-eval.ts \
 *     tests/evals/results/2026-04-14-cli-skills/02-pull-from-wpe-transcript.txt
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as yaml from 'js-yaml';
import { estimateFromTranscript, formatReport, TokenReport } from './token-counter';

const CASES_DIR = path.join(__dirname, '..', 'cases');

interface EvalCase {
  id: string;
  description: string;
  expected: { task_completed: boolean; key_steps: string[]; must_not: string[] };
  scoring_weights: Record<string, number>;
  notes?: string;
}

function loadCase(caseId: string): EvalCase | null {
  const file = path.join(CASES_DIR, `${caseId}.yaml`);
  if (!fs.existsSync(file)) return null;
  return yaml.load(fs.readFileSync(file, 'utf-8')) as EvalCase;
}

function extractAutoMetrics(content: string): {
  toolCallCount: number;
  errorCount: number;
  retryCount: number;
  mode: 'mcp' | 'cli-skills';
} {
  const lines = content.split('\n');
  let toolCallCount = 0;
  let errorCount = 0;
  let retryCount = 0;

  // Detect mode from transcript content
  const hasBash = content.includes('Bash(nexus') || content.includes('/nexus-');
  const hasMcpTools = content.includes('wpe_') || content.includes('local_') || content.includes('nexus_');
  const mode: 'mcp' | 'cli-skills' = (hasBash && !content.includes('mcp__')) ? 'cli-skills' : 'mcp';

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('⏺ Bash(') || t.startsWith('⏺ Tool(') || t.startsWith('⏺ ')) {
      toolCallCount++;
    }
    if (t.includes('Error:') || t.includes('❌') || t.includes('failed') || t.includes('error code')) {
      errorCount++;
    }
    if (t.includes('retry') || t.includes('Retrying') || t.includes('try again')) {
      retryCount++;
    }
  }

  return { toolCallCount, errorCount, retryCount, mode };
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, (ans) => resolve(ans.replace(/\r$/, ''))));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const transcriptFile = args[0];
  const modelIdx = args.indexOf('--model');
  const model = modelIdx >= 0 ? args[modelIdx + 1] : 'claude-sonnet-4-6';

  // Non-interactive mode: --scores "y,90,85,90" --notes "reviewer notes"
  const scoresIdx = args.indexOf('--scores');
  const notesIdx = args.indexOf('--notes');
  const nonInteractive = scoresIdx >= 0;

  if (!transcriptFile || !fs.existsSync(transcriptFile)) {
    console.error('Usage: score-eval.ts <transcript-file> [--model <model>] [--scores "y,90,85,90"] [--notes "text"]');
    process.exit(1);
  }

  const content = fs.readFileSync(transcriptFile, 'utf-8');
  const fileName = path.basename(transcriptFile, '-transcript.txt');
  const caseId = fileName.replace(/-transcript.*/, '');

  const evalCase = loadCase(caseId);
  const metrics = extractAutoMetrics(content);
  const tokenReport = estimateFromTranscript(transcriptFile, metrics.mode, model);

  const line = '═'.repeat(60);
  const thin = '─'.repeat(60);

  console.log('\n' + line);
  console.log(`SCORING: ${caseId}`);
  console.log(`Mode detected: ${metrics.mode.toUpperCase()}`);
  console.log(line);

  // Auto-extracted metrics
  console.log('\n📊 AUTO-EXTRACTED METRICS:');
  console.log(`  Tool calls:    ${metrics.toolCallCount}`);
  console.log(`  Error events:  ${metrics.errorCount}`);
  console.log(`  Retries:       ${metrics.retryCount}`);
  console.log('\n💰 TOKEN ESTIMATE (Plan 3):');
  console.log(formatReport(tokenReport).split('\n').map(l => `  ${l}`).join('\n'));

  // Human scoring
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n' + thin);
  console.log('📋 HUMAN SCORING (enter 0-100 for each, or press Enter for N/A):');
  console.log(thin);

  if (evalCase) {
    console.log('\nExpected steps to check:');
    evalCase.expected.key_steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    console.log('\nMust NOT have done:');
    evalCase.expected.must_not.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }

  const weights = evalCase?.scoring_weights ?? { task_completed: 40, steps_correct: 30, completeness: 20, output_clarity: 10 };

  // task_completed is always y/n — all other dimensions are 0-100 scored by the reviewer
  const dynamicDimensions = Object.keys(weights).filter(k => k !== 'task_completed');

  let taskCompleted: string;
  const dimensionScores: Record<string, number> = {};
  let reviewerNotes: string;

  if (nonInteractive) {
    const scoresParts = (args[scoresIdx + 1] || 'y,80,80,80').split(',');
    taskCompleted = scoresParts[0] || 'y';
    dynamicDimensions.forEach((dim, i) => {
      dimensionScores[dim] = parseInt(scoresParts[i + 1]) || 80;
    });
    reviewerNotes = notesIdx >= 0 ? args[notesIdx + 1] : '_Non-interactive run_';
    rl.close();
  } else {
    console.log('');
    taskCompleted = await prompt(rl, 'Did the task complete successfully? (y/n): ');
    for (const dim of dynamicDimensions) {
      const label = dim.replace(/_/g, ' ');
      const weight = weights[dim];
      dimensionScores[dim] = parseInt(await prompt(rl, `${label} (0-100, weight ${weight}%): `)) || 0;
    }
    reviewerNotes = await prompt(rl, 'Reviewer notes (what worked, what broke, surprises): ');
    rl.close();
  }

  const taskScore = taskCompleted.toLowerCase() === 'y' ? 100 : 0;
  const weightedScore =
    (taskScore * (weights.task_completed || 40) / 100) +
    dynamicDimensions.reduce((sum, dim) => sum + (dimensionScores[dim] * (weights[dim] || 0) / 100), 0);

  // Build markdown scorecard
  const date = new Date().toISOString().slice(0, 10);
  const scorecard = [
    `# Eval Scorecard: ${caseId}`,
    '',
    `**Date:** ${date}  `,
    `**Mode:** ${metrics.mode}  `,
    `**Model:** ${model}  `,
    `**Weighted Score:** ${weightedScore.toFixed(1)}/100`,
    '',
    '## Auto-Extracted Metrics',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tool calls | ${metrics.toolCallCount} |`,
    `| Error events | ${metrics.errorCount} |`,
    `| Retries | ${metrics.retryCount} |`,
    '',
    '## Token Cost Estimate (Plan 3)',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Input tokens | ${tokenReport.inputTokens.toLocaleString()} |`,
    `| Output tokens | ${tokenReport.outputTokens.toLocaleString()} |`,
    `| Total tokens | ${tokenReport.totalTokens.toLocaleString()} |`,
    `| Estimated cost | $${tokenReport.costUsd.toFixed(4)} |`,
    '',
    '### Token Breakdown',
    '',
    `| Component | Tokens |`,
    `|-----------|--------|`,
    ...tokenReport.breakdown.map(b => `| ${b.label} | ${b.tokens.toLocaleString()} |`),
    '',
    '## Human Scores',
    '',
    `| Dimension | Score | Weight |`,
    `|-----------|-------|--------|`,
    `| Task completed | ${taskScore} | ${weights.task_completed}% |`,
    ...dynamicDimensions.map(dim =>
      `| ${dim.replace(/_/g, ' ')} | ${dimensionScores[dim]} | ${weights[dim]}% |`
    ),
    `| **Weighted total** | **${weightedScore.toFixed(1)}** | |`,
    '',
    '## Reviewer Notes',
    '',
    reviewerNotes || '_No notes provided_',
    '',
    '## Transcript',
    '',
    '```',
    content.substring(0, 2000) + (content.length > 2000 ? '\n... [truncated]' : ''),
    '```',
  ].join('\n');

  // Save scorecard
  const scorecardFile = transcriptFile.replace('-transcript.txt', '-scorecard.md');
  fs.writeFileSync(scorecardFile, scorecard);

  console.log('\n' + line);
  console.log(`✅ Scorecard saved: ${scorecardFile}`);
  console.log(`   Weighted score: ${weightedScore.toFixed(1)}/100`);
  console.log(`   Estimated cost: $${tokenReport.costUsd.toFixed(4)}`);
  console.log(line + '\n');
}

main().catch(console.error);
