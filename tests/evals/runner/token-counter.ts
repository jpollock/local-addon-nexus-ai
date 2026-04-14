/**
 * Token Counter — estimates token usage from eval transcripts
 *
 * Approach: character count / 4 (rough but consistent estimate across both modes)
 *
 * For MCP mode:
 *   - Tool call tokens: count tool_use + tool_result blocks
 *   - Conversation tokens: all text in assistant/user turns
 *   - Total = sum of all
 *
 * For CLI/Skills mode:
 *   - Skill prompt tokens: SKILL.md file sizes loaded during session
 *   - Bash output tokens: stdout from nexus commands
 *   - Conversation tokens: all text in assistant/user turns
 *   - Total = sum of all
 */

import * as fs from 'fs';
import * as path from 'path';

const SKILLS_DIR = path.join(__dirname, '..', '..', '..', '.claude', 'skills');
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00  },
  'claude-haiku-4-5-20251001': { input: 1.00,  output: 5.00   },
  'claude-opus-4-6':           { input: 5.00,  output: 25.00  },
  'gpt-4.1':                   { input: 2.00,  output: 8.00   },
  'gpt-4.1-mini':              { input: 0.40,  output: 1.60   },
  'gpt-4o':                    { input: 2.50,  output: 10.00  },
  'gpt-4o-mini':               { input: 0.15,  output: 0.60   },
  'gemini-2.5-pro':            { input: 1.25,  output: 10.00  },
  'gemini-2.0-flash':          { input: 0.10,  output: 0.40   },
};
const DEFAULT_RATE = { input: 3.00, output: 15.00 }; // sonnet default

export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function costUsd(inputTokens: number, outputTokens: number, model: string): number {
  const rate = MODEL_RATES[model] ?? DEFAULT_RATE;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

export interface TokenReport {
  mode: 'mcp' | 'cli-skills';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  breakdown: {
    label: string;
    chars: number;
    tokens: number;
  }[];
}

/**
 * Estimate tokens from a raw transcript file.
 * The transcript is plain text copied from a Claude session.
 *
 * Heuristics used:
 * - Lines starting with "Tool:" or "Bash(" are tool calls (counted as input to model)
 * - Lines starting with "Result:" or "⎿" are tool results (counted as input context)
 * - Everything else is conversation (split ~60% input, ~40% output estimate)
 */
export function estimateFromTranscript(transcriptPath: string, mode: 'mcp' | 'cli-skills', model: string): TokenReport {
  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n');

  let toolCallChars = 0;
  let toolResultChars = 0;
  let conversationChars = 0;
  let skillPromptChars = 0;

  let inToolResult = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Tool calls
    if (trimmed.startsWith('⏺ Bash(') || trimmed.startsWith('⏺ Tool(') ||
        trimmed.startsWith('Tool:') || trimmed.startsWith('⏺ ')) {
      toolCallChars += line.length;
      inToolResult = false;
    }
    // Tool results
    else if (trimmed.startsWith('⎿') || trimmed.startsWith('Result:') || inToolResult) {
      toolResultChars += line.length;
      inToolResult = trimmed !== '';
    }
    // Skill invocation marker
    else if (trimmed.includes('Successfully loaded skill')) {
      skillPromptChars += estimateSkillPromptChars(trimmed);
    }
    // Conversation
    else {
      conversationChars += line.length;
    }
  }

  const totalChars = toolCallChars + toolResultChars + conversationChars + skillPromptChars;

  // Input = tool calls + tool results + skill prompts + 60% of conversation
  const inputChars = toolCallChars + toolResultChars + skillPromptChars + Math.ceil(conversationChars * 0.6);
  // Output = 40% of conversation
  const outputChars = Math.ceil(conversationChars * 0.4);

  const inputTokens = charsToTokens(inputChars);
  const outputTokens = charsToTokens(outputChars);
  const totalTokens = inputTokens + outputTokens;
  const cost = costUsd(inputTokens, outputTokens, model);

  return {
    mode,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: cost,
    breakdown: [
      { label: 'Tool calls',     chars: toolCallChars,     tokens: charsToTokens(toolCallChars) },
      { label: 'Tool results',   chars: toolResultChars,   tokens: charsToTokens(toolResultChars) },
      { label: 'Skill prompts',  chars: skillPromptChars,  tokens: charsToTokens(skillPromptChars) },
      { label: 'Conversation',   chars: conversationChars, tokens: charsToTokens(conversationChars) },
    ],
  };
}

function estimateSkillPromptChars(line: string): number {
  // Extract skill name from "Successfully loaded skill · nexus-sites" etc.
  const match = line.match(/nexus-\w+/);
  if (!match) return 0;
  const skillFile = path.join(SKILLS_DIR, match[0], 'SKILL.md');
  if (fs.existsSync(skillFile)) {
    return fs.statSync(skillFile).size;
  }
  return 500; // fallback estimate
}

export function formatReport(report: TokenReport): string {
  const lines = [
    `Mode:         ${report.mode}`,
    `Model:        ${report.model}`,
    `Input tokens: ${report.inputTokens.toLocaleString()}`,
    `Output tokens:${report.outputTokens.toLocaleString()}`,
    `Total tokens: ${report.totalTokens.toLocaleString()}`,
    `Est. cost:    $${report.costUsd.toFixed(4)}`,
    '',
    'Breakdown:',
    ...report.breakdown.map(b =>
      `  ${b.label.padEnd(16)} ${b.tokens.toLocaleString().padStart(6)} tokens (${b.chars.toLocaleString()} chars)`
    ),
  ];
  return lines.join('\n');
}
