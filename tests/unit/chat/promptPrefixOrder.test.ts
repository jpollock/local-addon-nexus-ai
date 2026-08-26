/**
 * P3 · prefix order (docs/planning/2026-08-26-chat-harness-plan.md).
 *
 * Prompt caching is a prefix match: any byte change invalidates everything
 * after it. The fleet context (live counts — the most volatile text in the
 * prompt) sat at POSITION 0, in front of ~9KB of static doctrine, so every
 * fleet change repriced the whole prompt. It moves to the tail.
 *
 * What does NOT move: ambientBlock. Its mid-prompt position is WP-11's
 * documented ruling — AFTER the untrusted-data directive (injected policy is
 * unambiguously on the trusted side) and BEFORE the tool doctrine (policy
 * outranks tool enthusiasm). Cache pressure does not override a recorded
 * semantic ordering; this file pins BOTH orderings so neither regresses.
 */
import { UNTRUSTED_DATA_DIRECTIVE } from '../../../src/main/mcp/pii';

jest.mock('../../../src/main/assistant/AssistantService', () => ({
  buildFleetContext: () => ({}),
}));
jest.mock('../../../src/main/assistant/wordpress-knowledge', () => ({
  buildWordPressSystemPrompt: () => 'FLEET_CTX_MARKER_VOLATILE',
}));

import { ChatService } from '../../../src/main/chat/ChatService';

function makeService() {
  return new (ChatService as any)({
    registry: { list: () => [] },
    services: {},
    sendToRenderer: jest.fn(),
  });
}

it('static identity opens the prompt — the cacheable prefix comes first', async () => {
  const prompt = await (makeService() as any).buildSystemPrompt(undefined, null);
  expect(prompt.startsWith('You are Nexus AI')).toBe(true);
});

it('volatile fleet context rides at the tail, after all static doctrine', async () => {
  const prompt = await (makeService() as any).buildSystemPrompt(undefined, null);
  const fleet = prompt.indexOf('FLEET_CTX_MARKER_VOLATILE');
  expect(fleet).toBeGreaterThan(-1);
  for (const staticMarker of [
    'You are Nexus AI',
    'Task completion protocol',
    'Site lifecycle',
  ]) {
    expect(fleet).toBeGreaterThan(prompt.indexOf(staticMarker));
  }
});

it("ambientBlock keeps WP-11's ruling: after the trust boundary, before the tool doctrine", async () => {
  const prompt = await (makeService() as any).buildSystemPrompt(undefined, 'AMBIENT_POLICY_BLOCK');
  const directive = prompt.indexOf(UNTRUSTED_DATA_DIRECTIVE);
  const ambient = prompt.indexOf('AMBIENT_POLICY_BLOCK');
  const doctrine = prompt.indexOf('IMPORTANT: Always use your tools');
  expect(directive).toBeGreaterThan(-1);
  expect(ambient).toBeGreaterThan(directive);
  expect(doctrine).toBeGreaterThan(ambient);
});
