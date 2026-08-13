/**
 * @jest-environment jsdom
 */
import {
  hasAcknowledgedAgentDataDisclosure,
  acknowledgeAgentDataDisclosure,
  shouldShowAgentDataDisclosure,
} from '../../../src/renderer/components/agents/agentDataDisclosure';

describe('agent data-flow disclosure (P0-5, one-time)', () => {
  beforeEach(() => localStorage.clear());

  it('shows only when enabling and not yet acknowledged', () => {
    expect(shouldShowAgentDataDisclosure(true, false)).toBe(true);
    expect(shouldShowAgentDataDisclosure(false, false)).toBe(false); // disabling never discloses
    expect(shouldShowAgentDataDisclosure(true, true)).toBe(false); // already acknowledged
  });

  it('persists acknowledgment so it only ever shows once', () => {
    expect(hasAcknowledgedAgentDataDisclosure()).toBe(false);
    acknowledgeAgentDataDisclosure();
    expect(hasAcknowledgedAgentDataDisclosure()).toBe(true);
    expect(shouldShowAgentDataDisclosure(true, hasAcknowledgedAgentDataDisclosure())).toBe(false);
  });
});
