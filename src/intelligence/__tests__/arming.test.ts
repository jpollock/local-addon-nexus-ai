/**
 * WP-20b · Arming — the three deterministic recognition paths of P1.
 *
 * The one property every case below defends: **arming never asks a model.**
 * Path A is a lexical predicate authored in the runbook, Path B is the model
 * asking by name, Path C is the gate refusing instead of improvising. Nothing
 * here classifies intent, and nothing here may become probabilistic — a gate
 * that decides whether safety ceremony applies must give the same answer for
 * the same words every time (design note §1, rejected option: intent
 * classification).
 *
 * Three rules, each with cases:
 *
 *  1. **Deterministic and authored.** The verb set and the subject set come
 *     from the runbook's own `arms_on:`. No stemming, no synonyms, no
 *     inference: an under-firing predicate is a RULED-TOLERABLE failure mode
 *     (Paths B and C remain), while a predicate that guesses is a gate whose
 *     behaviour nobody can reproduce.
 *  2. **Ambiguity refuses to pick.** Two runbooks arming on one turn arms
 *     NEITHER. A coin toss between two strict procedures is worse than none —
 *     the same ruling `resolveTargetArgs` makes for an ambiguous bare name.
 *  3. **A miss at the gate is an instructive refusal, never a silent pass and
 *     never a silent arm.** The refusal names the procedure, its first
 *     checkpoint, and how to arm it.
 */
import {
  armAtGate,
  armByPredicate,
  armByRequest,
  armsOnMatches,
  claimsTool,
  renderLateArmRefusal,
  tokenizeTurnText,
} from '../law/arming';
import { Runbook } from '../law/types';

/**
 * A runbook as the registry hands one over. Built literally rather than through
 * the loader: these cases are about the arming rule, and the registry's own
 * suite already pins how a document becomes this shape.
 */
function runbook(over: Partial<Runbook> = {}): Runbook {
  return {
    id: 'rb.bulk-plugin-update',
    version: '1.0.0',
    capability: 'cap.bulk_plugin_update',
    strictness: 'strict',
    path: 'runbooks/bulk-plugin-update.md',
    hash: 'sha256:abc',
    canonicalBytes: 4858,
    checkpoints: [
      { id: 'cp.consult-history', attest: 'manifest', tools: [] },
      { id: 'cp.dry-run', attest: 'narrative', tools: [] },
    ],
    steps: [],
    tools: [],
    toolScope: 'advisory',
    armsOn: { verbs: ['update', 'upgrade', 'bump'], subjects: ['plugin', 'plugins', 'woocommerce'] },
    body: '# Bulk plugin update\n\nCanary first.\n',
    frontmatter: {},
    ...over,
  };
}

describe('tokenizeTurnText', () => {
  test('splits on anything that is not a letter or a digit, and lowercases', () => {
    expect(tokenizeTurnText('Update the Plugins, please!')).toEqual([
      'update',
      'the',
      'plugins',
      'please',
    ]);
  });

  test('keeps non-ASCII letters as letters — a word is not an ASCII word', () => {
    expect(tokenizeTurnText('mettre à jour les plugins')).toEqual([
      'mettre',
      'à',
      'jour',
      'les',
      'plugins',
    ]);
  });

  test('empty and punctuation-only text produce no tokens', () => {
    expect(tokenizeTurnText('')).toEqual([]);
    expect(tokenizeTurnText('  ...!!  ')).toEqual([]);
  });
});

describe('armsOnMatches — the two-clause lexical predicate', () => {
  const predicate = { verbs: ['update', 'upgrade'], subjects: ['plugin', 'plugins'] };

  test('needs BOTH clauses: a verb alone does not arm', () => {
    expect(armsOnMatches('update everything', predicate)).toBe(false);
  });

  test('needs BOTH clauses: a subject alone does not arm', () => {
    expect(armsOnMatches('which plugins are installed?', predicate)).toBe(false);
  });

  test('a verb and a subject in the same turn arms', () => {
    expect(armsOnMatches('please update the plugins on staging', predicate)).toBe(true);
  });

  test('matching is whole-token, so a term embedded in a longer word does not arm', () => {
    // 'updates' is not 'update'; authoring the inflection is the runbook's job.
    expect(armsOnMatches('plugin updates are pending', predicate)).toBe(false);
  });

  test('a declared term containing a space matches as a phrase, in order', () => {
    const phrase = { verbs: ['roll out'], subjects: ['woocommerce'] };
    expect(armsOnMatches('roll out woocommerce everywhere', phrase)).toBe(true);
    // The same words, not adjacent, is not the phrase.
    expect(armsOnMatches('roll the dice, out with woocommerce', phrase)).toBe(false);
  });

  test('case and punctuation are irrelevant', () => {
    expect(armsOnMatches('UPDATE: the Plugins!', predicate)).toBe(true);
  });
});

