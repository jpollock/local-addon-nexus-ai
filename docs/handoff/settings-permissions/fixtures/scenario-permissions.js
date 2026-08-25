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
    lead: 'Nothing here is granted because a document exists. A capability arrives denied, and becomes granted only by an act recorded against one agent.',
    readOnly: 'This is every agent\u2019s grants in one place, to read. A grant belongs to an agent, so it is made and revoked inside that agent.',

    agents: [
      { id: 'act_security_sentinel', label: 'Security sentinel' },
      { id: 'act_fleet_keeper', label: 'Fleet keeper' },
      { id: 'act_incident_first_responder', label: 'Incident first responder' },
    ],

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
        note: 'The bound\u2019s other dimension: places are its columns, accounts are too many to be, so they are stated here. A grant reaches an account only if this bound does.',
        included: ['btwpe', 'devrel', 'Unicorn', 'AutoscaleAlpha', 'esmv7us1l20jdr', 'WPESupportTest', 'getflywheel', 'Golden Ecomm', 'jpollock911', 'Andonov', 'w7579'],
        excluded: ['dbrains', 'evalkedracka', 'nitropacksite'],
      },
    },

    // Layer 2 — the grants. One row per capability, each naming the operation it needs.
    grants: [
      {
        cap: 'cap.bulk_plugin_update',
        grantedTo: ['act_fleet_keeper', 'act_incident_first_responder'],
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
        grantedTo: ['act_security_sentinel', 'act_incident_first_responder'],
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
        grantedTo: ['act_fleet_keeper'],
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
        grantedTo: [],
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
        grantedTo: [],
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
        grantedTo: [],
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
        grantedTo: [],
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

    // Both open questions, now ruled.
    rulings: [
      {
        head: 'A grant belongs to an agent, so this pane reads and does not edit',
        body: 'The address is (agent, capability). A refusal comes from one agent\u2019s run, and its door has to land where the decision can be changed \u2014 which is inside that agent. A second editable list of the same grants would be two homes for one decision, and that is the defect this whole merge removes.',
        consequences: [
          'No switch on any row. An editable control on a read-only surface is a lie about what pressing it would do.',
          'A row states the SET of agents that hold the grant, never one state for all of them \u2014 the set-versus-average rule, applied to agents instead of places.',
          'Every row\u2019s door leads to the agent that owns the decision. Where several hold it, the door leads to Agents scoped to that capability.',
        ],
      },
      {
        head: 'The account scope is part of the bound, not a third thing binding two layers',
        body: 'It is the bound\u2019s other dimension \u2014 places are its columns, accounts are too many to be, so they are stated beneath it. A grant reaches an account only if the bound does, which means the scope reaches grants THROUGH the bound rather than being applied to them separately. One mechanism, not two rules to remember.',
        consequences: [
          'Stated once, at the foot of the bound. Not repeated per grant, because it is uniform across every operation.',
          'The clipped line stays place-based, and stays accurate: an excluded account is excluded whole, so it never changes which places a grant reaches within the accounts it does cover.',
          'An earlier draft said the scope \u201cbinds both layers\u201d. Nearly right, and it described one mechanism as two applications \u2014 which would have left an implementer looking for a second place to apply it.',
        ],
      },
    ],
  };
})();
