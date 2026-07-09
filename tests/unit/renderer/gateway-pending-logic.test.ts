/**
 * Tests for the gatewayPending display logic in SiteNexusSection / NexusSiteTab.
 *
 * The condition is:
 *   gatewayPending = useLocalGateway && !gatewayActive && isAIConfigured
 *
 * Before the fix it was:
 *   gatewayPending = useLocalGateway && !gatewayActive
 *
 * Which caused "Pending" to show when gateway was on globally but AI was not
 * configured on the site — the badge was misleading because there was nothing
 * to apply the gateway TO.
 */

function gatewayPending(useLocalGateway: boolean, gatewayActive: boolean, isAIConfigured: boolean): boolean {
  return useLocalGateway && !gatewayActive && isAIConfigured;
}

function gatewayLabel(useLocalGateway: boolean, gatewayActive: boolean, isAIConfigured: boolean): string {
  const pending = gatewayPending(useLocalGateway, gatewayActive, isAIConfigured);
  return gatewayActive ? 'Active' : pending ? 'Pending' : 'Inactive';
}

describe('gatewayPending display logic', () => {
  test('shows Inactive (not Pending) when gateway is on globally but AI is not configured on site', () => {
    // This was the bug: badge showed "Pending" with an Apply button even though
    // there was no AI provider configured to apply it to.
    expect(gatewayPending(true, false, false)).toBe(false);
    expect(gatewayLabel(true, false, false)).toBe('Inactive');
  });

  test('shows Pending when gateway is on, not yet active, and AI IS configured', () => {
    expect(gatewayPending(true, false, true)).toBe(true);
    expect(gatewayLabel(true, false, true)).toBe('Pending');
  });

  test('shows Active when gateway is active regardless of AI config', () => {
    expect(gatewayPending(true, true, true)).toBe(false);
    expect(gatewayLabel(true, true, true)).toBe('Active');
    expect(gatewayLabel(true, true, false)).toBe('Active');
  });

  test('shows Inactive when gateway is globally off', () => {
    expect(gatewayPending(false, false, true)).toBe(false);
    expect(gatewayLabel(false, false, true)).toBe('Inactive');
    expect(gatewayLabel(false, false, false)).toBe('Inactive');
  });
});
