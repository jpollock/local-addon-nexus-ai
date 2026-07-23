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
