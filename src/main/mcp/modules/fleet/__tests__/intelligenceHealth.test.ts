/**
 * `nexus_intelligence_health` — the rendering half of WP-17.
 *
 * What these pin, beyond "it produces text":
 *   - the Controlled Vocabulary v1 boundary: OK / needs a check / not
 *     reporting reach the user; OK/STALE/DARK and producer system ids never
 *     do (`your-copy-and-the-live-site.md`);
 *   - the non-fatality promise closes EVERY rendering, including the two
 *     degraded ones — the moment it matters most is the moment a line above
 *     it says the layer is not reporting;
 *   - the tool cannot crash the thing it checks, at the outermost boundary;
 *   - it is registered, and registered as Tier 1 (read-only): an absent
 *     TIER_OVERRIDES entry silently defaults to Tier 2 and writes an audit
 *     line every time someone asks whether recording works.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { collectIntelligenceHealth } from '../../../../intelligence-host/health';
import { getToolSafety } from '../../../safety';
import { registerFleetTools } from '../index';
import { intelligenceHealthHandler, renderHealthReport } from '../intelligence-health';

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-health-tool-'));
  const core = initIntelligenceCore({
    storage: { get: () => null, set: () => {} },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  return core;
}

async function run(): Promise<string> {
  const res = await intelligenceHealthHandler.execute({}, {} as never);
  return res.content[0].text;
}

test('the tool is registered and is Tier 1 — read-only, never audited as a mutation', () => {
  const registered: string[] = [];
  registerFleetTools({ register: (h: { definition: { name: string } }) => registered.push(h.definition.name) } as never);
  expect(registered).toContain('nexus_intelligence_health');
  expect(getToolSafety('nexus_intelligence_health').tier).toBe(1);
  expect(intelligenceHealthHandler.definition.annotations?.readOnlyHint).toBe(true);
});

test('a healthy core renders every check with value, expectation and a user-facing verdict', async () => {
  const core = makeCore();
  core.tap('site-a', 'plugin_updated', {
    slug: 'woocommerce',
    name: 'WooCommerce',
    version: '9.9.1',
    is_active: true,
  });

  const text = await run();

  // Producer names are TRANSLATED — the system id never surfaces.
  expect(text).toContain('In-site events');
  expect(text).not.toContain('wp-webhook');
  expect(text).not.toContain('graph-sync');
  expect(text).not.toContain('assembler:chat');
  // Each line carries the three things the packet asks for.
  expect(text).toMatch(/\| In-site events \| last seen .+ \| within 3d \| OK \|/);
  // Internal verdict words never leave the host module.
  expect(text).not.toMatch(/\bSTALE\b/);
  expect(text).not.toMatch(/\bDARK\b/);
  // Nor does internal machinery vocabulary.
  for (const forbidden of ['ledger', 'twin', 'SLO', 'fold', 'envelope']) {
    expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
  expect(text).toContain('Nexus AI keeps working');

  core.close();
});

test('the user-facing words are the controlled vocabulary, for every internal verdict', () => {
  const text = renderHealthReport({
    checkedAt: '2026-08-17T12:00:00.000Z',
    coreUp: true,
    worst: 'DARK',
    errors: [],
    lines: [
      { key: 'a', label: 'Recording', value: 'ready', threshold: 'starts with the app', verdict: 'OK' },
      { key: 'b', label: 'In-site events', value: 'last seen 9d ago', threshold: 'within 3d', verdict: 'STALE' },
      { key: 'c', label: 'Site identity', value: 'unavailable', threshold: 'available', verdict: 'DARK' },
    ],
  });

  expect(text).toContain('| Recording | ready | starts with the app | OK |');
  expect(text).toContain('| In-site events | last seen 9d ago | within 3d | needs a check |');
  expect(text).toContain('| Site identity | unavailable | available | not reporting |');
  expect(text).toContain('— not reporting'); // the heading carries the worst verdict
  expect(text).not.toMatch(/\bSTALE\b|\bDARK\b/);
});

test('with the layer down, the report says so, explains the blank, and still promises non-fatality', () => {
  const text = renderHealthReport(
    collectIntelligenceHealth({ core: undefined, initState: {}, now: new Date() })
  );

  expect(text).toContain('— not reporting');
  expect(text).toContain('| Recording | not started |');
  expect(text).toContain('Nothing else can be measured');
  expect(text).toContain('Nexus AI keeps working');
});

test('a failure inside the check still returns an answer — a health check may not crash its subject', async () => {
  // The require happens inside isolateModules (synchronous, as jest runs it);
  // the await happens OUTSIDE. An async callback handed to isolateModules is
  // never awaited, so its assertions would run after the test had already
  // passed — a green test pinning nothing.
  let handler!: typeof intelligenceHealthHandler;
  jest.isolateModules(() => {
    jest.doMock('../../../../intelligence-host/health', () => ({
      collectIntelligenceHealth: () => {
        throw new Error('everything is on fire');
      },
    }));
    handler = require('../intelligence-health').intelligenceHealthHandler;
  });

  const res = await handler.execute({}, {} as never);
  const text = res.content[0].text;
  expect(res.isError).toBeUndefined();
  expect(text).toContain('everything is on fire');
  expect(text).toContain('not reporting');
  expect(text).toContain('Nexus AI keeps working');
});

test('a source with no liveness expectation is named by its raw id — the one disclosed vocabulary exception', () => {
  const text = renderHealthReport({
    checkedAt: '2026-08-17T12:00:00.000Z',
    coreUp: true,
    worst: 'OK',
    errors: [],
    lines: [
      {
        key: 'producers:unlisted',
        label: 'Other sources',
        value: '1 (graph-backfill)',
        threshold: 'no liveness expectation set',
        verdict: 'OK',
        detail: 'recording, but not monitored for liveness',
      },
    ],
  });

  // A diagnostic surface must be able to name a source it has no name for.
  expect(text).toContain('graph-backfill');
  expect(text).toContain('no liveness expectation set');
});

test('checks that could not be measured are named, never quietly dropped', () => {
  const text = renderHealthReport({
    checkedAt: '2026-08-17T12:00:00.000Z',
    coreUp: true,
    worst: 'OK',
    errors: ['producer liveness: database disk image is malformed'],
    lines: [
      { key: 'a', label: 'Recording', value: 'ready', threshold: 'starts with the app', verdict: 'OK' },
    ],
  });

  expect(text).toContain('Could not be measured');
  expect(text).toContain('database disk image is malformed');
});
