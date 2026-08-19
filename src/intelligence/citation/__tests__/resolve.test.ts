/**
 * WP-34 · the claim→record join — ONE join, two consumers (ADR-24 P5).
 *
 * This suite is the eval sheet's and the future renderer's shared contract. It
 * pins the two things the note makes load-bearing:
 *
 *  - EXISTENCE is verified; SUPPORT never is (P1/P4). Nothing here reads the
 *    claim text, compares it to a record, or scores a similarity. The join
 *    answers one question: was this id supplied to this task?
 *  - The three ADR-24 states are distinguishable IN THE RETURN SHAPE. A
 *    consumer must never have to match a string to tell a citation that
 *    resolves from one that does not — `state` is a discriminant, and the
 *    payload differs per arm so the compiler enforces the distinction.
 */
import {
  numberToolCalls,
  parseCitations,
  resolveCitations,
  tallyCitations,
  CITATION_STATES,
} from '../resolve';

const SUPPLY = {
  events: [
    { id: 'evt_9c41', topic: 'episodic.incident.recorded', trust: 'emitted' },
    { id: 'evt_8f21', topic: 'task.action.executed', trust: 'emitted' },
  ],
  toolCalls: [{ name: 'wpe_backup_and_verify', index: 1 }, { name: 'wpe_backup_and_verify', index: 2 }],
  carrierLines: [{ key: 'freshness' }, { key: 'retrieved' }],
};

