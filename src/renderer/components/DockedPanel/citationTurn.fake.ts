/**
 * WP-38 · the corroboration render's fixture turn — a SOURCE, never a shape.
 *
 * The host half of this seam (delivering a turn's `citationSupply` and its
 * manifest to the renderer) belongs to a packet holding the intelligence-host
 * lock; WP-34 already publishes `citationSupply` on `ChatAssemblyResult`, so
 * what is missing is delivery, not derivation. This module is the same answer
 * WP-27 gave for the procedure stream: build the surface against literal fixture
 * data, and pin that data to its real source so it cannot drift.
 *
 * The data is `from-designer-07-corroboration-render.md` §4a — six spans, three
 * states — reached through WP-34's committed adherence fixture
 * (`docs/intelligence/design-fixtures/citation-spans.json`), which is itself
 * regenerated from the sheet's own table and pinned to it row for row. So the
 * chain is: the designer's markdown → WP-34's generator → the committed fixture
 * → these literals, with a test at every link. `citationFixture.test.ts` pins
 * the last one BYTE for byte.
 *
 * Literals rather than a JSON import for the reason `procedureStream.fake.ts`
 * states about its own: this module is importable from the renderer during
 * development, and a renderer that reads a repo file at runtime has no repo.
 */
import type { CitationSupply, CitationTurn } from './citationModel';

/** The reply, exactly as the sheet's model wrote it. */
export const FIXTURE_REPLY = [
  'Checkout has been returning 500s on Charlie since 02:14 this morning. [[cite:evt_9c41]]',
  '',
  'The WooCommerce update landed at 02:07, seven minutes before the first error. [[cite:evt_8f21]]',
  '',
  'payment-gateway-x was updated on the same site forty minutes earlier. [[cite:evt_8e90]]',
  '',
  'Both sites that broke on a WooCommerce update before were running that same gateway version. [[cite:none]]',
  '',
  'That points at the gateway rather than at WooCommerce itself, but I have not proved it.',
  '',
  'The backup taken before the update is verified and fourteen minutes older than the failure. [[cite:tool:wpe_backup_and_verify#2]]',
].join('\n');

/**
 * ADR-24 P1's universe for this turn.
 *
 * `evt_8e90` is deliberately ABSENT — it is the sheet's third row, the citation
 * that does not resolve, and the whole reason the loudest state exists. The
 * second `wpe_backup_and_verify` call is present and the first is too, because
 * the address is per-tool call index and a supply carrying only the second would
 * make the numbering untestable.
 */
export const FIXTURE_SUPPLY: CitationSupply = {
  events: [
    { id: 'evt_9c41', topic: 'incident.opened', trust: 'emitted' },
    { id: 'evt_8f21', topic: 'task.action.executed', trust: 'emitted' },
  ],
  toolCalls: [
    { name: 'wpe_backup_and_verify', index: 1 },
    { name: 'wpe_backup_and_verify', index: 2 },
  ],
  carrierLines: [{ key: 'freshness' }, { key: 'retrieved' }],
};

/**
 * The turn as the M5 stage sees it: the convention in effect, at Investigate.
 *
 * The convention hash is `cnv_6c2b11952046` — WP-34's ratified block, named
 * rather than invented, so a fixture cannot claim a convention that never
 * shipped.
 */
export const fixtureCitationTurn = (over: Partial<CitationTurn> = {}): CitationTurn => ({
  reply: FIXTURE_REPLY,
  supply: FIXTURE_SUPPLY,
  manifest: { citation: { convention: 'cnv_6c2b11952046', asserted: 'full' } },
  moment: 'investigate',
  ...over,
});

/**
 * A turn from before the convention existed: the manifest has no `citation` key
 * at all. Written with a delete rather than as an object literal so the absence
 * is a real absence and not a key holding `undefined` — which is a different
 * fact, and one `conventionState` reads differently on purpose.
 */
export const legacyCitationTurn = (): CitationTurn => {
  const manifest: { citation?: never } = {};
  return { reply: FIXTURE_REPLY, supply: FIXTURE_SUPPLY, manifest, moment: 'investigate' };
};
