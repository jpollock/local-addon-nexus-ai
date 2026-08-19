/**
 * WP-43 · the host half of ADR-24's corroboration render — delivery.
 *
 * WP-34 built the convention and the join. WP-38 built the surface and pinned
 * eight properties of it. Between them sat a gap that nobody had priced until
 * the owner's 2026-08-19 comparator smoke read the chat screenshots: WP-34's
 * carrier turned the citation convention on PRODUCT-WIDE, so models cite; the
 * panel was never handed a turn's supply, so `msg.citation` was always absent;
 * and the parity branch that keeps an un-delivered turn byte-identical to the
 * pre-WP-38 build renders the reply through plain markdown. The consequence,
 * live, in every citing reply: raw `[[cite:…]]` markers as literal text.
 *
 * That leak is not a rendering bug — WP-38 chose it deliberately, and the
 * choice was right ("a renderer that stripped markers it was never told how to
 * resolve would hide the one fact worth reporting"). It is a DELIVERY hole, and
 * this module is the delivery.
 *
 * WHAT THIS FILE DOES: assemble the exact payload the renderer's `CitationTurn`
 * needs, minus the reply, out of what the platform already knows.
 *
 * WHAT IT MUST NEVER DO:
 *
 *  - **Derive anything the record already states.** The supply comes from
 *    `supplyFromBundle`, the manifest field comes off the manifest, and the
 *    moment comes from the surface. Nothing here inspects the reply, counts
 *    markers, or forms an opinion about whether a turn "looks cited" — that is
 *    the classifier ADR-24's render exists to not be, moved one layer down
 *    where it would be harder to see.
 *  - **Invent a moment.** See `CHAT_CITATION_MOMENT`.
 *  - **Deliver anything when the layer contributed nothing.** No assembly means
 *    no payload, which means `msg.citation` stays absent and the panel renders
 *    exactly as it did before this packet. That is the layer invariant, not a
 *    convenience: an intelligence-layer change that alters a surface for a user
 *    whose layer is degraded is a defect even when the tests pass.
 */
import { numberToolCalls } from '../../intelligence/citation/resolve';
import type {
  CitationSupply,
  SuppliedToolCall,
} from '../../intelligence/citation/resolve';
import type { ChatAssemblyResult } from './chatAssembly';

/**
 * The citation moment of the docked-panel chat surface: **Investigate**.
 *
 * Pin 4 of the sheet — "strictness comes from the moment, not the renderer" —
 * means somebody other than the renderer has to say which moment a surface is
 * in, and the host is the only party that knows what surface it is assembling
 * for. `chatAssembly.ts` already names it (`CHAT_SURFACE = 'chat.docked-panel'`)
 * for exactly this class of reason.
 *
 * Investigate, and not the other ruled moment, because `moments-model.md` M5
 * says it in its own words: center "the evidence chain — findings, incidents,
 * the claims-linked-to-records rendering", rank affinity "stage — this is
 * conversational work by nature". Glance is the other ruled moment and its
 * center is "pre-answered state" at ambient/companion rank; a glance "that
 * argues its sources is no longer a glance". Chat is the conversational
 * surface, so chat is where the evidence chain renders.
 *
 * THIS IS A CONSTANT OF THE SURFACE, NOT A FUNCTION OF THE ASK, and that is the
 * load-bearing half. Reading the moment off the user's message — "update
 * plugins" is Act-small, "why is checkout failing" is Investigate — would be a
 * classifier deciding how strictly a reply's evidence is rendered, i.e. the
 * renderer's forbidden judgement performed by the host on the model's behalf.
 * One surface, one moment, and a surface that later needs two of them gets the
 * second through the vocabulary loop.
 *
 * The value is pinned to be a member of the renderer's own `CITATION_MOMENTS`
 * union by `citationDelivery.test.ts`. Main and renderer cannot share a bundle,
 * so this is the same duplicated-rule shape as `localDay` and
 * `resolveAgentCron`/`effectiveCadenceExpression`, held together by a test that
 * imports both.
 */
export const CHAT_CITATION_MOMENT = 'investigate';

/**
 * What crosses the seam. Shaped as the renderer's `CitationTurn` minus `reply`
 * — the reply is the streamed text the panel already holds, and sending a
 * second copy of it would be two strings for one reply, which is the sheet's
 * own objection to copying a record into the chat turned on the chat itself.
 */
export interface CitationDelivery {
  supply: CitationSupply;
  /**
   * Always carries the `citation` KEY, explicitly, even when its value is null.
   *
   * `conventionState` distinguishes an absent key (`predates-convention`, the
   * legacy card) from a present-and-null one (`did-not-ride`, an ordinary turn
   * that carried no convention). A conditional spread here would make a live
   * turn print "this session predates the citation convention" the moment the
   * carrier went quiet, which is the exact lie WP-38's G1 split exists to
   * prevent — and it would do it through an omission nobody would see in a diff.
   */
  manifest: { citation: ChatAssemblyResult['citationManifest'] };
  moment: typeof CHAT_CITATION_MOMENT;
}

/**
 * The turn's delivery, or `null` when there is nothing honest to deliver.
 *
 * `toolCallNames` is the turn's tool calls IN CALL ORDER, and it is a parameter
 * for the reason `supplyFromBundle` states about its own: tool calls happen
 * after assembly, so the trace is the caller's. `numberToolCalls` — the join's
 * own function, not a second counter — turns the names into the `name#index`
 * addresses the convention cites. Per-tool numbering, from 1, because that is
 * what the address means.
 *
 * The assembler publishes `toolCalls: []` on its own supply and says why; this
 * REPLACES that empty list rather than concatenating, because the assembler's
 * emptiness is a statement about the assembly moment and the turn's real trace
 * is the answer to the same question at the end of the turn.
 */
export function citationDeliveryFor(
  assembly: ChatAssemblyResult | null | undefined,
  toolCallNames: readonly string[]
): CitationDelivery | null {
  if (!assembly) return null;
  const toolCalls: SuppliedToolCall[] = numberToolCalls(toolCallNames);
  return {
    supply: { ...assembly.citationSupply, toolCalls },
    manifest: { citation: assembly.citationManifest },
    moment: CHAT_CITATION_MOMENT,
  };
}
