import { iwFleetStatusHandler } from '../../../src/main/mcp/modules/iw/fleet-tools';

describe('iw_fleet_status tool definition', () => {
  it('has correct name', () => {
    expect(iwFleetStatusHandler.definition.name).toBe('iw_fleet_status');
  });

  it('has no required fields — works across all sites', () => {
    expect((iwFleetStatusHandler.definition.inputSchema as any).required ?? []).toHaveLength(0);
  });
});
