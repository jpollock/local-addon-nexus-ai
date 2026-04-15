#!/usr/bin/env ts-node
/**
 * Automated Eval Runner — Nexus AI CLI/MCP Evaluation Framework
 *
 * Runs eval cases automatically via `claude -p`, capturing exact token
 * costs from the API. Human reviews quality scores separately via score-eval.ts.
 *
 * IMPORTANT: You must manually enable/disable the Nexus MCP before running:
 *   CLI/Skills mode → MCP must be DISCONNECTED
 *   MCP mode        → MCP must be CONNECTED
 *
 * The script checks and enforces this before running any cases.
 *
 * Usage:
 *   npx ts-node tests/evals/runner/auto-eval.ts --mode cli-skills
 *   npx ts-node tests/evals/runner/auto-eval.ts --mode mcp
 *   npx ts-node tests/evals/runner/auto-eval.ts --mode mcp --case 01-single-field-lookup
 *   npx ts-node tests/evals/runner/auto-eval.ts --mode mcp --skip-mcp-check
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as readline from 'readline';
import { spawnSync, execSync } from 'child_process';

const CASES_DIR   = path.join(__dirname, '..', 'cases');
const RESULTS_DIR = path.join(__dirname, '..', 'results');
const MCP_SERVER  = 'local-nexus-ai';
// All servers with nexus/WPE tools — all must be down for CLI/Skills mode
const NEXUS_MCP_SERVERS = ['local-nexus-ai', 'wp-nexus', 'nexus-ai'];

// ---------------------------------------------------------------------------
// MCP tool allowlist per case (auto-approval in non-interactive mode)
// ---------------------------------------------------------------------------
const MCP_TOOLS: Record<string, string[]> = {
  '01-single-field-lookup': [
    'mcp__local-nexus-ai__wp_core_version',
    'mcp__local-nexus-ai__local_list_sites',
    'mcp__local-nexus-ai__nexus_list_sites',
    'mcp__local-nexus-ai__local_get_site',
  ],
  '02-fleet-version-drift': [
    'mcp__local-nexus-ai__nexus_list_sites',
    'mcp__local-nexus-ai__local_list_sites',
    'mcp__local-nexus-ai__wp_core_version',
    'mcp__local-nexus-ai__local_get_site',
    'mcp__local-nexus-ai__fleet_health_summary',
    'mcp__local-nexus-ai__wpe_fleet_health',
  ],
  '03-domain-ssl-audit': [
    'mcp__local-nexus-ai__wpe_get_accounts',
    'mcp__local-nexus-ai__wpe_get_installs',
    'mcp__local-nexus-ai__wpe_get_domains',
    'mcp__local-nexus-ai__wpe_get_domain_ssl_certificate',
    'mcp__local-nexus-ai__wpe_get_ssl_certificates',
    'mcp__local-nexus-ai__wpe_account_domains',
    'mcp__local-nexus-ai__wpe_account_ssl_status',
    'mcp__local-nexus-ai__wpe_portfolio_overview',
  ],
  '04-full-site-onboarding': [
    'mcp__local-nexus-ai__nexus_list_sites',
    'mcp__local-nexus-ai__local_list_sites',
    'mcp__local-nexus-ai__local_create_site',
    'mcp__local-nexus-ai__local_start_site',
    'mcp__local-nexus-ai__local_wpe_pull',
    'mcp__local-nexus-ai__wp_site_health',
    'mcp__local-nexus-ai__wp_setup_ai',
    'mcp__local-nexus-ai__wpe_get_installs',
  ],
  '05-staging-to-prod-promotion': [
    'mcp__local-nexus-ai__wpe_get_installs',
    'mcp__local-nexus-ai__wpe_get_install',
    'mcp__local-nexus-ai__wpe_create_backup',
    'mcp__local-nexus-ai__wpe_get_backup',
    'mcp__local-nexus-ai__wpe_promote_environment',
    'mcp__local-nexus-ai__wpe_backup_and_verify',
  ],
  '06-diagnose-broken-site': [
    'mcp__local-nexus-ai__nexus_list_sites',
    'mcp__local-nexus-ai__local_list_sites',
    'mcp__local-nexus-ai__local_get_site',
    'mcp__local-nexus-ai__local_start_site',
    'mcp__local-nexus-ai__wp_site_health',
    'mcp__local-nexus-ai__local_get_site_logs',
    'mcp__local-nexus-ai__wp_plugin_list',
    'mcp__local-nexus-ai__wp_core_version',
    'mcp__local-nexus-ai__wpe_diagnose_site',
    'mcp__local-nexus-ai__wpe_get_installs',
  ],
  '07-content-search': [
    'mcp__local-nexus-ai__nexus_list_sites',
    'mcp__local-nexus-ai__local_list_sites',
    'mcp__local-nexus-ai__search_across_sites',
    'mcp__local-nexus-ai__list_indexed_sites',
    'mcp__local-nexus-ai__reindex_site',
  ],
  '08-bulk-plugin-update': [
    'mcp__local-nexus-ai__nexus_list_sites',
    'mcp__local-nexus-ai__local_list_sites',
    'mcp__local-nexus-ai__local_get_site',
    'mcp__local-nexus-ai__wp_plugin_list',
    'mcp__local-nexus-ai__wp_plugin_update',
    'mcp__local-nexus-ai__local_start_site',
  ],
  '09-gateway-cost-report': [
    'mcp__local-nexus-ai__get_telemetry_status',
    'mcp__local-nexus-ai__get_metrics',
    'mcp__local-nexus-ai__get_tool_metrics',
  ],
  '10-recover-bad-state': [
    'mcp__local-nexus-ai__nexus_list_sites',
    'mcp__local-nexus-ai__local_list_sites',
    'mcp__local-nexus-ai__local_get_site',
    'mcp__local-nexus-ai__local_get_sync_history',
    'mcp__local-nexus-ai__local_get_site_logs',
    'mcp__local-nexus-ai__wpe_get_installs',
    'mcp__local-nexus-ai__wpe_get_install',
    'mcp__local-nexus-ai__wpe_diagnose_site',
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EvalCase {
  id: string;
  description: string;
  mode: string[];
  prompt?: string;
  conversation?: Array<{ turn: number; prompt: string }>;
  expected: { task_completed: boolean; key_steps: string[]; must_not: string[] };
  scoring_weights: Record<string, number>;
  notes?: string;
}

interface RunResult {
  caseId: string;
  mode: string;
  model: string;
  turns: Array<{
    prompt: string;
    result: string;
    rawJson: any;
  }>;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  toolCallCount: number;
  errorCount: number;
  durationMs: number;
  transcriptPath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Resolve the claude binary — it may be an alias or on a non-standard PATH. */
