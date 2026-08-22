/**
 * WP-67 — the external SSH adapter is the fourth instance of the same shape.
 *
 * `ExternalContentIndexService.indexOne` marks a zero-post host 'indexed' and
 * returns `{documentCount: 0}` — structurally identical to WP Engine's
 * zero-post exit, and it would report as a success for the same reason. The
 * three external hosts in the 2026-08-22 run genuinely had content, so this
 * path did not misreport that day; it would have on any host that did not.
 *
 * Its own file because the transport and index service are mocked, and the
 * sibling suite drives the real WPESyncService through the real transport
 * module.
 */
jest.mock('../../../src/main/transport', () => ({
  resolveTransport: jest.fn(async () => ({ runWpCli: jest.fn() })),
}));

const indexOne = jest.fn();
jest.mock('../../../src/main/events/ExternalContentIndexService', () => ({
  ExternalContentIndexService: jest.fn().mockImplementation(() => ({ indexOne })),
}));

jest.mock('../../../src/main/startup/ExternalContentIndexScheduler', () => ({
  ensureContentIndexedAtColumn: jest.fn(() => false),
}));

import { createExternalBulkOps } from '../../../src/main/bulk/externalBulkOps';

const SITE_ID = 'ssh:hostinger-test/palegreen-capybara-114180';

function makeOps(name: string | null = 'palegreen-capybara-114180') {
  const row = { id: SITE_ID, name, environment: 'production' };
  const services: any = {
    graphService: { getDb: () => ({ prepare: () => ({ get: () => row, run: jest.fn() }) }) },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return createExternalBulkOps(services, logger);
}

describe('WP-67 — external host index reports what it observed', () => {
  beforeEach(() => indexOne.mockReset());

  test('a host that indexed documents is reported as having run', async () => {
    indexOne.mockResolvedValue({ documentCount: 85 });

    const outcome = await makeOps().indexSite(SITE_ID);

    expect(outcome).toEqual({ ran: true });
  });

  test('a host reached with zero documents is did-not-run, not a success', async () => {
    indexOne.mockResolvedValue({ documentCount: 0 });

    const outcome = await makeOps().indexSite(SITE_ID);

    expect(outcome.ran).toBe(false);
    expect(outcome).toHaveProperty('reason');
  });

  /**
   * WP-68. The sibling of the WP Engine name check. `indexOne` labels its work
   * with the row's name, and the id is not a substitute for it — the same
   * reasoning that made an id-as-name reach `WpeSshTransport`.
   */
  test('a row with no name is refused, and the index service is never reached', async () => {
    indexOne.mockResolvedValue({ documentCount: 5 });

    await expect(makeOps(null).indexSite(SITE_ID)).rejects.toThrow('no site name in the graph');
    expect(indexOne).not.toHaveBeenCalled();
  });

  test('a row with a blank name is refused too', async () => {
    indexOne.mockResolvedValue({ documentCount: 5 });

    await expect(makeOps('   ').indexSite(SITE_ID)).rejects.toThrow('no site name in the graph');
    expect(indexOne).not.toHaveBeenCalled();
  });
});
