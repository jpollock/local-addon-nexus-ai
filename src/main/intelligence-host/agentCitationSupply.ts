/**
 * WP-57 · What an agent run made citable.
 *
 * ADR-24 P1 fixes the universe as "the manifest and the trace, and nothing
 * else". A chat turn has both — `supplyFromBundle` reads its retrieval and its
 * carrier. An agent run today has only the trace: the assembler does not reach
 * the agent path until phase 4 of the agent-actor note, so there is no bundle
 * to read and no carrier to cite.
 *
 * **That is the honest universe, not a degraded one.** A finding's warrant is
 * what the run actually observed, and what it observed is what it called.
 *
 * WHY THIS IS NOT A SECOND DERIVATION (P5). The addresses are numbered by
 * `numberToolCalls` — the same function `citationDelivery` uses for chat — and
 * resolved by `resolveCitations`, the same join the judge and the renderer
 * use. This module contributes no matching logic of its own; it assembles the
 * one shape both sides already agree on. A second numbering here is precisely
 * the defect ADR-24 P5 names: the judge and the user looking at two different
 * universes.
 *
 * WHY IT MATTERS MOST HERE. The WP-25 smoke caught security-sentinel's
 * *fabricated remediation checklist* — model-authored prose that no record
 * supported. That happened on the unattended path, where nobody is watching
 * when the claim is made. `cited-but-unresolvable` is the loudest state in the
 * contract, and this is the surface that most needs it to fire.
 */
import {
  numberToolCalls,
  type CitationSupply,
} from '../../intelligence/citation/resolve';

/**
 * The citable universe of one agent run.
 *
 * @param toolCallNames every tool the run REACHED, in call order. A call
 *   refused by scope, by the Tier-3 gate or by the sequence guard must not
 *   appear: it observed nothing, and citing it would warrant a claim with a
 *   non-event. `NexusToolProvider` collects these past its gates for exactly
 *   that reason.
 */
export function supplyFromAgentRun(toolCallNames: readonly string[]): CitationSupply {
  return {
    // Empty rather than absent, both of them. "This run retrieved no ledger
    // record" and "this run rendered no carrier" are true statements about an
    // agent run; an omitted field would instead read as "citation does not
    // apply here", which is the opposite of what this packet is for.
    events: [],
    carrierLines: [],
    toolCalls: numberToolCalls(toolCallNames),
  };
}
