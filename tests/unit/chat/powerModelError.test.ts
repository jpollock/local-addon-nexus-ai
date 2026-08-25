/**
 * fixes-082526 — the Power model-mismatch failure is actionable.
 *
 * Live case: settings carried aiModel 'anthropic/claude-sonnet-5' while
 * Power's list serves 4-5. Every send failed with a raw HTTP body — request
 * id, JSON quoting and all — in the transcript, and nothing a person could
 * act on. The house rule for refusals applies to provider errors too: name
 * the thing and name where to change it.
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
});

it('other Power errors still pass through with their detail', async () => {
  const { streamingRequest } = require('../../../src/main/chat/providers/http-utils');
  streamingRequest.mockImplementationOnce(() => { throw new Error('HTTP 401: nope'); });
  const ev = await firstEvent('anthropic/claude-sonnet-4-5');
  expect(ev.type).toBe('error');
  expect(ev.message).toContain('Power error: HTTP 401');
});