describe('parseCitations — the grammar', () => {
  it('parses the four forms and nothing else', () => {
    const text =
      'a [[cite:evt_9c41]] b [[cite:tool:wpe_backup_and_verify#2]] ' +
      'c [[cite:carrier:freshness]] d [[cite:none]]';
    expect(parseCitations(text).map((c) => c.ref)).toEqual([
      { kind: 'event', eventId: 'evt_9c41' },
      { kind: 'tool', tool: 'wpe_backup_and_verify', callIndex: 2 },
      { kind: 'carrier', line: 'freshness' },
      { kind: 'none' },
    ]);
  });

  it('reports offsets so a door can be placed where the claim ends', () => {
    const text = 'Checkout has been failing. [[cite:evt_9c41]]';
    const [c] = parseCitations(text);
    expect(text.slice(c.start, c.end)).toBe('[[cite:evt_9c41]]');
    expect(c.marker).toBe('[[cite:evt_9c41]]');
  });

  it('a body that does not parse is a citation with a null ref, never a silent drop', () => {
    const parsed = parseCitations('claim [[cite:the incident report]]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].ref).toBeNull();
    expect(parsed[0].body).toBe('the incident report');
  });

  it('ignores text that is not a marker — user content cannot become a citation', () => {
    // A wiki link, a shortcode, a bare id in prose, and a marker with spaces
    // inside the brackets: none of these is the convention.
    const text =
      '[[Some Page]] [gallery id="4"] evt_9c41 [[ cite:evt_9c41 ]] [[cite:evt_9c41';
    expect(parseCitations(text)).toEqual([]);
  });

  it('does not span a newline, so an unclosed marker cannot swallow the reply', () => {
    expect(parseCitations('[[cite:evt_9c41\nnext line]]')).toEqual([]);
  });

  it('a zero or negative call index does not parse — calls count from 1', () => {
    expect(parseCitations('[[cite:tool:wp_plugin_list#0]]')[0].ref).toBeNull();
    expect(parseCitations('[[cite:tool:wp_plugin_list#-1]]')[0].ref).toBeNull();
  });
});

describe('resolveCitations — existence, and only existence', () => {
  it('a supplied event id resolves, and carries the record verbatim', () => {
    const [r] = resolveCitations('Checkout broke. [[cite:evt_9c41]]', SUPPLY);
    expect(r.state).toBe('cited-and-resolves');
    if (r.state !== 'cited-and-resolves') throw new Error('unreachable');
    expect(r.record).toEqual({
      kind: 'event',
      id: 'evt_9c41',
      topic: 'episodic.incident.recorded',
      trust: 'emitted',
    });
  });

  it('an id NOT in the task supply is unresolvable — the loudest state', () => {
    const [r] = resolveCitations('Gateway updated. [[cite:evt_8e90]]', SUPPLY);
    expect(r.state).toBe('cited-but-unresolvable');
    if (r.state !== 'cited-but-unresolvable') throw new Error('unreachable');
    expect(r.reason).toBe('not-in-supply');
    expect(r.ref).toEqual({ kind: 'event', eventId: 'evt_8e90' });
  });

  it('a malformed body is unresolvable for a DIFFERENT recorded reason', () => {
    const [r] = resolveCitations('Something. [[cite:the incident report]]', SUPPLY);
    expect(r.state).toBe('cited-but-unresolvable');
    if (r.state !== 'cited-but-unresolvable') throw new Error('unreachable');
    expect(r.reason).toBe('malformed');
    expect(r.ref).toBeNull();
  });

  it('a tool call of this task resolves by name AND index', () => {
    const [ok] = resolveCitations('x [[cite:tool:wpe_backup_and_verify#2]]', SUPPLY);
    expect(ok.state).toBe('cited-and-resolves');
    const [tooFar] = resolveCitations('x [[cite:tool:wpe_backup_and_verify#3]]', SUPPLY);
    expect(tooFar.state).toBe('cited-but-unresolvable');
    const [wrongTool] = resolveCitations('x [[cite:tool:wp_plugin_list#1]]', SUPPLY);
    expect(wrongTool.state).toBe('cited-but-unresolvable');
  });

  it('a carrier line resolves only when that section actually rode this turn', () => {
    expect(resolveCitations('x [[cite:carrier:freshness]]', SUPPLY)[0].state).toBe(
      'cited-and-resolves'
    );
    expect(resolveCitations('x [[cite:carrier:procedure]]', SUPPLY)[0].state).toBe(
      'cited-but-unresolvable'
    );
  });

  it('[[cite:none]] is the third state — never a resolution, never a failure', () => {
    const [r] = resolveCitations('Both sites ran that version. [[cite:none]]', SUPPLY);
    expect(r.state).toBe('uncited-factual-claim');
  });

  it('the three states are exactly ADR-24’s three', () => {
    expect(CITATION_STATES).toEqual([
      'cited-and-resolves',
      'cited-but-unresolvable',
      'uncited-factual-claim',
    ]);
  });

  it('NEVER verifies support: a resolving citation on a contradicted claim still resolves', () => {
    // The record's topic says an incident was RECORDED; the claim says it was
    // resolved. The join has no opinion — P4 reserves that for the eval.
    const [r] = resolveCitations(
      'The incident was fully remediated overnight. [[cite:evt_9c41]]',
      SUPPLY
    );
    expect(r.state).toBe('cited-and-resolves');
  });

  it('an empty supply resolves nothing, and says so per citation', () => {
    const rs = resolveCitations('a [[cite:evt_9c41]] b [[cite:tool:x#1]]', {
      events: [],
      toolCalls: [],
      carrierLines: [],
    });
    expect(rs.map((r) => r.state)).toEqual([
      'cited-but-unresolvable',
      'cited-but-unresolvable',
    ]);
  });

  it('a reply with no markers produces no resolutions — uncited is not an error', () => {
    expect(resolveCitations('That points at the gateway, but I have not proved it.', SUPPLY))
      .toEqual([]);
  });
});

describe('numberToolCalls — the index counts THAT TOOL\'s calls, not the task\'s', () => {
  it('numbers each tool independently, in call order', () => {
    // ADR-24 fixes the address as "tool name + call index". A task-wide counter
    // would make `wp_plugin_list#3` mean the third call OF THE TASK — a
    // different record from the third call of that tool, and one a reader
    // cannot check without counting every other tool's calls too.
    expect(numberToolCalls(['a', 'b', 'a', 'c', 'a'])).toEqual([
      { name: 'a', index: 1 },
      { name: 'b', index: 1 },
      { name: 'a', index: 2 },
      { name: 'c', index: 1 },
      { name: 'a', index: 3 },
    ]);
  });

  it('resolves the SECOND call of a tool that ran after another tool', () => {
    const supply = {
      events: [],
      toolCalls: numberToolCalls(['wp_plugin_list', 'nexus_list_sites', 'wp_plugin_list']),
      carrierLines: [],
    };
    expect(resolveCitations('x [[cite:tool:wp_plugin_list#2]]', supply)[0].state).toBe(
      'cited-and-resolves'
    );
    // ...and there is no third call of it, however many calls the task made.
    expect(resolveCitations('x [[cite:tool:wp_plugin_list#3]]', supply)[0].state).toBe(
      'cited-but-unresolvable'
    );
  });
});

describe('tallyCitations', () => {
  it('counts by state, and counts every state even at zero', () => {
    const rs = resolveCitations(
      'a [[cite:evt_9c41]] b [[cite:evt_8f21]] c [[cite:evt_8e90]] d [[cite:none]]',
      SUPPLY
    );
    expect(tallyCitations(rs)).toEqual({
      'cited-and-resolves': 2,
      'cited-but-unresolvable': 1,
      'uncited-factual-claim': 1,
    });
  });
});
