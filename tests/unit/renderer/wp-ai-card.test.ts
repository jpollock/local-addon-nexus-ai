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

// v0.6.0 excision — permanent pin, added after the removal rather than driving
// it (the removal was driven by Task 4's IW absence test, which this overlaps).
// Non-vacuity was verified explicitly: these three assertions were run against
// the pre-excision NexusSiteTab.tsx at 66becbe9 and the first two FAILED there.
describe('connector picker offers two options (v0.6.0 excision)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../../src/renderer/components/NexusSiteTab.tsx'), 'utf8',
  );

  it("declares no 'power' connector", () => {
    expect(src).not.toMatch(/'power'/);
  });

  it('names neither WP Engine Power nor the Hub Plugin', () => {
    expect(src).not.toMatch(/WP Engine Power|Hub Plugin/);
  });

  it('still offers both retained connectors', () => {
    expect(src).toMatch(/'local-gateway'/);
    expect(src).toMatch(/'direct'/);
  });
});
