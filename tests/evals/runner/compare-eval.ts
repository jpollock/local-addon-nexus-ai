#!/usr/bin/env ts-node
/**
 * Side-by-side eval scorer — CLI/Skills vs MCP for one case.
 *
 * Shows both transcripts, expected criteria, and key stats together.
 * Scores both modes in one session. Appends a comparison row to
 * tests/evals/results/comparison-table.md.
 *
 * Usage:
 *   npx ts-node tests/evals/runner/compare-eval.ts --case 02-fleet-version-drift
 *   npx ts-node tests/evals/runner/compare-eval.ts --case 02-fleet-version-drift --date 2026-04-15
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import * as readline from 'readline';

const CASES_DIR   = path.join(__dirname, '..', 'cases');
const RESULTS_DIR = path.join(__dirname, '..', 'results');
const TABLE_FILE  = path.join(RESULTS_DIR, 'comparison-table.md');
const IMPROVE_FILE = path.join(RESULTS_DIR, 'improvements.md');

interface EvalCase {
  id: string;
  description: string;
  expected: { task_completed: boolean; key_steps: string[]; must_not: string[] };
  scoring_weights: Record<string, number>;
  notes?: string;
}

interface RunStats {
  cost: number;
  toolCalls: number;
  durationS: number;
  hasResult: boolean;
  resultPreview: string;
}

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise(r => rl.question(q, (ans) => r(ans.replace(/\r$/, ''))));
}

function findResultDir(date: string, mode: string): string | null {
  const exact = path.join(RESULTS_DIR, `${date}-${mode}`);
  if (fs.existsSync(exact)) return exact;
  // Find most recent
  const dirs = fs.readdirSync(RESULTS_DIR)
    .filter(d => d.endsWith(`-${mode}`) && fs.statSync(path.join(RESULTS_DIR, d)).isDirectory())
    .sort().reverse();
  return dirs.length ? path.join(RESULTS_DIR, dirs[0]) : null;
}

function parseStats(transcriptPath: string): RunStats {
  if (!fs.existsSync(transcriptPath)) {
    return { cost: 0, toolCalls: 0, durationS: 0, hasResult: false, resultPreview: '[not found]' };
  }
  const txt = fs.readFileSync(transcriptPath, 'utf-8');
  const costMatch   = txt.match(/Cost:\s+\$?([\d.]+)/);
  const callsMatch  = txt.match(/Tool calls:\s+(\d+)/);
  const durMatch    = txt.match(/Duration:\s+([\d.]+)s/);
  const resultMatch = txt.match(/--- FINAL RESULT ---\n([\s\S]{1,400})/);

  return {
    cost:          parseFloat(costMatch?.[1]   ?? '0'),
    toolCalls:     parseInt(callsMatch?.[1]   ?? '0'),
    durationS:     parseFloat(durMatch?.[1]    ?? '0'),
    hasResult:     !!resultMatch,
    resultPreview: (resultMatch?.[1] ?? '[no result]').trim().slice(0, 400),
  };
}

function scorecard(
  evalCase: EvalCase,
  mode: string,
  stats: RunStats,
  scores: { task: number; steps: number; friction: number; clarity: number },
  notes: string,
  runDir: string,
): string {
  const w = evalCase.scoring_weights;
  const weighted =
    scores.task    * (w.task_completed  || 40) / 100 +
    scores.steps   * (w.steps_correct   || 30) / 100 +
    scores.friction * (w.friction_count || 20) / 100 +
    scores.clarity * (w.output_clarity  || 10) / 100;

  return [
    `# Eval Scorecard: ${evalCase.id}`,
    '',
    `**Date:** ${new Date().toISOString().slice(0,10)}  `,
    `**Mode:** ${mode}  `,
    `**Weighted Score:** ${weighted.toFixed(1)}/100`,
    '',
    '## Cost & Efficiency',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tool calls | ${stats.toolCalls} |`,
    `| Duration | ${stats.durationS.toFixed(0)}s |`,
    `| Cost | $${stats.cost.toFixed(4)} |`,
    `| Got a result | ${stats.hasResult ? 'yes' : 'no'} |`,
    '',
    '## Scores',
    '',
    `| Dimension | Score | Weight |`,
    `|-----------|-------|--------|`,
    `| Task completed | ${scores.task} | ${w.task_completed||40}% |`,
    `| Steps correct | ${scores.steps} | ${w.steps_correct||30}% |`,
    `| Friction (100=zero) | ${scores.friction} | ${w.friction_count||20}% |`,
    `| Output clarity | ${scores.clarity} | ${w.output_clarity||10}% |`,
    `| **Weighted total** | **${weighted.toFixed(1)}** | |`,
    '',
    '## Reviewer Notes',
    '',
    notes || '_No notes_',
    '',
    '## Result Preview',
    '',
    '```',
    stats.resultPreview,
    '```',
  ].join('\n');
}

function appendComparisonRow(
  caseId: string,
  cli: { stats: RunStats; score: number },
  mcp: { stats: RunStats; score: number },
  date: string,
): void {
  const costWinner = cli.stats.cost < mcp.stats.cost ? 'CLI' : mcp.stats.cost < cli.stats.cost ? 'MCP' : 'tie';
  const qualWinner = cli.score > mcp.score ? 'CLI' : mcp.score > cli.score ? 'MCP' : 'tie';

  const row = `| ${date} | ${caseId.replace(/-/g, ' ')} | $${cli.stats.cost.toFixed(3)} | ${cli.stats.toolCalls} | ${cli.score.toFixed(0)} | $${mcp.stats.cost.toFixed(3)} | ${mcp.stats.toolCalls} | ${mcp.score.toFixed(0)} | ${costWinner} | ${qualWinner} |`;

  if (!fs.existsSync(TABLE_FILE)) {
    fs.writeFileSync(TABLE_FILE, [
      '# CLI/Skills vs MCP Comparison Table',
      '',
      '| Date | Case | CLI Cost | CLI Calls | CLI Score | MCP Cost | MCP Calls | MCP Score | Cost Winner | Quality Winner |',
      '|------|------|----------|-----------|-----------|----------|-----------|-----------|-------------|----------------|',
    ].join('\n') + '\n');
  }
  fs.appendFileSync(TABLE_FILE, row + '\n');
}

function appendImprovementIdeas(
  caseId: string,
  cliScore: number,
  mcpScore: number,
  cliStats: RunStats,
  mcpStats: RunStats,
  cliNotes: string,
  mcpNotes: string,
): void {
  const ideas: string[] = [];
  const date = new Date().toISOString().slice(0, 10);

  if (cliStats.toolCalls > mcpStats.toolCalls * 3) {
    ideas.push(`**CLI inefficiency**: ${cliStats.toolCalls} calls vs MCP's ${mcpStats.toolCalls} — skill routing may be using per-site commands instead of fleet aggregation`);
  }
  if (mcpStats.toolCalls > cliStats.toolCalls * 3) {
    ideas.push(`**MCP over-fetching**: ${mcpStats.toolCalls} calls vs CLI's ${cliStats.toolCalls} — MCP tool selection may be too granular`);
  }
  if (!cliStats.hasResult) {
    ideas.push(`**CLI failed to complete** — check transcript for timeout or error pattern`);
  }
  if (!mcpStats.hasResult) {
    ideas.push(`**MCP failed to complete** — check transcript for timeout or error pattern`);
  }
  if (cliScore < 60) {
    ideas.push(`**CLI quality low (${cliScore}/100)**: ${cliNotes}`);
  }
  if (mcpScore < 60) {
    ideas.push(`**MCP quality low (${mcpScore}/100)**: ${mcpNotes}`);
  }
  if (Math.abs(cliScore - mcpScore) > 20) {
    const winner = cliScore > mcpScore ? 'CLI' : 'MCP';
    const loser = winner === 'CLI' ? 'MCP' : 'CLI';
    ideas.push(`**${winner} significantly better quality** (+${Math.abs(cliScore-mcpScore).toFixed(0)} pts) — investigate why ${loser} struggles with this task type`);
  }

  if (ideas.length === 0) return;

  const section = [
    '',
    `## ${date} — ${caseId}`,
    '',
    ...ideas.map(i => `- ${i}`),
  ].join('\n');

  if (!fs.existsSync(IMPROVE_FILE)) {
    fs.writeFileSync(IMPROVE_FILE, [
      '# Improvement Ideas & Findings',
      '',
      'Auto-generated from eval scoring. Add manual findings below.',
      '',
      '---',
    ].join('\n'));
  }
  fs.appendFileSync(IMPROVE_FILE, section + '\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const caseIdx  = args.indexOf('--case');
  const dateIdx  = args.indexOf('--date');
  const modelIdx = args.indexOf('--model');

  const caseId = caseIdx >= 0 ? args[caseIdx + 1] : undefined;
  const date   = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);
  const model  = modelIdx >= 0 ? args[modelIdx + 1] : 'claude-sonnet-4-6';

  if (!caseId) {
    // List available cases
    const cases = fs.readdirSync(CASES_DIR).filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml',''));
    console.log('\nAvailable cases:\n' + cases.map(c => `  ${c}`).join('\n'));
    console.log('\nUsage: compare-eval.ts --case <case-id>\n');
    process.exit(0);
  }

  const casePath = path.join(CASES_DIR, `${caseId}.yaml`);
  if (!fs.existsSync(casePath)) {
    console.error(`Case not found: ${caseId}`);
    process.exit(1);
  }
  const evalCase = yaml.load(fs.readFileSync(casePath, 'utf-8')) as EvalCase;

  const cliDir = findResultDir(date, 'cli-skills');
  const mcpDir = findResultDir(date, 'mcp');
  const cliTranscript = cliDir ? path.join(cliDir, `${caseId}-transcript.txt`) : '';
  const mcpTranscript = mcpDir ? path.join(mcpDir, `${caseId}-transcript.txt`) : '';

  const cliStats = parseStats(cliTranscript);
  const mcpStats = parseStats(mcpTranscript);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const line = '═'.repeat(70);
  const thin = '─'.repeat(70);

  console.log('\n' + line);
  console.log(`SIDE-BY-SIDE EVAL: ${caseId}`);
  console.log(evalCase.description);
  console.log(line);

  // Expected criteria
  console.log('\n📋 EXPECTED STEPS:');
  evalCase.expected.key_steps.forEach((s, i) => console.log(`  ${i+1}. ${s}`));
  console.log('\n❌ MUST NOT:');
  evalCase.expected.must_not.forEach((s, i) => console.log(`  ${i+1}. ${s}`));

  // Stats comparison
  console.log('\n' + thin);
  console.log('STATS AT A GLANCE');
  console.log(thin);
  console.log(`${''.padEnd(30)} ${'CLI/Skills'.padEnd(20)} ${'MCP'.padEnd(20)}`);
  console.log(`${'Cost'.padEnd(30)} ${'$'+cliStats.cost.toFixed(4).padEnd(19)} ${'$'+mcpStats.cost.toFixed(4)}`);
  console.log(`${'Tool calls'.padEnd(30)} ${String(cliStats.toolCalls).padEnd(20)} ${String(mcpStats.toolCalls)}`);
  console.log(`${'Duration'.padEnd(30)} ${(cliStats.durationS.toFixed(0)+'s').padEnd(20)} ${mcpStats.durationS.toFixed(0)+'s'}`);
  console.log(`${'Got result'.padEnd(30)} ${(cliStats.hasResult?'yes':'NO').padEnd(20)} ${mcpStats.hasResult?'yes':'NO'}`);

  // Show result previews
  console.log('\n' + thin);
  console.log('CLI/Skills RESULT:');
  console.log(thin);
  console.log(cliStats.resultPreview || '[no result]');

  console.log('\n' + thin);
  console.log('MCP RESULT:');
  console.log(thin);
  console.log(mcpStats.resultPreview || '[no result]');

  // Offer to show full transcripts
  const showFull = await prompt(rl, '\nShow full transcripts? (y/N) → ');
  if (showFull.toLowerCase() === 'y') {
    if (cliTranscript && fs.existsSync(cliTranscript)) {
      console.log('\n' + line + '\nFULL CLI TRANSCRIPT\n' + line);
      console.log(fs.readFileSync(cliTranscript, 'utf-8').slice(0, 8000));
    }
    if (mcpTranscript && fs.existsSync(mcpTranscript)) {
      console.log('\n' + line + '\nFULL MCP TRANSCRIPT\n' + line);
      console.log(fs.readFileSync(mcpTranscript, 'utf-8').slice(0, 8000));
    }
  }

  // Score CLI
  console.log('\n' + line);
  console.log('SCORE: CLI/Skills');
  console.log(line);
  const cliTaskS   = await prompt(rl, 'Task completed? (y/n) → ');
  const cliStepsS  = await prompt(rl, 'Steps correct (0-100) → ');
  const cliFricS   = await prompt(rl, 'Friction 0-100 (100=zero friction) → ');
  const cliClarS   = await prompt(rl, 'Output clarity (0-100) → ');
  const cliNotes   = await prompt(rl, 'CLI notes (what worked/broke) → ');

  const cliScores = {
    task:    cliTaskS.toLowerCase() === 'y' ? 100 : 0,
    steps:   parseInt(cliStepsS)  || 0,
    friction: parseInt(cliFricS) || 0,
    clarity: parseInt(cliClarS)  || 0,
  };

  // Score MCP
  console.log('\n' + line);
  console.log('SCORE: MCP');
  console.log(line);
  const mcpTaskS   = await prompt(rl, 'Task completed? (y/n) → ');
  const mcpStepsS  = await prompt(rl, 'Steps correct (0-100) → ');
  const mcpFricS   = await prompt(rl, 'Friction 0-100 (100=zero friction) → ');
  const mcpClarS   = await prompt(rl, 'Output clarity (0-100) → ');
  const mcpNotes   = await prompt(rl, 'MCP notes (what worked/broke) → ');

  const mcpScores = {
    task:    mcpTaskS.toLowerCase() === 'y' ? 100 : 0,
    steps:   parseInt(mcpStepsS)  || 0,
    friction: parseInt(mcpFricS) || 0,
    clarity: parseInt(mcpClarS)  || 0,
  };

  rl.close();

  const w = evalCase.scoring_weights;
  const calcScore = (s: typeof cliScores) =>
    s.task * (w.task_completed||40)/100 + s.steps * (w.steps_correct||30)/100 +
    s.friction * (w.friction_count||20)/100 + s.clarity * (w.output_clarity||10)/100;

  const cliScore = calcScore(cliScores);
  const mcpScore = calcScore(mcpScores);

  // Save scorecards
  if (cliDir) {
    const p = path.join(cliDir, `${caseId}-scorecard.md`);
    fs.writeFileSync(p, scorecard(evalCase, 'cli-skills', cliStats, cliScores, cliNotes, cliDir));
    console.log(`\n✅ CLI scorecard: ${p.replace(os.homedir(), '~')}`);
  }
  if (mcpDir) {
    const p = path.join(mcpDir, `${caseId}-scorecard.md`);
    fs.writeFileSync(p, scorecard(evalCase, 'mcp', mcpStats, mcpScores, mcpNotes, mcpDir));
    console.log(`✅ MCP scorecard: ${p.replace(os.homedir(), '~')}`);
  }

  // Append comparison row + improvement ideas
  appendComparisonRow(caseId, { stats: cliStats, score: cliScore }, { stats: mcpStats, score: mcpScore }, date);
  appendImprovementIdeas(caseId, cliScore, mcpScore, cliStats, mcpStats, cliNotes, mcpNotes);

  // Summary
  const costWinner = cliStats.cost < mcpStats.cost ? 'CLI cheaper' : 'MCP cheaper';
  const qualWinner = cliScore > mcpScore ? 'CLI better quality' : mcpScore > cliScore ? 'MCP better quality' : 'tied quality';
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`CLI: ${cliScore.toFixed(1)}/100 | $${cliStats.cost.toFixed(4)} | ${cliStats.toolCalls} calls`);
  console.log(`MCP: ${mcpScore.toFixed(1)}/100 | $${mcpStats.cost.toFixed(4)} | ${mcpStats.toolCalls} calls`);
  console.log(`→ ${costWinner} | ${qualWinner}`);
  console.log(`\nComparison table: ${TABLE_FILE.replace(os.homedir(), '~')}`);
  console.log(`Improvement ideas: ${IMPROVE_FILE.replace(os.homedir(), '~')}\n`);
}

main().catch(console.error);
