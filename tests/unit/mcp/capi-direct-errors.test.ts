/**
 * capiDirect must attach the CAPI response body to the error it throws.
 *
 * It used to throw `new Error(\`CAPI ${method} ${path} failed: HTTP ${status}\`)`
 * and discard the body. `capiError` (mcp/modules/wpe/helpers.ts) has always read
 * `err.status` and `err.responseJson?.message` to build its 400 branch, but
 * nothing populated either field, so that branch was unreachable and a real
 * validation message — "name already taken", "install limit reached" — reached
 * the user as a bare "HTTP 400" with no way to act on it.
 */

import { createLocalServicesBridge } from '../../../src/main/mcp/local-services-bridge';
import { capiError } from '../../../src/main/mcp/modules/wpe/helpers';

function bridgeWithFetch(response: Partial<Response> & { text: () => Promise<string> }) {
  (global as any).fetch = jest.fn().mockResolvedValue(response);
  return createLocalServicesBridge({
    wpeOAuth: { getAccessToken: async () => 'test-token' },
  } as any);
}

describe('capiDirect error surfacing', () => {
  afterEach(() => {
    delete (global as any).fetch;
    jest.restoreAllMocks();
  });

  it('puts the CAPI validation message in the thrown error message', async () => {
    const bridge = bridgeWithFetch({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'name has already been taken' }),
    });

    await expect(bridge.capiDirect('/installs', 'POST', { name: 'taken' }))
      .rejects.toThrow(/name has already been taken/);
  });

  it('attaches status and parsed body so capiError can reach its 400 branch', async () => {
    const bridge = bridgeWithFetch({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'install limit reached' }),
    });

    const err: any = await bridge.capiDirect('/installs', 'POST', {}).catch((e: any): any => e);

    expect(err.status).toBe(400);
    expect(err.responseJson).toEqual({ message: 'install limit reached' });
    // The consumer's 400 branch is what was dead before.
    expect(capiError(err)).toEqual(
      expect.objectContaining({
        content: [expect.objectContaining({ text: expect.stringContaining('install limit reached') })],
      }),
    );
  });

  it('keeps a non-JSON body rather than losing it', async () => {
    const bridge = bridgeWithFetch({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    });

    const err: any = await bridge.capiDirect('/installs').catch((e: any): any => e);

    expect(err.message).toContain('Bad Gateway');
    expect(err.responseJson).toBeUndefined();
    expect(err.responseText).toBe('<html>Bad Gateway</html>');
  });

  it('truncates a huge body — this string reaches users and the audit log', async () => {
    const bridge = bridgeWithFetch({
      ok: false,
      status: 400,
      text: async () => 'x'.repeat(5000),
    });

    const err: any = await bridge.capiDirect('/installs').catch((e: any): any => e);

    // 500-char cap plus the fixed prefix, nowhere near the raw 5000.
    expect(err.message.length).toBeLessThan(700);
    // The full body is still available programmatically.
    expect(err.responseText).toHaveLength(5000);
  });

  it('still returns parsed JSON on success', async () => {
    const bridge = bridgeWithFetch({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'abc', name: 'summit' }),
    });

    await expect(bridge.capiDirect('/installs/abc')).resolves.toEqual({ id: 'abc', name: 'summit' });
  });

  it('still returns null for an empty success body', async () => {
    const bridge = bridgeWithFetch({ ok: true, status: 204, text: async () => '' });
    await expect(bridge.capiDirect('/installs/abc', 'DELETE')).resolves.toBeNull();
  });
});