describe('armByPredicate — path A', () => {
  test('arms the one runbook whose predicate matches, recording predicate as the source', () => {
    const rb = runbook();
    const out = armByPredicate('update the plugins on staging', [rb]);
    expect(out.armed?.runbook.id).toBe('rb.bulk-plugin-update');
    expect(out.armed?.armedBy).toBe('predicate');
    expect(out.reason).toBeUndefined();
  });

  test('no match arms nothing and says so', () => {
    const out = armByPredicate('what is my fleet doing?', [runbook()]);
    expect(out.armed).toBeUndefined();
    expect(out.reason).toBe('no-match');
  });

  test('a runbook with no arms_on can never arm by predicate', () => {
    const out = armByPredicate('update the plugins', [runbook({ armsOn: undefined })]);
    expect(out.armed).toBeUndefined();
    expect(out.reason).toBe('no-match');
  });

  test('two matching runbooks arm NEITHER, and both are named', () => {
    const other = runbook({
      id: 'rb.other',
      capability: 'cap.other',
      armsOn: { verbs: ['update'], subjects: ['plugin', 'plugins'] },
    });
    const out = armByPredicate('update the plugins', [runbook(), other]);
    expect(out.armed).toBeUndefined();
    expect(out.reason).toBe('ambiguous');
    expect(out.candidates).toEqual(['rb.bulk-plugin-update', 'rb.other']);
  });

  test('the same text over the same runbooks gives the same answer, every time', () => {
    const set = [runbook(), runbook({ id: 'rb.two', capability: 'cap.two' })];
    const first = armByPredicate('update the plugins', set);
    const second = armByPredicate('update the plugins', set);
    expect(second).toEqual(first);
    // Ambiguous, deterministically: two granted runbooks both claim these words.
    expect(first.reason).toBe('ambiguous');
  });

  test('an empty granted set arms nothing — the additive-parity floor', () => {
    expect(armByPredicate('update the plugins', [])).toEqual({ reason: 'no-match' });
  });
});

describe('armByRequest — path B, the model asks by name', () => {
  test('a granted capability arms, recorded as model-request', () => {
    const out = armByRequest('cap.bulk_plugin_update', [runbook()]);
    expect(out.armed?.runbook.id).toBe('rb.bulk-plugin-update');
    expect(out.armed?.armedBy).toBe('model-request');
  });

  test('a capability that is not granted is NOT an error — it arms nothing and says which', () => {
    const out = armByRequest('cap.something-else', [runbook()]);
    expect(out.armed).toBeUndefined();
    expect(out.reason).toBe('not-granted');
    expect(out.candidates).toEqual(['cap.bulk_plugin_update']);
  });

  test('a request for a guided procedure arms it too — guided is a procedure, not a gate', () => {
    const guided = runbook({
      id: 'rb.wpe-pull',
      capability: 'cap.wpe_pull',
      strictness: 'guided',
      checkpoints: [],
      steps: ['st.one'],
    });
    expect(armByRequest('cap.wpe_pull', [guided]).armed?.runbook.strictness).toBe('guided');
  });
});

describe('armAtGate — path C, the late arm that refuses', () => {
  const claimant = runbook({
    tools: [{ name: 'bulk_plugin_update' }],
    checkpoints: [{ id: 'cp.consult-history', attest: 'manifest', tools: [{ name: 'wp_plugin_list' }] }],
  });

  test('a tool claimed at document level arms late', () => {
    const out = armAtGate('bulk_plugin_update', [claimant]);
    expect(out.armed?.runbook.id).toBe('rb.bulk-plugin-update');
    expect(out.armed?.armedBy).toBe('late-gate');
  });

  test('a tool claimed by a checkpoint arms late too — the claim set is the union', () => {
    expect(armAtGate('wp_plugin_list', [claimant]).armed?.armedBy).toBe('late-gate');
  });

  test('an unclaimed tool arms nothing: every other call is untouched', () => {
    const out = armAtGate('nexus_list_sites', [claimant]);
    expect(out.armed).toBeUndefined();
    expect(out.reason).toBe('unclaimed');
  });

  test('a GUIDED runbook claiming the tool does not arm the gate — guided advises, it never refuses', () => {
    const guided = runbook({
      strictness: 'guided',
      checkpoints: [],
      steps: ['st.one'],
      tools: [{ name: 'bulk_plugin_update' }],
    });
    expect(armAtGate('bulk_plugin_update', [guided]).reason).toBe('unclaimed');
  });

  test('claimsTool is the union of document tools and every checkpoint tool', () => {
    expect(claimsTool(claimant, 'bulk_plugin_update')).toBe(true);
    expect(claimsTool(claimant, 'wp_plugin_list')).toBe(true);
    expect(claimsTool(claimant, 'wpe_create_backup')).toBe(false);
  });

  test('on the shipped set today NOTHING is claimed, because no runbook authors tools: yet', () => {
    // 20c authors `tools:`/`arms_on:` (WP-20a finding 7). Until it does, the
    // late arm cannot fire — pinned so the day the frontmatter lands, the new
    // behaviour is a deliberate consequence rather than a surprise.
    expect(armAtGate('bulk_plugin_update', [runbook()]).reason).toBe('unclaimed');
  });
});

describe('renderLateArmRefusal — instructive, never silent', () => {
  const text = renderLateArmRefusal(
    runbook({ tools: [{ name: 'bulk_plugin_update' }] }),
    'bulk_plugin_update'
  );

  test('names the tool, the procedure, its version and its strictness', () => {
    expect(text).toContain('bulk_plugin_update');
    expect(text).toContain('rb.bulk-plugin-update');
    expect(text).toContain('1.0.0');
    expect(text).toContain('strict');
  });

  test('names the first checkpoint, so the refusal says where the procedure starts', () => {
    expect(text).toContain('cp.consult-history');
  });

  test('says how to arm it, by the tool a model can actually call', () => {
    expect(text).toContain('nexus_load_procedure');
    expect(text).toContain('cap.bulk_plugin_update');
  });

  test('says the procedure is NOT in this refusal — R7: the body never rides a tool result', () => {
    expect(text).not.toContain('Canary first');
    expect(text.toLowerCase()).toContain('next turn');
  });

  test('carries no internal machinery vocabulary', () => {
    for (const forbidden of ['ledger', 'twin', 'fold', 'envelope', 'SLO', 'manifest']) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
