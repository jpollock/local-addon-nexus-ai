import { OpportunisticScheduler } from '../../../src/main/scheduler/OpportunisticScheduler';

jest.useFakeTimers();

function makeDeps(overrides: any = {}) {
  const mockExecute = jest.fn().mockReturnValue('op-1');
  return {
    bulkOpManager: { execute: mockExecute } as any,
    siteData: { getSites: jest.fn().mockReturnValue({ 'site-1': { id: 'site-1', name: 'Site 1' } }) } as any,
    getSettings: jest.fn().mockReturnValue({
      localContentIndexAutoEnabled: true,
      localContentIndexIntervalHours: 8,
      excludedSiteIds: [],
    }),
    buildSiteNames: jest.fn().mockReturnValue({ 'site-1': 'Site 1' }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
});

test('fires execute after configured interval', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps();
  scheduler.start(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(deps.bulkOpManager.execute).toHaveBeenCalledWith(expect.objectContaining({
    type: 'reindex',
    options: expect.objectContaining({ autoStartStop: true }),
  }));
  scheduler.stop();
});

test('does not fire when autoEnabled is false', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps({
    getSettings: jest.fn().mockReturnValue({
      localContentIndexAutoEnabled: false,
      localContentIndexIntervalHours: 8,
      excludedSiteIds: [],
    }),
  });
  scheduler.start(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(deps.bulkOpManager.execute).not.toHaveBeenCalled();
  scheduler.stop();
});

test('excludes sites in excludedSiteIds', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps({
    getSettings: jest.fn().mockReturnValue({
      localContentIndexAutoEnabled: true,
      localContentIndexIntervalHours: 8,
      excludedSiteIds: ['site-1'],
    }),
  });
  scheduler.start(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  // site-1 excluded → no eligible sites → execute not called
  expect(deps.bulkOpManager.execute).not.toHaveBeenCalled();
  scheduler.stop();
});

test('stop prevents timer from firing', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps();
  scheduler.start(deps);
  scheduler.stop();
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(deps.bulkOpManager.execute).not.toHaveBeenCalled();
});

test('restart re-arms after stop', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps();
  scheduler.start(deps);
  scheduler.stop();
  scheduler.restart(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(deps.bulkOpManager.execute).toHaveBeenCalledTimes(1);
  scheduler.stop();
});
