/**
 * fixes-082526 — the Power "incompatible with the selected model" 400 is
 * actionable, and truthful about what it means.
 *
 * Live case, diagnosis corrected same-day: anthropic/claude-sonnet-5 is
 * Power's FEATURED model and still returned this 400 for our tool-bearing
 * chat request, while claude-sonnet-4-5 accepted the identical shape. So the
 * 400 is about the REQUEST SHAPE against that model's route (this adapter
 * always sends tools), not about the id being unknown — and the message must
 * not claim "Power doesn't serve X" when it demonstrably does. Name what is
 * known, name where to act, assert nothing beyond the evidence.
 */
import { PowerProvider } from '../../../src/main/chat/providers/power';

jest.mock('../../../src/main/chat/providers/http-utils', () => ({
  streamingRequest: jest.fn(() => {
    throw new Error(
      'HTTP 400: {"error":{"message":"request is incompatible with the selected model","type":"invalid_request_error","code":400,"request_id":"f01a3b"}}',
    );
  }),
  jsonRequest: jest.fn(),
}));

async function firstEvent(model: string) {
  const p = new PowerProvider();
  const it = p.streamChat([], [], { providerId: 'power', model, apiKey: 'k' } as any, new AbortController().signal);
  return (await it.next()).value;
}

it('names the model and where to fix it, not the HTTP body', async () => {
  const ev = await firstEvent('anthropic/claude-sonnet-5');
  expect(ev.type).toBe('error');
  expect(ev.message).toContain('anthropic/claude-sonnet-5');
  expect(ev.message).toMatch(/Settings → Chat/);
  expect(ev.message).not.toMatch(/request_id|HTTP 400/);
  // And it must not overclaim: Power DOES serve this model.
  expect(ev.message).not.toMatch(/doesn't serve|does not serve/);
});

it('other Power errors still pass through with their detail', async () => {
  const { streamingRequest } = require('../../../src/main/chat/providers/http-utils');
  streamingRequest.mockImplementationOnce(() => { throw new Error('HTTP 401: nope'); });
  const ev = await firstEvent('anthropic/claude-sonnet-4-5');
  expect(ev.type).toBe('error');
  expect(ev.message).toContain('Power error: HTTP 401');
});
