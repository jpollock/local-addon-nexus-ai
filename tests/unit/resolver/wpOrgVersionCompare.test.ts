/**
 * A0 — the plugin audit reported non-updates as updates.
 *
 * `checkUpdates()` gated on truthiness (`if (info.new_version)`) and never
 * compared the returned version to the installed one. WordPress.org's
 * update-check endpoint returns entries whose `new_version` EQUALS — or is
 * LOWER than — the version submitted, and every one became an "available
 * update". Measured across 42 local sites: 175 reported, ~95 genuine, 78
 * equal-version, 2 downgrades. 46% false.
 *
 * Why it shipped: the four existing cases all pass with the bug present. The
 * "newer version" case submits 3.21.0 against 3.22.0, so nothing ever
 * exercised the equal-or-lower branch. These are that branch.
 *
 * The governing rule is WITHHOLD RATHER THAN GUESS: an invented update is the
 * bug, so anything not provably `installed < latest` is not reported.
 */
import { WordPressOrgClient } from '../../../src/main/resolver/WordPressOrgClient';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

/** One wp.org reply for a single plugin. */
function reply(newVersion: string) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ plugins: { 'acme/acme.php': { new_version: newVersion } } }),
  });
}
const check = (installed: string) =>
  WordPressOrgClient.checkUpdates([{ slug: 'acme', version: installed }]);

beforeEach(() => mockFetch.mockReset());

describe('A0 — an update is reported only when there is one', () => {
  it('reports a genuinely newer version', async () => {
    reply('3.22.0');
    expect((await check('3.21.0')).get('acme')).toBe('3.22.0');
  });

  it('does NOT report an equal version — 78 of 175 on the measured fleet', async () => {
    reply('11.0.1');
    expect((await check('11.0.1')).has('acme')).toBe(false);
  });

  it('does NOT report a DOWNGRADE as an update', async () => {
    // Live examples: ActiveCampaign Postmark 1.20.0 -> 1.19.1, Genesis Connect 1.1.3 -> 1.1.2.
    reply('1.19.1');
    expect((await check('1.20.0')).has('acme')).toBe(false);
  });

  it('compares numerically, not as strings — 3.9.0 is older than 3.10.0', async () => {
    reply('3.10.0');
    expect((await check('3.9.0')).get('acme')).toBe('3.10.0');
    mockFetch.mockReset();
    // and the reverse must not report
    reply('3.9.0');
    expect((await check('3.10.0')).has('acme')).toBe(false);
  });

  it('withholds when the installed version is unknown — an invented update IS the bug', async () => {
    reply('2.0.0');
    expect((await check('unknown')).has('acme')).toBe(false);
  });

  it('withholds when a version will not parse, rather than guessing', async () => {
    // 6.8.0-beta2 is live on this fleet; a prerelease must not be asserted either way.
    reply('');
    expect((await check('6.8.0-beta2')).has('acme')).toBe(false);
  });

  it('still reports nothing when wp.org omits the plugin or the call fails', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ plugins: {} }) });
    expect((await check('1.0.0')).size).toBe(0);
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    expect((await check('1.0.0')).size).toBe(0);
  });
});
