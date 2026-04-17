#!/usr/bin/env ts-node
/**
 * Auto-analysis of eval runs — generates a full report without human input.
 *
 * Analyzes all transcripts in the latest cli-skills and mcp result dirs.
 * Scores what can be scored mechanically, flags what needs human review.
 *
 * Usage:
 *   npx ts-node tests/evals/runner/analyze-runs.ts
 *   npx ts-node tests/evals/runner/analyze-runs.ts --date 2026-04-15
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

const CASES_DIR   = path.join(__dirname, '..', 'cases');
const RESULTS_DIR = path.join(__dirname, '..', 'results');

interface EvalCase {
  id: string;
  description: string;
  expected: { task_completed: boolean; key_steps: string[]; must_not: string[] };
  scoring_weights: Record<string, number>;
}

interface CaseAnalysis {
  id: string;
  description: string;
  cli: ModeAnalysis | null;
  mcp: ModeAnalysis | null;
}

interface ModeAnalysis {
  cost: number;
  toolCalls: number;
  durationS: number;
  hasResult: boolean;
  timedOut: boolean;
  result: string;
  keywordHits: string[];    // expected step keywords found in output
  keywordMisses: string[];  // expected step keywords NOT found
  mustNotViolations: string[]; // must_not conditions that appear violated
  autoTaskScore: number;    // 0 or 100
  autoStepsScore: number;   // 0-100 based on keyword hits
  autoScore: number;        // weighted partial (task + steps only)
  confidence: 'high' | 'medium' | 'low'; // how confident we are in auto-score
}

function findResultDir(date: string, mode: string): string | null {
  if (date) {
    const exact = path.join(RESULTS_DIR, `${date}-${mode}`);
    if (fs.existsSync(exact)) return exact;
  }
  const dirs = fs.readdirSync(RESULTS_DIR)
    .filter(d => d.endsWith(`-${mode}`) && fs.statSync(path.join(RESULTS_DIR, d)).isDirectory())
    .sort().reverse();
  return dirs.length ? path.join(RESULTS_DIR, dirs[0]) : null;
}

function extractKeywords(step: unknown): string[] {
  if (typeof step !== 'string') return [];
  // Pull meaningful words from a step description (skip filler)
  const stop = new Set(['the','a','an','and','or','for','to','in','on','at','of','it','is','are','with','from','that','this','its','has','have','does','not','all','any','if','no']);
  return step.toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stop.has(w));
}

function analyzeTranscript(transcriptPath: string, evalCase: EvalCase): ModeAnalysis | null {
  if (!fs.existsSync(transcriptPath)) return null;

  const txt = fs.readFileSync(transcriptPath, 'utf-8').toLowerCase();
  const rawTxt = fs.readFileSync(transcriptPath, 'utf-8');

  const costMatch    = rawTxt.match(/Cost:\s+\$?([\d.]+)/);
  const callsMatch   = rawTxt.match(/Tool calls:\s+(\d+)/);
  const durMatch     = rawTxt.match(/Duration:\s+([\d.]+)s/);
  const resultMatch  = rawTxt.match(/--- FINAL RESULT ---\n([\s\S]*)/);
  const hasResult    = !!resultMatch && resultMatch[1].trim().length > 20;
  const timedOut     = rawTxt.includes('timed out') || (durMatch && parseFloat(durMatch[1]) >= 595);
  const result       = resultMatch ? resultMatch[1].trim().slice(0, 600) : '';

  // Keyword matching against expected steps
  const keywordHits: string[] = [];
  const keywordMisses: string[] = [];
  const steps = Array.isArray(evalCase.expected.key_steps) ? evalCase.expected.key_steps : [];
  for (const step of steps) {
    const stepStr = String(step ?? '');
    const keywords = extractKeywords(stepStr);
    const hit = keywords.some(kw => txt.includes(kw));
    if (hit) keywordHits.push(stepStr.slice(0, 60));
    else keywordMisses.push(stepStr.slice(0, 60));
  }

  // Must-not violation detection (heuristic)
  const mustNotViolations: string[] = [];
  const mustNots = Array.isArray(evalCase.expected.must_not) ? evalCase.expected.must_not : [];
  for (const condition of mustNots) {
    const condStr = String(condition ?? '');
    const keywords = extractKeywords(condStr);
    const resultLower = result.toLowerCase();
    const hitCount = keywords.filter(kw => resultLower.includes(kw)).length;
    if (hitCount >= 2 && keywords.length >= 2) {
      mustNotViolations.push(condStr.slice(0, 60) + ` (${hitCount}/${keywords.length} keywords found)`);
    }
  }

  const autoTaskScore  = hasResult ? 100 : 0;
  const stepsPct       = evalCase.expected.key_steps.length > 0
    ? keywordHits.length / evalCase.expected.key_steps.length
    : 0.5;
  const autoStepsScore = Math.round(stepsPct * 100);

  const w = evalCase.scoring_weights;
  const autoScore = autoTaskScore * (w.task_completed||40)/100 +
                    autoStepsScore * (w.steps_correct||30)/100;

  // Confidence: high if has result + most keywords hit, low if no result
  const confidence: 'high' | 'medium' | 'low' =
    !hasResult ? 'low' :
    stepsPct > 0.6 ? 'high' : 'medium';

  return {
    cost:     parseFloat(costMatch?.[1]  ?? '0'),
    toolCalls: parseInt(callsMatch?.[1] ?? '0'),
    durationS: parseFloat(durMatch?.[1]  ?? '0'),
    hasResult,
    timedOut: !!timedOut,
    result,
    keywordHits,
    keywordMisses,
    mustNotViolations,
    autoTaskScore,
    autoStepsScore,
    autoScore,
    confidence,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const date = dateIdx >= 0 ? args[dateIdx + 1] : '';

  const cliDir = findResultDir(date, 'cli-skills');
  const mcpDir = findResultDir(date, 'mcp');

  if (!cliDir && !mcpDir) {
    console.error('No result directories found.');
    process.exit(1);
  }

  const cliDate = cliDir ? path.basename(cliDir).slice(0, 10) : '?';
  const mcpDate = mcpDir ? path.basename(mcpDir).slice(0, 10) : '?';

  // Load all cases
  const caseFiles = fs.readdirSync(CASES_DIR).filter(f => f.endsWith('.yaml')).sort();
  const analyses: CaseAnalysis[] = [];

  for (const file of caseFiles) {
    const evalCase = yaml.load(fs.readFileSync(path.join(CASES_DIR, file), 'utf-8')) as EvalCase;
    const cliPath  = cliDir ? path.join(cliDir, `${evalCase.id}-transcript.txt`) : '';
    const mcpPath  = mcpDir ? path.join(mcpDir, `${evalCase.id}-transcript.txt`) : '';

    analyses.push({
      id: evalCase.id,
      description: evalCase.description,
      cli: cliPath ? analyzeTranscript(cliPath, evalCase) : null,
      mcp: mcpPath ? analyzeTranscript(mcpPath, evalCase) : null,
    });
  }

  // Build report
  const lines: string[] = [
    '# Eval Run Analysis Report',
    '',
    `**CLI/Skills run:** ${cliDate} (${cliDir ? path.basename(cliDir) : 'not found'})`,
    `**MCP run:** ${mcpDate} (${mcpDir ? path.basename(mcpDir) : 'not found'})`,
    `**Generated:** ${new Date().toISOString().slice(0, 19)}`,
    '',
    '---',
    '',
    '## Summary Table',
    '',
    '| Case | CLI Cost | CLI Calls | CLI Auto | MCP Cost | MCP Calls | MCP Auto | Cost Δ | Score Δ | Review Priority |',
    '|------|---------|-----------|----------|----------|-----------|----------|--------|---------|-----------------|',
  ];

  let totalCliCost = 0, totalMcpCost = 0;
  let totalCliCalls = 0, totalMcpCalls = 0;
  const priorities: Array<{ id: string; reason: string; priority: 'HIGH' | 'MED' | 'LOW' }> = [];

  for (const a of analyses) {
    const cli = a.cli;
    const mcp = a.mcp;

    const cliCost  = cli?.cost ?? 0;
    const mcpCost  = mcp?.cost ?? 0;
    const cliCalls = cli?.toolCalls ?? 0;
    const mcpCalls = mcp?.toolCalls ?? 0;
    const cliScore = cli?.autoScore ?? 0;
    const mcpScore = mcp?.autoScore ?? 0;

    totalCliCost  += cliCost;
    totalMcpCost  += mcpCost;
    totalCliCalls += cliCalls;
    totalMcpCalls += mcpCalls;

    const costDelta = mcpCost > 0 ? ((cliCost - mcpCost) / mcpCost * 100) : 0;
    const scoreDelta = cliScore - mcpScore;

    // Priority scoring
    const reasons: string[] = [];
    if (!cli?.hasResult || !mcp?.hasResult) reasons.push('failed to complete');
    if (Math.abs(cliCalls - mcpCalls) > 10) reasons.push(`call count diverges ${cliCalls} vs ${mcpCalls}`);
    if (Math.abs(costDelta) > 50) reasons.push(`cost diverges ${costDelta.toFixed(0)}%`);
    if (Math.abs(scoreDelta) > 15) reasons.push(`score gap ${Math.abs(scoreDelta).toFixed(0)}pts`);
    if ((cli?.mustNotViolations.length ?? 0) > 0) reasons.push('possible must-not violation');

    const priority: 'HIGH' | 'MED' | 'LOW' = reasons.length >= 2 ? 'HIGH' : reasons.length === 1 ? 'MED' : 'LOW';
    if (reasons.length > 0) priorities.push({ id: a.id, reason: reasons.join('; '), priority });

    const cliConf  = cli?.confidence ?? 'low';
    const mcpConf  = mcp?.confidence ?? 'low';

    lines.push(
      `| ${a.id.replace(/-/g,' ')} ` +
      `| $${cliCost.toFixed(3)} ` +
      `| ${cliCalls} ` +
      `| ${cliScore.toFixed(0)} (${cliConf}) ` +
      `| $${mcpCost.toFixed(3)} ` +
      `| ${mcpCalls} ` +
      `| ${mcpScore.toFixed(0)} (${mcpConf}) ` +
      `| ${costDelta > 0 ? '+' : ''}${costDelta.toFixed(0)}% ` +
      `| ${scoreDelta > 0 ? '+' : ''}${scoreDelta.toFixed(0)} ` +
      `| **${priority}** |`
    );
  }

  lines.push(
    `| **TOTAL** | **$${totalCliCost.toFixed(3)}** | **${totalCliCalls}** | | **$${totalMcpCost.toFixed(3)}** | **${totalMcpCalls}** | | | | |`
  );

  // Review priorities
  lines.push('', '---', '', '## Human Review Priorities', '');
  const high = priorities.filter(p => p.priority === 'HIGH');
  const med  = priorities.filter(p => p.priority === 'MED');
  const low  = priorities.filter(p => p.priority === 'LOW');

  if (high.length) {
    lines.push('### 🔴 HIGH — Score these first');
    high.forEach(p => lines.push(`- **${p.id}**: ${p.reason}`));
  }
  if (med.length) {
    lines.push('', '### 🟡 MEDIUM');
    med.forEach(p => lines.push(`- **${p.id}**: ${p.reason}`));
  }
  if (low.length) {
    lines.push('', '### 🟢 LOW — Both modes completed cleanly');
    low.forEach(p => lines.push(`- ${p.id}`));
  }

  // Per-case detail
  lines.push('', '---', '', '## Per-Case Analysis', '');

  for (const a of analyses) {
    lines.push(`### ${a.id}`, '', `_${a.description}_`, '');

    for (const [mode, analysis] of [['CLI/Skills', a.cli], ['MCP', a.mcp]] as const) {
      if (!analysis) { lines.push(`**${mode}:** no results found`, ''); continue; }

      lines.push(`**${mode}:** $${analysis.cost.toFixed(4)} | ${analysis.toolCalls} calls | ${analysis.durationS.toFixed(0)}s | ${analysis.hasResult ? '✅ result' : '❌ no result'}${analysis.timedOut ? ' (TIMEOUT)' : ''}`);

      if (analysis.keywordMisses.length > 0) {
        lines.push(`- ⚠️ Missing expected: ${analysis.keywordMisses.slice(0,3).map(s=>`"${s}"`).join(', ')}`);
      }
      if (analysis.mustNotViolations.length > 0) {
        lines.push(`- 🚨 Possible must-not violation: ${analysis.mustNotViolations[0]}`);
      }
      if (analysis.hasResult) {
        lines.push(`- Output: "${analysis.result.slice(0, 150).replace(/\n/g,' ')}..."`);
      }
    }

    lines.push('');
  }

  // Improvement ideas
  lines.push('---', '', '## Auto-Detected Improvement Ideas', '');

  const ideas: string[] = [];
  for (const a of analyses) {
    const cli = a.cli; const mcp = a.mcp;
    if (!cli || !mcp) continue;

    if (cli.toolCalls > mcp.toolCalls * 3 && mcp.toolCalls > 0) {
      ideas.push(`**${a.id}** — CLI uses ${cli.toolCalls} calls vs MCP's ${mcp.toolCalls}. CLI skill may be making per-site calls instead of fleet aggregation.`);
    }
    if (mcp.toolCalls > cli.toolCalls * 3 && cli.toolCalls > 0) {
      ideas.push(`**${a.id}** — MCP uses ${mcp.toolCalls} calls vs CLI's ${cli.toolCalls}. MCP tool selection may be over-granular for this task.`);
    }
    if (!cli.hasResult && mcp.hasResult) {
      ideas.push(`**${a.id}** — CLI failed to complete but MCP succeeded. Review CLI skill routing or timeout.`);
    }
    if (cli.hasResult && !mcp.hasResult) {
      ideas.push(`**${a.id}** — MCP failed to complete but CLI succeeded. Check MCP tool allowlist or timeout.`);
    }
    if (cli.keywordMisses.length > cli.keywordHits.length) {
      ideas.push(`**${a.id} CLI** — More expected steps missed than hit (${cli.keywordMisses.length} misses). Review skill prompt for this task type.`);
    }
    if (mcp.keywordMisses.length > mcp.keywordHits.length) {
      ideas.push(`**${a.id} MCP** — More expected steps missed than hit (${mcp.keywordMisses.length} misses). Review MCP tool allowlist.`);
    }
  }

  if (ideas.length === 0) lines.push('_No patterns auto-detected — run compare-eval.ts for deeper analysis._');
  else ideas.forEach(i => lines.push(`- ${i}`));

  // Overall cost summary
  const cheaper = totalCliCost < totalMcpCost ? 'CLI/Skills' : 'MCP';
  const delta = Math.abs(totalCliCost - totalMcpCost);
  lines.push('', '---', '', '## Cost Summary', '',
    `| Mode | Total Cost | Total Calls |`,
    `|------|-----------|-------------|`,
    `| CLI/Skills | $${totalCliCost.toFixed(4)} | ${totalCliCalls} |`,
    `| MCP | $${totalMcpCost.toFixed(4)} | ${totalMcpCalls} |`,
    `| **${cheaper} is cheaper by** | **$${delta.toFixed(4)}** | |`,
    '',
    `_Note: Auto-scores use task_completed(${analyses[0]?.cli ? (analyses[0].cli.autoTaskScore > 0 ? '40' : '40') : '40'}%) + keyword-matching for steps(30%). Friction and clarity require human review._`
  );

  const report = lines.join('\n');
  const reportPath = path.join(RESULTS_DIR, `analysis-${new Date().toISOString().slice(0,10)}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(report);
  console.log(`\n\nReport saved: ${reportPath.replace(os.homedir(), '~')}`);
  console.log(`\nTo score cases interactively:`);
  high.slice(0,3).forEach(p => console.log(`  npx ts-node tests/evals/runner/compare-eval.ts --case ${p.id}`));
}

main();