function findClaudeBin(): string {
  // Common install locations
  const candidates = [
    process.env.CLAUDE_BIN,
    `${process.env.HOME}/.claude/local/claude`,
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* skip */ }
  }
  return 'claude'; // fallback — let shell resolve
}

/** Returns list of nexus MCP server names that are currently connected. */
function getConnectedNexusMcps(): string[] {
  try {
    const bin = findClaudeBin();
    const result = spawnSync(bin, ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    const output = String(result.stdout || '') + String(result.stderr || '');
    return NEXUS_MCP_SERVERS.filter(server => {
      const line = output.split('\n').find(l => l.toLowerCase().includes(server.toLowerCase())) ?? '';
      const l = line.toLowerCase();
      // Skip if disabled in Claude Code UI — disabled servers won't be used by Claude
      if (l.includes('disabled') || l.includes('◯')) return false;
      return l.includes('connected') && !l.includes('failed');
    });
  } catch {
    return [];
  }
}

function checkMcpStatus(): 'connected' | 'disconnected' | 'unknown' {
  try {
    const bin = findClaudeBin();
    const result = spawnSync(bin, ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    const output = String(result.stdout || '') + String(result.stderr || '');
    // Find the line for our specific server and check only that line
    const serverLine = output.split('\n').find(l => l.toLowerCase().includes(MCP_SERVER.toLowerCase()));
    if (!serverLine) return 'disconnected';
    const line = serverLine.toLowerCase();
    if (line.includes('connected') && !line.includes('failed')) return 'connected';
    return 'disconnected';
  } catch {
    return 'unknown';
  }
}

function promptUser(rl: readline.Interface, q: string): Promise<string> {
  return new Promise(resolve => rl.question(q, resolve));
}

interface TurnData {
  prompt: string;
  transcript: string;   // human-readable tool calls + reasoning + result
  rawStream: string;    // full stream-json for re-analysis
  finalResult: string;  // the last text result
  toolCalls: Array<{ name: string; input: any; result?: string }>;
  errorCount: number;
  parsed: any;          // the stream-json result object (has cost/tokens)
}

function runClaudeP(
  prompt: string,
  mode: 'mcp' | 'cli-skills',
  caseId: string,
  sessionId?: string,
): TurnData {
  const allowedTools = mode === 'mcp'
    ? (MCP_TOOLS[caseId] ?? []).join(',')
    : 'Bash(nexus *)';

  // For CLI/Skills mode, prefix the prompt to force Bash usage.
  // Without this, Claude tries MCP tools even when they're not in allowedTools.
  const cliPrefix = mode === 'cli-skills'
    ? 'You MUST use only the Bash tool to run nexus CLI commands (e.g. `nexus sites list`, `nexus wpe portfolio`). Do NOT call any MCP tools. Only Bash is available.\n\n'
    : '';
  const actualPrompt = cliPrefix + prompt;

  const args = [
    '-p', actualPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
  ];

  if (allowedTools) args.push('--allowedTools', allowedTools);

  if (sessionId) {
    const idx = args.indexOf('--no-session-persistence');
    if (idx >= 0) args.splice(idx, 1);
    args.push('--resume', sessionId);
  }

  const result = spawnSync(findClaudeBin(), args, {
    encoding: 'utf-8',
    timeout: 300000,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  });

  const rawStream = result.stdout || '';
  const lines = rawStream.split('\n').filter(Boolean);

  let finalResultObj: any = null;
  let finalResultText = '';
  const toolCalls: Array<{ name: string; input: any; result?: string }> = [];
  const transcriptLines: string[] = [`PROMPT: ${prompt}`, ''];
  let errorCount = 0;
  const pendingToolById: Map<string, { name: string; input: any }> = new Map();

  for (const line of lines) {
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }

    if (d.type === 'result') {
      finalResultObj = d;
      finalResultText = d.result ?? '';
    }

    if (d.type === 'assistant') {
      for (const block of d.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) {
          transcriptLines.push(block.text.trim());
        }
        if (block.type === 'tool_use') {
          const inputPreview = JSON.stringify(block.input ?? {}).slice(0, 200);
          transcriptLines.push(`\n⏺ ${block.name}(${inputPreview})`);
          pendingToolById.set(block.id, { name: block.name, input: block.input });
        }
      }
    }

    if (d.type === 'tool') {
      for (const block of d.content ?? []) {
        if (block.type === 'tool_result') {
          const toolId = block.tool_use_id;
          const pending = pendingToolById.get(toolId);
          const resultText = Array.isArray(block.content)
            ? block.content.map((c: any) => c.text ?? '').join('').slice(0, 500)
            : String(block.content ?? '').slice(0, 500);
          transcriptLines.push(`  ⎿  ${resultText}`);
          if (pending) {
            toolCalls.push({ name: pending.name, input: pending.input, result: resultText });
            pendingToolById.delete(toolId);
          }
        }
      }
    }

    if (d.is_error || (d.type === 'result' && d.is_error)) errorCount++;
  }

  if (finalResultText) {
    transcriptLines.push('\n--- FINAL RESULT ---');
    transcriptLines.push(finalResultText);
  }

  return {
    prompt,
    transcript: transcriptLines.join('\n'),
    rawStream,
    finalResult: finalResultText,
    toolCalls,
    errorCount,
    parsed: finalResultObj,
  };
}

