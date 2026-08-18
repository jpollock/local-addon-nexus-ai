/* SENT FOR DIFF — the hand-built fixture the prototypes read from 18 Aug until WP-32's
   generator merged. Superseded by fixtures/declared-procedures.json. Kept verbatim so the
   adjudication has both sides. Known divergences are listed in
   handoff/from-designer/fixture-diff-notes.md. */
/**
 * Derived declaration fixture — rb.bulk-plugin-update v1.0.0.
 *
 * Source of every string below: `law/runbooks/bulk-plugin-update.md` (checkpoint order,
 * attest classes, the authored `unrequested:` set) and `procedureModel.ts`
 * (ATTEST_WORDS, BADGE_LABEL, the provable denominator). Scenario narrative — site
 * names, backup ids, the selection this run armed from — is fixture data and lives here
 * too, so every sheet tells one story.
 *
 * PLACEHOLDER. WP-32's first deliverable is this file generated from the real
 * derivation. Replace it wholesale then; never hand-edit a checkpoint sequence here.
 * Regenerate on any runbook version bump.
 */
(function () {
  var ATTEST_WORDS = {
    event: 'verified from records',
    manifest: 'verified as supplied',
    narrative: 'your account only, not verified',
  };

  var CHECKPOINTS = [
    { id: 'cp.consult-history', label: 'Consult incident history', attest: 'manifest',
      sub: 'brightpath broke checkout on a WooCommerce update, 14 May. It goes last and is watched.' },
    { id: 'cp.dry-run', label: 'Show what would change', attest: 'narrative',
      sub: 'Three cells move 9.5.1 → 9.9.2. Two need a grant, and harborlight is halted, so it is excluded.',
      text: 'alpine-outfitters · staging    9.5.1 → 9.9.2\nnorthfieldco · staging        9.5.1 → 9.9.2\nbrightpath · staging          9.5.1 → 9.9.2\ngoldenecomm · production      needs a grant\nquarrystone · production      needs a grant\nharborlight · staging         halted, skipped' },
    { id: 'cp.approval', label: 'Your approval', attest: 'event', gate: true,
      sub: 'Nothing below this line has run.' },
    { id: 'cp.backup', label: 'Back up each site', attest: 'event',
      sub: 'One backup per site, confirmed before that site is touched.',
      text: 'alpine-outfitters      bk_8f21c4 ✓\nnorthfieldco           bk_8f21c5 ✓\nbrightpath             bk_8f21c6 ✓' },
    { id: 'cp.canary', label: 'Canary one site', attest: 'narrative',
      sub: 'alpine-outfitters: lowest traffic, no incident history. Updated, responded normally.' },
    { id: 'cp.verify-canary', label: 'Prove it before scaling it', attest: 'narrative',
      sub: 'Site loads, admin reachable, checkout renders. Checked by the agent, not by a tool.' },
    { id: 'cp.roll-fleet', label: 'The rest, watched', attest: 'event',
      sub: 'Order held. brightpath went last, watched.',
      text: 'northfieldco           9.9.2 ✓\nbrightpath             9.9.2 ✓ watched' },
    { id: 'cp.report', label: 'Close the loop', attest: 'narrative',
      sub: 'Three cells on 9.9.2. Two still need a grant. Nothing rolled back.' },
  ];

  /** The plan of zero — two halted sites, from the 18 Aug live conversation. */
  var EMPTY_CHECKPOINTS = [
    { id: 'cp.consult-history', label: 'Consult incident history', attest: 'manifest',
      sub: 'Nothing recorded against WooCommerce on either halted site.' },
    { id: 'cp.dry-run', label: 'Show what would change', attest: 'narrative',
      sub: '0 cells eligible.',
      text: 'harborlight · staging         halted, skipped\nbravo · staging               halted, skipped' },
    { id: 'cp.approval', label: 'Your approval', na: 'The plan is empty, so there is nothing to approve.' },
    { id: 'cp.backup', label: 'Back up each site', na: 'No site is in the plan, so there is nothing to back up.' },
    { id: 'cp.canary', label: 'Canary one site', na: 'No site is in the plan, so there is nothing to canary.' },
    { id: 'cp.verify-canary', label: 'Prove it before scaling it', na: 'Nothing was updated, so there is nothing to prove.' },
    { id: 'cp.roll-fleet', label: 'The rest, watched', na: 'Nothing to roll out.' },
    { id: 'cp.report', label: 'Close the loop', na: 'Nothing changed, so there is nothing to report.' },
  ];

  /**
   * The scope block — one artifact, rendered at every density. Its strings live here
   * exactly once, which is how the byte-identical pin is satisfied at the source.
   */
  var SCOPE = {
    headline: '5 cells selected · 3 can run now',
    barredHead: 'Needs a grant · 2 cells',
    barredDoor: 'Review what agents may do → plugin updates on production',
    places: 'WooCommerce 9.5.1 → 9.9.2 · touches production on 2 of 5, staging on 3 of 5',
    from: 'From your matrix selection, 12:04 · WooCommerce row, behind-newest filter',
    groups: [
      { head: 'Runs now · 3 cells',
        cells: 'alpine-outfitters · staging, northfieldco · staging, brightpath · staging',
        reason: 'Within this runbook’s declared environments and the grant you have made.',
        door: '' },
      { head: 'Needs a grant · 2 cells',
        cells: 'goldenecomm · production, quarrystone · production',
        reason: 'rb.bulk-plugin-update declares local, staging and development only; pre.no-production refuses production outright. Production needs a separate grant and its own version of this runbook, which does not exist yet.',
        door: 'Review what agents may do → plugin updates on production' },
      { head: 'Excluded · 1 site',
        cells: 'harborlight · staging',
        reason: 'Halted 14h, and said so. Nothing about authority — the world’s own state.',
        door: '' },
    ],
  };

  var SCOPE_EMPTY = {
    headline: '2 cells selected · 0 can run now',
    barredHead: 'Excluded · 2 sites',
    barredDoor: '',
    places: 'WooCommerce 9.5.1 → 9.9.2 · staging on 2 of 2',
    from: 'From your matrix selection, 09:12 · WooCommerce row, behind-newest filter',
    groups: [
      { head: 'Excluded · 2 sites',
        cells: 'harborlight · staging, bravo · staging',
        reason: 'Both halted, and said so. Starting a halted site solely to maintain it is what this runbook forbids.',
        door: '' },
    ],
  };

  window.NEXUS_FIXTURES = window.NEXUS_FIXTURES || {};
  window.NEXUS_FIXTURES['rb.bulk-plugin-update'] = {
    ref: 'rb.bulk-plugin-update · v1.0.0',
    name: 'Bulk plugin update',
    strictness: 'strict',
    attestWords: ATTEST_WORDS,
    badgeLabel: 'runbook added this',
    unrequested: ['cp.consult-history', 'cp.dry-run', 'cp.canary', 'cp.verify-canary'],
    verifiableCount: 4,
    checkpoints: CHECKPOINTS,
    emptyCheckpoints: EMPTY_CHECKPOINTS,
    scope: SCOPE,
    scopeEmpty: SCOPE_EMPTY,
    cardLine: 'The runbook asks for cp.dry-run — show what would change. The platform cannot verify that from records, so read the plan above before you approve.',
    denom: {
      waiting: '1 of 4 provable checkpoints attested · 4 on the agent’s account only.',
      finished: '4 of 4 provable checkpoints attested · 4 on the agent’s account only.',
      empty: '1 of 4 provable checkpoints attested · 4 on the agent’s account only · 6 unreachable, the plan is empty.',
    },
  };
})();
