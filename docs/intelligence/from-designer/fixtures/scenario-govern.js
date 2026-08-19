/**
 * Scenario narrative for the Govern matrix — the GRANT STATE only.
 *
 * Not procedure data: strictness, version, hash, checkpoint counts and the attestable /
 * narrative split are all read from window.NEXUS_PROCEDURES (generated from law/ by
 * WP-32's derivation). Adding a checkpoint or a count here is the defect pin 7 names.
 *
 * The grant facts below are scenario because grant state is per-machine: the materialized
 * set, the issuing events and the disarm are what the host's capabilityGrants module
 * writes. Their SHAPE is that module's — `materialized` | `explicit` | `denied` |
 * `requires-explicit-grant` | `disarmed` with a reason.
 */
(function () {
  window.NEXUS_GOVERN = {
    order: [
      'cap.bulk_plugin_update',
      'cap.incident_containment',
      'cap.promotion_preflight',
      'cap.promote_environment',
      'cap.incident_remediation',
      'cap.wpe_pull',
      'cap.diagnose_site',
    ],

    grants: {
      'cap.bulk_plugin_update': {
        state: 'materialized',
        issued: 'control.grant.issued · evt_7a02 · 18 Aug, 09:12',
      },
      'cap.incident_containment': {
        state: 'materialized',
        issued: 'control.grant.issued · evt_7b19 · 19 Aug, 22:40 · law-review re-pin',
      },
      'cap.promotion_preflight': {
        state: 'disarmed',
        issued: 'control.grant.issued · evt_7a04 · 18 Aug, 09:12',
        disarm: 'The document on disk is not the one this grant was made against. Not staleness — the review this grant carries happened against different text, so the capability behaves as though it were never granted.',
        disarmDoor: 'Re-grant against the current document',
      },
      'cap.promote_environment': {
        state: 'requires-explicit-grant',
        note: 'Never granted by default. Production consequence is not a default, so nothing but a grant you make yourself reaches this.',
      },
      'cap.incident_remediation': {
        state: 'requires-explicit-grant',
        note: 'Never granted by default. Containment is granted and remediation is not — stopping the bleeding and changing production are two different permissions.',
      },
      'cap.wpe_pull': {
        state: 'denied',
        note: 'Guided documents carry no mandatory full-body ride, so nothing materialized this. Grantable by an entry you make.',
      },
      'cap.diagnose_site': {
        state: 'denied',
        note: 'Guided documents carry no mandatory full-body ride, so nothing materialized this. Grantable by an entry you make.',
      },
    },

    // The two doors that already point here, from the shipped refusals.
    arrivals: [
      { from: 'A scope block barred 2 production cells', at: 'cap.bulk_plugin_update', detail: 'production needs its own runbook version, which does not exist yet' },
      { from: 'A gated tool refused with a governDoor', at: 'cap.promote_environment', detail: 'the grant this refusal names' },
    ],

    // Field finding 1 — a selected fact with no place-versioned data anywhere in the row.
    absent: {
      fact: 'advanced-cache.php',
      sites: '306 sites',
      line: 'This file is a drop-in, so no place records a version for it. The dashes are not missing data — there is nothing here that varies by place.',
      door: 'See what is recorded about drop-ins',
    },

    // Field finding 2 — the history line, anchored to its site.
    anchored: {
      site: 'coolagency',
      path: '~/Local Sites/coolagency',
      cells: [
        { place: 'Local', value: '10.8.1 · inactive' },
        { place: 'Staging', value: '10.8.1' },
        { place: 'Production', value: '\u2014' },
      ],
      history: 'Nexus AI has been watching this site since 18 August',
    },
  };
})();
