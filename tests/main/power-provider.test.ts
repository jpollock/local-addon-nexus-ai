import { PowerProvider } from '../../src/main/chat/providers/power';
import * as httpUtils from '../../src/main/chat/providers/http-utils';

// Mock the HTTP layer — CI has no wpe_ key, so no live Power calls.
jest.mock('../../src/main/chat/providers/http-utils');

const mockApiRequest = httpUtils.apiRequest as jest.MockedFunction<typeof httpUtils.apiRequest>;
const mockStreamingRequest = httpUtils.streamingRequest as jest.MockedFunction<typeof httpUtils.streamingRequest>;

describe('PowerProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('has correct static properties', () => {
    const p = new PowerProvider();
    expect(p.id).toBe('power');
    expect(p.displayName).toBe('WP Engine Power');
    expect(p.requiresApiKey).toBe(true);
    expect(p.defaultModels.length).toBeGreaterThan(0);
  });

  test('listModels returns ALL provider/model ids unfiltered (no gpt- prefix filter)', async () => {
    mockApiRequest.mockResolvedValue(JSON.stringify({
      object: 'list',
      data: [
        { id: 'anthropic/claude-haiku-4-5' },
        { id: 'google/gemini-2.5-flash' },
        { id: 'openai/gpt-4o' },
        { id: 'gemma/gemma-3-27b' },
      ],
    }));
    const p = new PowerProvider();
    const models = await p.listModels({ model: '', apiKey: 'wpe_test' });

    expect(models).toContain('anthropic/claude-haiku-4-5');
    expect(models).toContain('google/gemini-2.5-flash');
    expect(models).toContain('openai/gpt-4o');
    expect(models).toContain('gemma/gemma-3-27b'); // non-gpt prefix survives => filter dropped
    expect(models.length).toBe(4);

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.ai.wpengine.com/v1/models',
      headers: { Authorization: 'Bearer wpe_test' },
    }));
  });

  test('listModels falls back to defaultModels when the request fails', async () => {
    mockApiRequest.mockRejectedValue(new Error('HTTP 500: boom'));
    const p = new PowerProvider();
    const models = await p.listModels({ model: '', apiKey: 'wpe_test' });
    expect(models).toEqual(p.defaultModels);
  });

  test('validateKey returns null for a valid key (200)', async () => {
    mockApiRequest.mockResolvedValue('{"object":"list","data":[]}');
    const p = new PowerProvider();
    expect(await p.validateKey('wpe_good')).toBeNull();
    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.ai.wpengine.com/v1/models',
      headers: { Authorization: 'Bearer wpe_good' },
    }));
  });

  test('validateKey returns an error message for an invalid key (401)', async () => {
    mockApiRequest.mockRejectedValue(new Error('HTTP 401: {"error":{"message":"invalid key"}}'));
    const p = new PowerProvider();
    const result = await p.validateKey('wpe_bad');
    expect(result).toMatch(/Invalid API key/);
  });

  test('streamChat POSTs to Power with Bearer auth and NO WPEngine-Project header', async () => {
    mockStreamingRequest.mockImplementation(async function* () {
      yield JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] });
      yield JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    });

    const p = new PowerProvider();
    const signal = new AbortController().signal;
    const events: any[] = [];
    for await (const e of p.streamChat(
      [{ role: 'user', content: 'hi' }] as any,
      [],
      { model: 'anthropic/claude-haiku-4-5', apiKey: 'wpe_test' },
      signal,
    )) {
      events.push(e);
    }

    // Request shape
    const callArg = mockStreamingRequest.mock.calls[0][0];
    expect(callArg.url).toBe('https://api.ai.wpengine.com/v1/chat/completions');
    expect(callArg.headers).toEqual({ Authorization: 'Bearer wpe_test' });
    expect(callArg.headers).not.toHaveProperty('WPEngine-Project'); // regression guard

    // Streamed events
    expect(events.some((e) => e.type === 'token' && e.text === 'Hello')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  test('streamChat surfaces provider errors as an error event', async () => {
    mockStreamingRequest.mockImplementation(async function* () {
      throw new Error('HTTP 429: {"error":{"message":"rate limited"}}');
    });

    const p = new PowerProvider();
    const signal = new AbortController().signal;
    const events: any[] = [];
    for await (const e of p.streamChat(
      [{ role: 'user', content: 'hi' }] as any,
      [],
      { model: 'x', apiKey: 'k' },
      signal,
    )) {
      events.push(e);
    }

    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err.message).toMatch(/429/);
    expect(err.message).toMatch(/^Power error:/);
  });
});
