/**
 * Scenario narrative for M6 · Return — the arrival and the re-entry.
 *
 * The situations, tiers and rules are the §2 golden fixture verbatim (the eight live things),
 * as the ambient triage sheet renders them. Procedure facts — checkpoint ids, order, attest
 * wording, denominators — are read from window.NEXUS_PROCEDURES and never authored here.
 *
 * What IS scenario: the twelve hours away, the session's own turns, and the two record
 * conditions the arrival reports.
 */
(function () {
  window.NEXUS_RETURN = {
    away: 'You were away 12 hours',

    // The arrival's own accounting line — the ambient triage's, unchanged.
    accounting: '2 need you · 1 changed overnight · three checks dark',

    waiting: [
      {
        id: 'charlie',
        rule: 'Tier 1 · mid-change, only you can move it',
        headline: 'Charlie is part-changed and its checkout is down',
        gate: 'Waiting at cp.approval — restore, or continue without Charlie',
        detail: 'Halted at Charlie · 2 done and standing, 2 untouched · verify failed on checkout · incident open',
        parts: '3 parts · one situation',
        place: 'Touches production on 2 of 5',
        age: '14h',
        runbook: 'rb.incident-remediation',
      },
      {
        id: 'bravo',
        rule: 'Tier 1 · a write has landed in scope',
        headline: 'Bravo is waiting on you mid-change',
        gate: 'Waiting at cp.approval — 3 of 8 in remediate',
        detail: 'Canary already written · dry-run stale in 41m',
        parts: '',
        place: 'Production',
        age: '3h',
        runbook: 'rb.bulk-plugin-update',
      },
    ],

    reserved: {
      rule: 'Reserved · the record\u2019s own health',
      headline: 'The record is going blind — 3 producers dark',
      detail: 'plugin-inventory 9h · health 6h · content-age 6h',
      note: 'Verdicts about 47 sites cannot be trusted while this stands.',
      age: 'oldest 9h',
    },

    changed: {
      rule: 'Tier 4 · changed, and it kept',
      headline: 'Cache purge across 12 sites finished',
      detail: 'Filed against its runbook · 12 of 12 verified',
      place: 'Staging on 9, production on 3',
      age: '5h',
    },

    drift: '41 facts are past their freshness window. Nothing is needed of anyone, so nothing is in this list — each one carries its own date where it lives.',

    // 6b · the re-entry. The session is the one that was already open; these are its own turns.
    session: {
      title: 'Update plugins across 5 sites',
      opened: 'Opened yesterday, 12:04 · from your matrix selection',
      before: [
        { who: 'you', text: 'Update WooCommerce on the five sites that are behind.' },
        { who: 'agent', text: 'It adds a history check, a dry run, a canary and an order you did not ask for. Three cells can run now; two are production and need a grant.' },
      ],
      // The approval given BEFORE leaving. It must survive the excursion.
      gaveBefore: {
        checkpoint: 'cp.approval',
        when: 'yesterday, 12:11',
        text: 'You approved this plan yesterday at 12:11. That approval still stands — you are not being asked again.',
      },
      gateNow: {
        checkpoint: 'cp.verify-canary',
        lead: 'The canary wrote to Bravo and its check came back clean',
        body: 'Continue to the remaining four sites, or stop here and keep the canary.',
        primary: 'Continue to the four',
        secondary: 'Stop here',
      },
      resumed: 'Resumed where it stopped · nothing re-derived, nothing re-asked',
    },

    // 6c · the reopened session whose arm can no longer be established (ruling 1).
    unknownArm: {
      lead: 'This session was running a procedure, and the platform can no longer say which',
      body: 'The arming record for it is not in the ledger this session can reach, so the checkpoints, the document and the attest words cannot be shown. Nothing here is armed now: no write can be made under this session, and the run it belonged to is intact in the record.',
      door: 'Find this run in the record',
      offer: 'Start a new run from the same selection',
      note: 'It does not say "unknown procedure," which would name a thing; it says the platform cannot establish the arm, which is a fact about the platform.',
    },

    // The two wordings owed from 5b, in their final form.
    comparator: [
      {
        head: 'The class-derived absence line',
        text: 'This file is a drop-in, so no place records a version for it. The dashes are not missing data — there is nothing here that varies by place.',
        rule: 'Derived from the fact\u2019s own class, never from counting how many cells came back empty: a sentence produced by counting absences would say the same thing about a fact that merely has not been collected yet.',
      },
      {
        head: 'The disarmed-band reason line',
        text: 'The document on disk is not the one this grant was made against. Not staleness — the review this grant carries happened against different text, so the capability behaves as though it were never granted.',
        rule: 'It names the failure as integrity rather than age, and it says what the state DOES (behaves as though never granted) rather than what it is called. The grant itself is not described as revoked, because the user revoked nothing.',
      },
    ],
  };
})();
