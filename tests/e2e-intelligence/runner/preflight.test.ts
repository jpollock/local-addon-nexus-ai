/**
 * WP-18 · Unit pins for the journey runner's preflight.
 *
 * The runner's own logic is code, and gets pinned like code (protocol DoD 4).
 * The behaviour under test here is the one the strategy doc calls out by name:
 * "requires the app; skips with a loud banner, never a silent green"
 * (TESTING_STRATEGY.md layer 5). A preflight that returns `ok` when Local is
 * absent is the exact failure this packet exists to prevent, so every branch
 * that can produce `ok` is pinned, and so is the shape of the banner.
 */
import {
  PREFLIGHT_EXIT_CODE,
  REQUIRED_TOOLS,
  loudBanner,
  preflight,
} from './preflight';

const CONN = { url: 'http://127.0.0.1:13123', authToken: 't0ken' };

/** Every tool the journeys need, so a test can subtract exactly one. */
const ALL_TOOLS = [...REQUIRED_TOOLS, 'nexus_list_sites', 'get_site_health'];

describe('preflight — the gate that makes a missing Local loud', () => {
  it('passes only when the connection info loads AND every required tool is listed', async () => {
    const result = await preflight({
      connectionInfo: CONN,
      listTools: async () => ALL_TOOLS,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tools).toEqual(ALL_TOOLS);
  });

  it('fails when the MCP connection-info file is absent — Local is not running', async () => {
    const result = await preflight({
      connectionInfo: null,
      listTools: async () => ALL_TOOLS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.banner).toContain('Local does not appear to be running');
    // The remedy is the point: a banner that names no next step is just noise.
    expect(result.banner).toContain('./dev-reload.sh');
  });

  it('fails when the endpoint is unreachable, and quotes the transport error', async () => {
    const result = await preflight({
      connectionInfo: CONN,
      listTools: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:13123');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.banner).toContain('did not answer');
    expect(result.banner).toContain('ECONNREFUSED 127.0.0.1:13123');
  });

  it('fails when a required tool is missing, and names WHICH — a stale addon build reads as a bug otherwise', async () => {
    const withoutHealth = ALL_TOOLS.filter((t) => t !== 'nexus_intelligence_health');

    const result = await preflight({
      connectionInfo: CONN,
      listTools: async () => withoutHealth,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.banner).toContain('nexus_intelligence_health');
    // The other required tools ARE present and must not be blamed.
    expect(result.banner).not.toContain('verify_site_live');
    expect(result.banner).toContain('npm run build');
  });

  it('lists every missing tool, not just the first', async () => {
    const result = await preflight({
      connectionInfo: CONN,
      listTools: async () => ['nexus_list_sites'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const tool of REQUIRED_TOOLS) expect(result.banner).toContain(tool);
  });
});

describe('loudBanner — loud enough that a scrollback skim cannot miss it', () => {
  const banner = loudBanner('SOMETHING IS WRONG', ['line one', 'line two']);

  it('is fenced top and bottom so it survives interleaved jest output', () => {
    const lines = banner.split('\n');
    const rules = lines.filter((l) => /^={20,}$/.test(l));
    expect(rules.length).toBeGreaterThanOrEqual(2);
  });

  it('carries the title and every body line', () => {
    expect(banner).toContain('SOMETHING IS WRONG');
    expect(banner).toContain('line one');
    expect(banner).toContain('line two');
  });
});

describe('the distinct exit code', () => {
  it('is not 0 and not 1 — "did not run" must be distinguishable from "ran and failed"', () => {
    // 1 is what jest itself exits with on a failing test. If preflight shared
    // it, CI could not tell "the journeys found a defect" from "the journeys
    // never executed", and the second reads as the first.
    expect(PREFLIGHT_EXIT_CODE).not.toBe(0);
    expect(PREFLIGHT_EXIT_CODE).not.toBe(1);
  });
});
