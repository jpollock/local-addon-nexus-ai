/**
 * WP-38 · what reaches the screen — `from-designer-07-corroboration-render.md`
 * drawn, and every one of its "what is absent, and on purpose" list asserted as
 * an absence rather than trusted as an omission.
 *
 * `citationModel.test.ts` pins the derivations and the copy; this file pins the
 * RENDER: which face each state gets, where the door sits, what the panels say,
 * and the six things this surface may never contain.
 *
 * No jsdom: the component is instantiated and its `render()` called directly,
 * so the tree is inspected as data. Same technique as `procedureSurfaces.test
 * .tsx` — an element tree is what the assertions are about.
 */
import { CitationSpans, NO_RECORD_TITLE } from '../../../src/renderer/components/DockedPanel/CitationSpans';
import {
  PREDATES_CONVENTION_NOTICE,
  RECORD_DOOR_LABEL,
  UNRESOLVED_MALFORMED,
  UNRESOLVED_NOT_IN_SUPPLY,
  LEDGER_SEARCH_DOOR_LABEL,
} from '../../../src/renderer/components/DockedPanel/citationModel';
import {
  fixtureCitationTurn,
  legacyCitationTurn,
} from '../../../src/renderer/components/DockedPanel/citationTurn.fake';
import { serializeTree } from './helpers/serializeTree';

/** A markdown renderer that changes nothing, so assertions are about the tree. */
const md = (text: string) => `<p>${text}</p>`;

function spans(props: any = {}): any {
  return new (CitationSpans as any)({ turn: fixtureCitationTurn(), renderMarkdown: md, ...props });
}

function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  const children = node.children ?? node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) walk(k, out);
  return out;
}

function nodes(instance: any): any[] {
  return walk(serializeTree(instance.render()));
}

/** Every string anywhere in the rendered tree, joined. */
function allText(instance: any): string {
  return nodes(instance)
    .flatMap((n) => {
      const kids = n.children ?? [];
      const arr = Array.isArray(kids) ? kids : [kids];
      return arr.filter((k: any) => typeof k === 'string');
    })
    .concat(
      nodes(instance).map((n) => (n.props?.dangerouslySetInnerHTML?.__html ?? '') as string)
    )
    .join(' ');
}

function chips(instance: any): any[] {
  return nodes(instance).filter((n) => n.props && n.props['data-citation-state']);
}

// ---------------------------------------------------------------------------
// The three states
// ---------------------------------------------------------------------------

