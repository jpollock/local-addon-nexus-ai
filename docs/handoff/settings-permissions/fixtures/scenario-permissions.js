/**
 * The permissions pane — one surface, two layers.
 *
 * The two shipped panes contradicted each other: cap.wpe_pull read Denied while
 * "Copy a site down" read Allowed everywhere, and promote_environment stated its
 * prohibition twice in two vocabularies. They did not merge because they are not the
 * same KIND of thing:
 *
 *   a GRANT is per-capability, recorded as an act (control.grant.issued), cited by
 *     refusals, and what a door lands on. A decision.
 *   a BOUND is fleet-wide, applies across every capability, and is recorded as no act
 *     about any one of them. A limit.
 *
 * Stacked, they merge. The bound is the outer limit; each grant states the bound's
 * consequence on itself, which is the split-scope rule applied to a grant.
 *
 * Capability facts (documents, hashes, checkpoint counts) are the shipped registry's.
 * The clipped lines are DERIVED from bound × capability, never authored per row.
 */
(function () {
  window.NEXUS_PERMS = {
    lead: 'Nothing here is granted because a document exists. A capability arrives denied, and becomes granted only by an act recorded on this list.',

    // Layer 1 — the bound. Where agents may write at all, across every capability.
    bound: {
      head: 'Where agents may write at all',
      note: 'Reading is always allowed. This limit applies to every capability below, however it is granted \u2014 so a grant can be given and still reach nothing in a place this blocks.',
      places: ['your machine', 'staging', 'production'],
      rows: [
        { op: 'Copy a site down', transport: 'WP Engine', states: ['allowed', 'allowed', 'allowed'] },
        { op: 'Install or update things', transport: 'WP Engine + SSH', states: ['allowed', 'allowed', 'blocked'] },
        { op: 'Push local changes up', transport: 'WP Engine', states: ['allowed', 'allowed', 'blocked'] },
        { op: 'Delete or promote an environment', transport: 'WP Engine', states: ['blocked', 'blocked', 'blocked'] },
      ],
      scope: {
        head: 'Accounts this bound covers',
        note: 'A capability granted below is granted only within these accounts.',
        included: ['btwpe', 'devrel', 'Unicorn', 'AutoscaleAlpha', 'esmv7us1l20jdr', 'WPESupportTest', 'getflywheel', 'Golden Ecomm', 'jpollock911', 'Andonov', 'w7579'],
        excluded: ['dbrains', 'evalkedracka', 'nitropacksite'],
      },
    },

    // Layer 2 — the grants. One row per capability, each naming the operation it needs.
    grants: [
      {
        cap: 'cap.bulk_plugin_update',
        label: 'Update plugins across sites',
        kind: 'strict procedure',
        doc: 'rb.bulk-plugin-update · 1.2.0',
        hash: 'sha256:0646cfe11c',
        state: 'granted',
        act: 'control.grant.issued · evt_01M0BBDM75HSJWXX · 18 Aug, 14:11',
        gates: '4 of 8 checkpoints the platform can verify',
        gatesRest: '4 are on the agent\u2019s account only.',
        needs: 'Install or update things',
      },
      {
        cap: 'cap.incident_containment',
        label: 'Contain an incident',
        kind: 'strict procedure',
        doc: 'rb.incident-containment · 1.2.0',
        hash: 'sha256:d1c8740a3d',
        state: 'granted',
        act: 'control.grant.issued · evt_01M0FWV7RFTGX4T2 · 20 Aug, 08:32',
        gates: 'The grant itself, and nothing after it',
        gatesRest: 'All 5 checkpoints are narrative, so the platform can verify none of them.',
        needs: 'Install or update things',
      },
      {
        cap: 'cap.promotion_preflight',
        label: 'Check a promotion before it runs',
        kind: 'strict procedure',
        doc: 'rb.promotion-preflight · 1.2.0',
        hash: 'sha256:4913c8b5ce',
        state: 'granted',
        act: 'control.grant.issued · evt_01M0FWV7RHJYB01W · 20 Aug, 08:32',
        gates: '1 of 4 checkpoints the platform can verify',
        gatesRest: '3 are on the agent\u2019s account only.',
        needs: 'Copy a site down',
      },
      {
        cap: 'cap.incident_remediation',
        label: 'Remediate an incident',
        kind: 'strict procedure',
        doc: 'rb.incident-remediation · 1.2.0',
        hash: 'sha256:e81b52ebf2',
        state: 'denied',
        act: '',
        gates: '1 of 6 checkpoints the platform can verify',
        gatesRest: '5 are on the agent\u2019s account only.',
        needs: 'Install or update things',
      },
      {
        cap: 'cap.promote_environment',
        label: 'Promote one environment to another',
        kind: 'strict procedure',
        doc: 'rb.promotion-execute · 1.3.0',
        hash: 'sha256:f6da723999',
        state: 'denied',
        act: '',
        gates: '3 of 5 checkpoints the platform can verify',
        gatesRest: '2 are on the agent\u2019s account only.',
        needs: 'Delete or promote an environment',
      },
      {
        cap: 'cap.wpe_pull',
        label: 'Pull a site from WP Engine',
        kind: 'guided procedure',
        doc: 'rb.wpe-pull · 1.0.0',
        hash: 'sha256:0c052e155a',
        state: 'denied',
        act: '',
        gates: '8 steps, none of them a checkpoint',
        gatesRest: 'A guided document is adapted as it runs, and deviations are recorded with their reason.',
        needs: 'Copy a site down',
      },
      {
        cap: 'cap.diagnose_site',
        label: 'Diagnose a site',
        kind: 'guided procedure',
        doc: 'rb.diagnose-site · 1.0.0',
        hash: 'sha256:f088ac3354',
        state: 'denied',
        act: '',
        gates: '8 steps, none of them a checkpoint',
        gatesRest: 'A guided document is adapted as it runs, and deviations are recorded with their reason.',
        needs: '',
      },
    ],

    // The two gaps the merge exposes, stated rather than guessed.
    gaps: [
      {
        head: 'Whose grants are these?',
        body: 'Agents carry their own permissions in their own context, so a grant\u2019s address is (agent, capability) \u2014 and nothing on this pane names an agent. Either this list says whose grants it holds, or it is the fleet-wide read-only view and the editable control lives inside each agent.',
        door: 'Open Agents',
        why: 'Drawn as a stated absence rather than a guess, because guessing wrong here would put a second editable home under every grant.',
      },
      {
        head: 'Does the account scope cover grants too?',
        body: 'The scope was a control on the bound pane only, so it was silent about grants. Merged, it cannot be: three accounts are excluded, and a granted capability either reaches them or does not. Drawn as covering both, and stated on the scope itself.',
        door: '',
        why: 'If that reading is wrong, the scope needs to say which layer it binds \u2014 an unstated scope is the one thing a permissions surface cannot have.',
      },
    ],
  };
})();
