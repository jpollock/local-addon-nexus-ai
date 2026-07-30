/**
 * Compile-check test for the AGENT_RUN_NOW enabled guard.
 *
 * getAgentSetting reads from module-level agentSettingsCache state that cannot
 * be seeded in isolation without the full IPC registration flow. This test
 * verifies the export exists and is callable — full integration coverage is
 * handled by e2e tests.
 */
describe('AGENT_RUN_NOW enabled guard', () => {
  it('exports getAgentSetting as a callable function', async () => {
    const { getAgentSetting } = await import('../../../src/main/ipc-handlers');
    expect(typeof getAgentSetting).toBe('function');
  });

  it('getAgentSetting returns true by default (permissive before settings sync)', async () => {
    const { getAgentSetting } = await import('../../../src/main/ipc-handlers');
    // Before any settings are synced the cache is empty — default is true (allow)
    expect(getAgentSetting('some-unknown-agent', 'enabled')).toBe(true);
  });
});

describe('seedAgentDefaultsIfMissing', () => {
  // This is what let security-sentinel run a fleet-wide sweep every 15 minutes for
  // weeks unattended: getAgentSetting's permissive `?? true` default meant a
  // never-configured agent's hardcoded cron/event triggers fired immediately.
  // seedAgentDefaultsIfMissing must persist scheduleEnabled:false/eventsEnabled:false
  // for any agent with no prior settings, before its triggers are ever wired.
  jest.mock('fs');

  function mockFs(existingFileContent: string | null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    fs.readFileSync = jest.fn().mockImplementation(() => {
      if (existingFileContent === null) throw new Error('ENOENT');
      return existingFileContent;
    });
    fs.writeFileSync = jest.fn();
    fs.mkdirSync = jest.fn();
    return fs;
  }

  afterEach(() => {
    jest.resetModules();
  });

  it('seeds a brand-new agent with scheduleEnabled:false and eventsEnabled:false (opt-in, not opt-out)', async () => {
    const fs = mockFs(null); // no settings file yet — first run
    const { seedAgentDefaultsIfMissing } = await import('../../../src/main/ipc-handlers');

    seedAgentDefaultsIfMissing(['brand-new-agent']);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written['brand-new-agent']).toEqual({
      enabled: true, scheduleEnabled: false, eventsEnabled: false, autonomy: 'ask',
    });
  });

  it('never overwrites an agent that already has persisted settings', async () => {
    const fs = mockFs(JSON.stringify({
      'security-sentinel': { enabled: true, scheduleEnabled: true, eventsEnabled: true, autonomy: 'auto' },
    }));
    const { seedAgentDefaultsIfMissing } = await import('../../../src/main/ipc-handlers');

    seedAgentDefaultsIfMissing(['security-sentinel']);

    // No new agent to seed — the existing, already-configured entry must be untouched
    // and the file must not be rewritten at all.
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('seeds only the missing agents when some already have settings', async () => {
    const fs = mockFs(JSON.stringify({
      'existing-agent': { enabled: true, scheduleEnabled: true, eventsEnabled: true, autonomy: 'auto' },
    }));
    const { seedAgentDefaultsIfMissing } = await import('../../../src/main/ipc-handlers');

    seedAgentDefaultsIfMissing(['existing-agent', 'new-agent']);

    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written['existing-agent']).toEqual({ enabled: true, scheduleEnabled: true, eventsEnabled: true, autonomy: 'auto' });
    expect(written['new-agent']).toEqual({ enabled: true, scheduleEnabled: false, eventsEnabled: false, autonomy: 'ask' });
  });
});
