// Tests for the WordPress AI card (renderWpAiCard) in NexusSiteTab.
// The card itself cannot be unit-tested without a DOM renderer, so this file
// validates the constants and pure-function logic the card depends on.
import { IPC_CHANNELS } from '../../../src/common/constants';

describe('WordPress AI card', () => {
  it('SETUP_AI channel exists for card actions', () => {
    expect(IPC_CHANNELS.SETUP_AI).toBe('nexus-ai:setup-ai');
  });

  // NOTE: this file previously also carried a "detectWpAiConnector precedence"
  // case. It was vacuous — it re-implemented the precedence inline and asserted
  // against its own copy, so it could never fail for a production change. It is
  // deleted rather than updated for the two-connector world: a tautology that
  // tracks the implementation is worse than no test, because it reads as cover.
});