describe('the six spans, three states', () => {
  it('draws one chip per marker and none for the uncited glue', () => {
    // Six rows on the sheet, five markers: the glue row carries none. A sixth
    // chip would mean this surface classified a sentence.
    expect(chips(spans()).length).toBe(5);
  });

  it('gives each state its ratified face, one to one', () => {
    const drawn = chips(spans()).map((c) => [
      c.props['data-citation-state'],
      c.props['data-citation-face'],
    ]);
    expect(drawn).toEqual([
      ['cited-and-resolves', 'neutral-subtle'],
      ['cited-and-resolves', 'neutral-subtle'],
      ['cited-but-unresolvable', 'error-strong'],
      ['uncited-factual-claim', 'warning-subtle'],
      ['cited-and-resolves', 'neutral-subtle'],
    ]);
  });

  it('makes the unresolvable state the loudest thing on the surface', () => {
    // "A claim pointing at a record nobody supplied is worse than a claim
    // pointing at nothing: it looks like evidence." Loudest is measurable here:
    // it is the ONLY face that fills, and the only one that weights its text.
    const drawn = chips(spans());
    const loud = drawn.find((c) => c.props['data-citation-state'] === 'cited-but-unresolvable');
    const quiet = drawn.find((c) => c.props['data-citation-state'] === 'cited-and-resolves');
    const warn = drawn.find((c) => c.props['data-citation-state'] === 'uncited-factual-claim');
    expect(loud.props.style.background).toBe('var(--nxai-error-bg)');
    expect(loud.props.style.fontWeight).toBe(600);
    expect(quiet.props.style.background).toBe('transparent');
    expect(quiet.props.style.fontWeight).toBeUndefined();
    expect(warn.props.style.background).toBe('transparent');
    expect(warn.props.style.fontWeight).toBeUndefined();
  });

  it('puts the door where the sentence ENDS — trailing, never a superscript', () => {
    // Ruling §2, as geometry: each chip is the element immediately AFTER the run
    // holding its claim, in document order, and it is inline.
    const body = nodes(spans()).find((n) => n.props?.className === 'nexus-cite-body');
    const kids = body.children;
    const html = (k: any) => k?.props?.dangerouslySetInnerHTML?.__html ?? '';
    expect(html(kids[0])).toContain('Checkout has been returning 500s on Charlie');
    expect(kids[1].props['data-citation-state']).toBe('cited-and-resolves');
    expect(kids[1].children).toBe('evt_9c41');
    // inline, so it sits at the end of the line rather than under it
    expect(kids[1].props.style.display).toBe('inline');
    expect(kids[1].props.style.verticalAlign).toBe('baseline');
  });

  it('renders the derived tally, and derives it from the spans it counts', () => {
    const text = allText(spans());
    expect(text).toContain(
      '3 claims linked · 1 citation that does not resolve · 1 fact with nothing offered'
    );
  });

  it('carries the sheet’s own words for the third state as the chip’s title', () => {
    const warn = chips(spans()).find(
      (c) => c.props['data-citation-state'] === 'uncited-factual-claim'
    );
    expect(warn.props.title).toBe(NO_RECORD_TITLE);
    expect(NO_RECORD_TITLE).toBe('a fact with nothing offered for it');
    // and it is not a door: nothing opens, so nothing offers to be opened
    expect(warn.props.role).toBeUndefined();
    expect(warn.props.style.cursor).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// The panels
// ---------------------------------------------------------------------------

describe('the record peek', () => {
  function opened(index: number, props: any = {}): any {
    const c = spans(props);
    c.state = { openIndex: index };
    return c;
  }

  it('shows identity, topic and the derived supply sentence — and no contents', () => {
    const text = allText(opened(1));
    expect(text).toContain('evt_9c41');
    expect(text).toContain('incident.opened');
    expect(text).toContain('Supplied to this task by the ledger.');
    expect(text).toContain('A citation is a route, not a copy.');
  });

  it('never prints the record’s machine trust word', () => {
    // Ruling §3: the envelope's trust classes have never faced a user. The label
    // is inherited verbatim in the DATA (pinned in citationModel.test.ts) and
    // rendered nowhere.
    expect(allText(opened(1))).not.toContain('emitted');
  });

  it('offers the door only when something can open it', () => {
    expect(allText(opened(1))).not.toContain(RECORD_DOOR_LABEL);
    const handler = jest.fn();
    expect(allText(opened(1, { onOpenRecord: handler }))).toContain(RECORD_DOOR_LABEL);
  });

  it('opens nothing at all until a chip is clicked', () => {
    const text = allText(spans());
    expect(text).not.toContain('A citation is a route, not a copy.');
    expect(text).not.toContain(UNRESOLVED_NOT_IN_SUPPLY);
  });
});

describe('the unresolved panel', () => {
  it('states the limit verbatim and offers the ledger door when an id exists', () => {
    const c = spans({ onSearchLedger: jest.fn() });
    // index 5 is the third claim's chip — the sheet's unresolvable row
    const idx = nodesIndexOfState(c, 'cited-but-unresolvable');
    c.state = { openIndex: idx };
    const text = allText(c);
    expect(text).toContain(UNRESOLVED_NOT_IN_SUPPLY);
    expect(text).toContain(LEDGER_SEARCH_DOOR_LABEL);
  });

  it('is drawn in the loud face, not the panel’s ordinary one', () => {
    const c = spans();
    c.state = { openIndex: nodesIndexOfState(c, 'cited-but-unresolvable') };
    const panel = nodes(c).find((n) => n.props?.['data-citation-panel'] === 'unresolved');
    expect(panel.props.style.background).toBe('var(--nxai-error-bg)');
  });

  it('offers NO ledger door for a marker it could not read', () => {
    const c = spans({
      turn: fixtureCitationTurn({ reply: 'A claim. [[cite:???]]' }),
      onSearchLedger: jest.fn(),
    });
    c.state = { openIndex: nodesIndexOfState(c, 'cited-but-unresolvable') };
    const text = allText(c);
    expect(text).toContain(UNRESOLVED_MALFORMED);
    expect(text).not.toContain(LEDGER_SEARCH_DOOR_LABEL);
  });
});

function nodesIndexOfState(instance: any, state: string): number {
  const render = instance.render();
  const body = walk(serializeTree(render)).find((n) => n.props?.className === 'nexus-cite-body');
  const idx = body.children.findIndex((k: any) => k?.props?.['data-citation-state'] === state);
  if (idx < 0) throw new Error(`no chip in state ${state}`);
  return idx;
}

// ---------------------------------------------------------------------------
// The other ranks and the legacy state (§4b)
// ---------------------------------------------------------------------------

describe('the same facts at other ranks', () => {
  it('Glance renders no citations at all — no chips, no tally, no markers', () => {
    const c = spans({ turn: fixtureCitationTurn({ moment: 'glance' }) });
    expect(chips(c)).toEqual([]);
    const text = allText(c);
    expect(text).not.toContain('claims linked');
    expect(text).not.toContain('[[cite:');
    expect(text).toContain('Checkout has been returning 500s on Charlie');
  });

  it('a session from before the convention says so, and is not re-linked', () => {
    const c = spans({ turn: legacyCitationTurn() });
    expect(chips(c)).toEqual([]);
    const text = allText(c);
    expect(text).toContain(PREDATES_CONVENTION_NOTICE);
    expect(text).toContain('Read it as a transcript, not as evidence.');
    // the reply is still there, whole
    expect(text).toContain('payment-gateway-x was updated on the same site forty minutes earlier.');
  });

  it('a turn with no manifest gets NO legacy card — it says nothing instead', () => {
    // The lie this guards: an un-wired caller passes no record and the surface
    // announces that the session predates a convention.
    const c = spans({ turn: fixtureCitationTurn({ manifest: undefined }) });
    const text = allText(c);
    expect(text).not.toContain(PREDATES_CONVENTION_NOTICE);
    expect(chips(c)).toEqual([]);
    const root = serializeTree(c.render()) as any;
    expect(root.props['data-citation-render']).toBe('convention-unknown');
  });

  it('a turn that taught no convention gets no card either, and is distinguishable', () => {
    const c = spans({ turn: fixtureCitationTurn({ manifest: { citation: null } }) });
    expect(allText(c)).not.toContain(PREDATES_CONVENTION_NOTICE);
    expect((serializeTree(c.render()) as any).props['data-citation-render'])
      .toBe('convention-did-not-ride');
  });
});

// ---------------------------------------------------------------------------
// What is absent, and on purpose (the sheet's own list)
// ---------------------------------------------------------------------------

describe('what this surface may never contain', () => {
  const everything = () => {
    const drawn: string[] = [allText(spans())];
    for (let i = 0; i < 12; i++) {
      const c = spans({ onOpenRecord: jest.fn(), onSearchLedger: jest.fn() });
      c.state = { openIndex: i };
      drawn.push(allText(c));
    }
    return drawn.join(' ');
  };

  it('carries no confidence number, no percentage, no traffic light', () => {
    const text = everything();
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\bconfidence\b|\bscore\b|\bprobab/i);
  });

  it('carries no footnote list — every door sits at its own claim', () => {
    // A bibliography would be a run of chips with no prose between them at the
    // end of the reply. Measured structurally: no two chips are adjacent.
    const body = nodes(spans()).find((n) => n.props?.className === 'nexus-cite-body');
    const kinds = body.children.map((k: any) => (k?.props?.['data-citation-state'] ? 'chip' : 'text'));
    expect(kinds.join(',')).not.toContain('chip,chip');
    // and the last element is a chip belonging to the final claim, not a list
    expect(kinds[kinds.length - 1]).toBe('chip');
  });

  it('never renders a record’s contents', () => {
    // The supply carries a topic and a trust label and nothing else; if a peek
    // ever grew a body, this is the assertion that would have to be deleted.
    const c = spans({ onOpenRecord: jest.fn() });
    c.state = { openIndex: 1 };
    const panel = nodes(c).find((n) => n.props?.['data-citation-panel'] === 'record-peek');
    const strings = walk(panel)
      .flatMap((n) => (Array.isArray(n.children) ? n.children : [n.children]))
      .filter((s: any) => typeof s === 'string');
    expect(strings).toEqual([
      'evt_9c41',
      'incident.opened',
      'Supplied to this task by the ledger.',
      'A citation is a route, not a copy. The reply never renders the record’s contents — this is identity, trust label, and the door.',
      RECORD_DOOR_LABEL,
    ]);
  });

  it('never refuses: every claim of the reply is rendered, cited or not', () => {
    const text = allText(spans());
    for (const claim of [
      'Checkout has been returning 500s on Charlie',
      'The WooCommerce update landed at 02:07',
      'payment-gateway-x was updated on the same site',
      'Both sites that broke on a WooCommerce update before',
      'That points at the gateway rather than at WooCommerce itself',
      'The backup taken before the update is verified',
    ]) {
      expect(text).toContain(claim);
    }
  });

  it('authors no colour of its own — every value is a system token', () => {
    // The design-system note, as a test: "No fill, ring or text colour is
    // authored on the sheet." A hex literal here would be an off-system
    // override at the exact spot where trust is the subject.
    const source = require('fs').readFileSync(
      require('path').join(
        __dirname, '..', '..', '..',
        'src', 'renderer', 'components', 'DockedPanel', 'CitationSpans.tsx'
      ),
      'utf8'
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);
  });
});
