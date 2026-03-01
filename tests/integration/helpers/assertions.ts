import type { McpToolResult } from '../../../src/main/mcp/types';

/**
 * Assert that a tool result is an error with expected text.
 */
export function expectToolError(result: McpToolResult, expectedText?: string): void {
  expect(result.isError).toBe(true);
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  if (expectedText) {
    expect(result.content[0].text).toContain(expectedText);
  }
}

/**
 * Assert that a tool result is successful (not an error).
 */
export function expectToolSuccess(result: McpToolResult): void {
  expect(result.isError).toBeFalsy();
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
}

/**
 * Assert that a tool result contains specific text.
 */
export function expectToolText(result: McpToolResult, expectedText: string): void {
  expect(result.content[0].text).toContain(expectedText);
}

/**
 * Parse confirmation response from a Tier 3 tool.
 */
export function parseConfirmation(result: McpToolResult): {
  requiresConfirmation: boolean;
  tier: number;
  confirmationToken: string;
  action: string;
} {
  return JSON.parse(result.content[0].text);
}