async function runCase(
  evalCase: EvalCase,
  mode: 'mcp' | 'cli-skills',
  runDir: string,
  model: string,
): Promise<RunResult> {
  const isMultiTurn = !!evalCase.conversation;
  const turns = evalCase.conversation ?? [{ turn: 1, prompt: evalCase.prompt! }];

  const result: RunResult = {
    caseId: evalCase.id,
    mode,
    model,
    turns: [],
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreation: 0,
    totalCacheRead: 0,
    toolCallCount: 0,
    errorCount: 0,
    durationMs: 0,
    transcriptPath: '',
  };

  const start = Date.now();
  let sessionId: string | undefined;
  const allTurnData: TurnData[] = [];

  for (const turn of turns) {
    console.log(`    Turn ${turn.turn}: "${turn.prompt.slice(0, 60)}..."`);

    const turnData = runClaudeP(turn.prompt, mode, evalCase.id, sessionId);
    allTurnData.push(turnData);

    if (turnData.parsed) {
      const u = turnData.parsed.usage ?? {};
      result.totalCost += turnData.parsed.total_cost_usd ?? 0;
      result.totalInputTokens += u.input_tokens ?? 0;
      result.totalOutputTokens += u.output_tokens ?? 0;
      result.totalCacheCreation += u.cache_creation_input_tokens ?? 0;
      result.totalCacheRead += u.cache_read_input_tokens ?? 0;
      sessionId = turnData.parsed.session_id;
    }

    result.toolCallCount += turnData.toolCalls.length;
    result.errorCount += turnData.errorCount;

    result.turns.push({
      prompt: turn.prompt,
      result: turnData.finalResult || '[no result]',
      rawJson: turnData.parsed,
    });
  }

  result.durationMs = Date.now() - start;

  // Save full transcript — tool calls, results, reasoning, final answer
  const transcriptFile = path.join(runDir, `${evalCase.id}-transcript.txt`);
  const transcriptContent = [
    `EVAL TRANSCRIPT (AUTOMATED)`,
    `Case: ${evalCase.id}`,
    `Mode: ${mode}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Model: ${model}`,
    `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    `Tool calls: ${result.toolCallCount}`,
    `Cost: $${result.totalCost.toFixed(4)}`,
    '',
    ...allTurnData.map((t, i) => [
      `${'='.repeat(60)}`,
      `TURN ${i + 1}`,
      `${'='.repeat(60)}`,
      t.transcript,
      '',
    ].join('\n')),
  ].join('\n');

  fs.writeFileSync(transcriptFile, transcriptContent);
  result.transcriptPath = transcriptFile;

  // Save raw stream-json for re-analysis (tool inputs/outputs, exact costs)
  const rawFile = path.join(runDir, `${evalCase.id}-raw.jsonl`);
  fs.writeFileSync(rawFile, allTurnData.map(t => t.rawStream).join('\n--- TURN BREAK ---\n'));

  // Save partial scorecard (auto-scored parts only)
  const scorecardFile = path.join(runDir, `${evalCase.id}-scorecard.md`);
  const hasResult = result.turns.some(t => t.result && t.result !== '[no result]');
  const autoTaskScore = hasResult ? 100 : 0;

  const weights = evalCase.scoring_weights;
  const autoWeighted = autoTaskScore * (weights.task_completed || 40) / 100;

  const scorecard = [
    `# Eval Scorecard: ${evalCase.id} (PARTIAL — auto-scored)`,
    '',
    `**Date:** ${new Date().toISOString().slice(0, 10)}  `,
    `**Mode:** ${mode}  `,
    `**Model:** ${model}  `,
    `**Run type:** Automated via claude -p  `,
    '',
    '## Auto-Scored Metrics',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tool calls | ${result.toolCallCount} |`,
    `| Error events | ${result.errorCount} |`,
    `| Duration | ${(result.durationMs / 1000).toFixed(1)}s |`,
    `| Has result | ${hasResult ? 'yes' : 'no'} |`,
    '',
    '## Token Cost (Exact from API)',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Input tokens | ${result.totalInputTokens.toLocaleString()} |`,
    `| Output tokens | ${result.totalOutputTokens.toLocaleString()} |`,
    `| Cache creation | ${result.totalCacheCreation.toLocaleString()} |`,
    `| Cache read | ${result.totalCacheRead.toLocaleString()} |`,
    `| **Total cost** | **$${result.totalCost.toFixed(4)}** |`,
    '',
    '## Human Scores Needed',
    '',
    `Run: npx ts-node tests/evals/runner/score-eval.ts ${path.relative(process.cwd(), transcriptFile)}`,
    '',
    '| Dimension | Score | Weight | Notes |',
    '|-----------|-------|--------|-------|',
    `| Task completed (auto) | ${autoTaskScore} | ${weights.task_completed || 40}% | ${hasResult ? 'Got a result' : 'No result'} |`,
    `| Steps correct | TBD | ${weights.steps_correct || 30}% | Human review |`,
    `| Friction | TBD | ${weights.friction_count || 20}% | Human review |`,
    `| Output clarity | TBD | ${weights.output_clarity || 10}% | Human review |`,
    `| **Auto partial** | **${autoWeighted.toFixed(1)}** | | Steps/friction/clarity = TBD |`,
    '',
    '## Result Preview',
    '',
    '```',
    result.turns[result.turns.length - 1]?.result?.slice(0, 1000) ?? '[no result]',
    '```',
  ].join('\n');

  fs.writeFileSync(scorecardFile, scorecard);

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const caseIdx = args.indexOf('--case');
  const modelIdx = args.indexOf('--model');
  const skipMcpCheck = args.includes('--skip-mcp-check');

  const mode = (modeIdx >= 0 ? args[modeIdx + 1] : 'cli-skills') as 'mcp' | 'cli-skills';
  const filterCase = caseIdx >= 0 ? args[caseIdx + 1] : undefined;
  const model = modelIdx >= 0 ? args[modelIdx + 1] : 'claude-sonnet-4-6';

  if (!['mcp', 'cli-skills'].includes(mode)) {
    console.error('--mode must be mcp or cli-skills');
    process.exit(1);
  }

  // Load cases
  const caseFiles = fs.readdirSync(CASES_DIR).filter(f => f.endsWith('.yaml')).sort();
  const cases = caseFiles
    .map(f => yaml.load(fs.readFileSync(path.join(CASES_DIR, f), 'utf-8')) as EvalCase)
    .filter(c => !filterCase || c.id === filterCase)
    .filter(c => c.mode.includes(mode));

  if (cases.length === 0) {
    console.error(`No cases found for mode=${mode}${filterCase ? `, case=${filterCase}` : ''}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const line = '═'.repeat(60);

  console.log('\n' + line);
  console.log('NEXUS AI AUTOMATED EVAL RUNNER');
  console.log(`Mode: ${mode.toUpperCase()} | Cases: ${cases.length} | Model: ${model}`);
  console.log(line);

  // ── MCP state check ──────────────────────────────────────────────────────
  if (!skipMcpCheck) {
    const mcpStatus = checkMcpStatus();
    console.log(`\nNexus MCP status: ${mcpStatus === 'connected' ? '✅ Connected' : '❌ Disconnected'}`);

    if (mode === 'cli-skills') {
      const connectedNexusMcps = getConnectedNexusMcps();
      if (connectedNexusMcps.length > 0) {
        console.log(`\n⚠️  CLI/Skills mode requires ALL nexus MCP servers to be DISCONNECTED.`);
        console.log('   When any nexus MCP is connected, Claude prefers MCP tools over the nexus CLI.');
        console.log(`\n   Currently connected: ${connectedNexusMcps.join(', ')}`);
        console.log('   To reconnect later: nexus mcp setup --agent claude-code --write\n');
        const ans = await promptUser(rl, 'Disconnect all nexus MCPs now and continue? (y/N) → ');
        if (ans.toLowerCase() === 'y') {
          for (const server of connectedNexusMcps) {
            spawnSync(findClaudeBin(), ['mcp', 'remove', server], { stdio: 'inherit' });
          }
          console.log(`✅ Disconnected: ${connectedNexusMcps.join(', ')}. Continuing...`);
        } else {
          console.log('Aborted. Disconnect all nexus MCPs and re-run.');
          rl.close(); process.exit(0);
        }
      }
    } else {
      // MCP mode
      if (mcpStatus !== 'connected') {
        console.log('\n⚠️  MCP mode requires the Nexus MCP to be CONNECTED.');
        console.log('\n   To connect: nexus mcp setup --agent claude-code --write');
        console.log('   Then restart Claude Code if needed.\n');
        await promptUser(rl, 'Press Enter after connecting MCP to continue...');
        const recheck = checkMcpStatus();
        if (recheck !== 'connected') {
          console.log('❌ MCP still not connected. Aborting.');
          rl.close(); process.exit(1);
        }
        console.log('✅ MCP connected. Continuing...');
      }
    }
  }

  // ── Create results directory ─────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const runDir = path.join(RESULTS_DIR, `${today}-${mode}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`\nResults → ${runDir.replace(process.env.HOME ?? '', '~')}\n`);

  // ── Run cases ────────────────────────────────────────────────────────────
  const results: RunResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const isMultiTurn = !!evalCase.conversation;
    const turns = evalCase.conversation?.length ?? 1;

    console.log(`\n[${i + 1}/${cases.length}] ${evalCase.id}`);
    console.log(`  ${evalCase.description}`);
    console.log(`  ${isMultiTurn ? `Multi-turn (${turns} turns)` : 'Single-turn'}`);

    try {
      const result = await runCase(evalCase, mode, runDir, model);
      results.push(result);

      const taskOk = result.turns.some(t => t.result && t.result !== '[no result]');
      console.log(`  ✅ Done — $${result.totalCost.toFixed(4)} | ${result.toolCallCount} tool calls | ${(result.durationMs / 1000).toFixed(0)}s`);
      if (!taskOk) console.log('  ⚠️  No result returned — check transcript');
    } catch (err: any) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalCost = results.reduce((s, r) => s + r.totalCost, 0);
  const totalTools = results.reduce((s, r) => s + r.toolCallCount, 0);

  console.log('\n' + line);
  console.log('SUMMARY');
  console.log(line);
  console.log(`Mode:         ${mode}`);
  console.log(`Cases run:    ${results.length}/${cases.length}`);
  console.log(`Total cost:   $${totalCost.toFixed(4)}`);
  console.log(`Total tools:  ${totalTools}`);
  console.log('');
  console.log('Per case:');
  for (const r of results) {
    const ok = r.turns.some(t => t.result && t.result !== '[no result]');
    console.log(`  ${ok ? '✅' : '❌'} ${r.caseId.padEnd(35)} $${r.totalCost.toFixed(4)} | ${r.toolCallCount} calls`);
  }
  console.log('');
  console.log('Next: score quality dimensions with:');
  console.log(`  npx ts-node tests/evals/runner/score-eval.ts <transcript-file>`);
  console.log(line + '\n');

  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
