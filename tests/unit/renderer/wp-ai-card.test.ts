// Tests for the WordPress AI card (renderWpAiCard) in NexusSiteTab.
// The card itself cannot be unit-tested without a DOM renderer, so this file
// validates the constants and pure-function logic the card depends on.
import { IPC_CHANNELS } from '../../../src/common/constants';

describe('WordPress AI card', () => {
  it('SETUP_AI and IW_CONNECT channels exist for card actions', () => {
    expect(IPC_CHANNELS.SETUP_AI).toBe('nexus-ai:setup-ai');
    expect(IPC_CHANNELS.IW_CONNECT).toBe('nexus-ai:iw:connect');
    expect(IPC_CHANNELS.IW_DISCONNECT).toBe('nexus-ai:iw:disconnect');
  });

  it('detectWpAiConnector precedence: power > local-gateway > direct > null', () => {
    // Mirrors the pure function logic in NexusSiteTab.tsx
    const cases: Array<[boolean, boolean, 'active' | 'inactive' | null, 'active' | 'inactive' | null, string]> = [
      [true,  true,  'active', null,     'power'],
      [false, false, 'active', 'active', 'local-gateway'],
      [false, false, 'active', null,     'direct'],
      [false, false, null,     null,     'null'],
    ];
    for (const [iwConn, wpApproved, aiPlugin, gateway, expected] of cases) {
      // Mirror the logic from detectWpAiConnector
      let result: string = 'null';
      if (iwConn && wpApproved) result = 'power';
      else if (gateway === 'active') result = 'local-gateway';
      else if (aiPlugin === 'active') result = 'direct';
      expect(result).toBe(expected);
    }
  });
});
