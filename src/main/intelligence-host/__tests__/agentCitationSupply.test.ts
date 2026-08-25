/**
 * WP-57 · An agent run's citable universe.
 *
 * ADR-24's P1 says the universe is "the manifest and the trace, and nothing
 * else". An agent run has no manifest yet (the assembler reaches it in phase 4
 * of the agent-actor note), so its universe is exactly ITS OWN TOOL CALLS —
 * and that is the honest answer, not a placeholder: a finding's warrant is
 * what the run actually observed.
 *
 * What these assertions defend:
 *
 *   - **ONE derivation, not two (P5).** Addresses are numbered by the SAME
 *     `numberToolCalls` chat uses and resolved by the SAME `resolveCitations`,
 *     so the judge and the user cannot end up looking at different universes.
 *     A second numbering here would be the defect ADR-24 names by name.
 *   - **The universe is closed.** A finding citing a tool the run never called
 *     is `cited-but-unresolvable` — the loudest state — not quietly accepted.
 *     On the unattended path nobody was watching when the claim was made, so
 *     this is the whole point.
 *   - **Refused calls are not supply.** A tool the agent was refused did not
 *     observe anything, and citing it would warrant a claim with a
 *     non-event.
 */
import {
  resolveCitations,
  type CitationSupply,
} from '../../../intelligence/citation/resolve';
import { supplyFromAgentRun } from '../agentCitationSupply';

describe('WP-57 · supplyFromAgentRun', () => {
  it('numbers each tool\'s own calls from 1, as the convention addresses them', () => {
    const supply = supplyFromAgentRun(['wp_plugin_list', 'wp_user_list', 'wp_plugin_list']);

    expect(supply.toolCalls).toEqual([
      { name: 'wp_plugin_list', index: 1 },
      { name: 'wp_user_list', index: 1 },
      { name: 'wp_plugin_list', index: 2 },
    ]);
  });

  it('has no events and no carrier lines — an agent run has neither', () => {
    const supply = supplyFromAgentRun(['wp_plugin_list']);

    // Publishing them EMPTY rather than omitting them keeps the shape honest:
    // "this run supplied no ledger retrieval" is a true statement, where an
    // absent field would read as "citation does not apply here".
    expect(supply.events).toEqual([]);
    expect(supply.carrierLines).toEqual([]);
  });

  it('is empty, not undefined, for a run that called nothing', () => {
    const supply = supplyFromAgentRun([]);
    expect(supply).toEqual({ events: [], toolCalls: [], carrierLines: [] });
  });
});

describe('WP-57 · findings resolve against the run they came from', () => {
  const supply: CitationSupply = supplyFromAgentRun([
    'wp_plugin_list',
    'scan_site_files',
    'wp_plugin_list',
  ]);

  it('a finding citing a call the run made RESOLVES', () => {
    const [r] = resolveCitations(
      'Known backdoor plugin detected [[cite:tool:wp_plugin_list#2]]',
      supply,
    );
    expect(r.state).toBe('cited-and-resolves');
  });

  it('a finding citing a tool the run never called is UNRESOLVABLE, loudly', () => {
    const [r] = resolveCitations(
      'Database contains injected admin users [[cite:tool:wp_user_list#1]]',
      supply,
    );
    // The WP-25 failure, typed: model-authored prose asserting something no
    // record supports. It must not pass quietly.
    expect(r.state).toBe('cited-but-unresolvable');
    expect(r).toMatchObject({ reason: 'not-in-supply' });
  });

  it('a finding citing a call INDEX the run never reached is unresolvable', () => {
    const [r] = resolveCitations('Third scan showed x [[cite:tool:scan_site_files#2]]', supply);
    // scan_site_files was called ONCE. #2 names a record that does not exist,
    // and an index is exactly the kind of detail a model invents fluently.
    //
    // The REASON is asserted, not just the state: the first draft of this test
    // used the wrong marker syntax and passed as `malformed` — green for a
    // reason that had nothing to do with the supply. A state assertion alone
    // cannot tell "the universe refused it" from "I typo'd the fixture".
    expect(r).toMatchObject({ state: 'cited-but-unresolvable', reason: 'not-in-supply' });
  });

  it('an uncited claim is its own state, never silently fine', () => {
    const [r] = resolveCitations('The site is compromised [[cite:none]]', supply);
    expect(r.state).toBe('uncited-factual-claim');
  });
});
