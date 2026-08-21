/**
 * Scenario for the coalesced Now — the same fleet state the two screenshots show,
 * after dedupe and after the fold.
 *
 * Situation facts (targets, ages, findings, producers) are the photographed state.
 * Every SENTENCE is composed from handoff/from-designer/fixtures/situation-headlines.js
 * at render time; none is written here.
 */
(function () {
  window.NEXUS_NOW = {
    checkCount: 5,
    darkCount: 0,

    // Tier 1 — the record links these four findings (one sentinel scan, one TaskId).
    coalesced: {
      kind: 'incident',
      tier: 1,
      target: 'theawfulpm-test',
      leadFinding: 'a known backdoor plugin (wp-compat)',
      memberCount: 4,
      restCount: 3,
      producer: 'act_security_sentinel',
      linkKind: 'one sentinel scan',
      age: '65h',
      members: [
        { finding: 'Known backdoor plugin detected: wp-compat', severity: 'critical', age: '65h' },
        { finding: 'File manager plugin(s) active: fileorganizer, filester', severity: 'high', age: '65h' },
        { finding: 'Low-entropy plugin name(s) — likely attacker-created: noted, index', severity: 'high', age: '65h' },
        { finding: 'PHP file(s) in mu-plugins/: index.php', severity: 'high', age: '65h' },
      ],
    },

    // Tier 2 — three runs, none of which has written anything.
    runs: [
      {
        kind: 'run',
        tier: 2,
        capability: 'cap.bulk_plugin_update',
        runbookId: 'rb.bulk-plugin-update',
        age: '82h',
        done: 0, failed: 0, total: 0,
        gate: null,
      },
      {
        kind: 'run',
        tier: 2,
        capability: 'cap.bulk_plugin_update',
        runbookId: 'rb.bulk-plugin-update',
        age: '66h',
        done: 0, failed: 0, total: 5,
        gate: { checkpoint: 'cp.backup', position: '4 of 8', awaits: 'evidence' },
      },
      {
        kind: 'run',
        tier: 2,
        capability: 'cap.incident_containment',
        runbookId: 'rb.incident-containment',
        age: '64h',
        done: 0, failed: 0, total: 0,
        gate: null,
      },
    ],

    /**
     * The same four findings where the record does NOT link them — what the class
     * renders as after WP-51, for producers that mint no TaskId.
     */
    grouped: {
      target: 'theawfulpm-test',
      memberCount: 4,
      rows: [
        { finding: 'Known backdoor plugin detected: wp-compat', age: '65h', producer: 'act_security_sentinel' },
        { finding: 'File manager plugin(s) active: fileorganizer, filester', age: '61h', producer: 'act_security_sentinel' },
        { finding: 'Low-entropy plugin name(s) — likely attacker-created: noted, index', age: '48h', producer: 'plugin_inventory' },
        { finding: 'PHP file(s) in mu-plugins/: index.php', age: '12h', producer: 'act_security_sentinel' },
      ],
    },

    /** The deferral the coalesced situation carries once WP-56 lands. */
    deferral: {
      reason: 'waiting on the client to approve a rebuild',
      wakeLabel: 'Wakes when the containment run finishes',
      deferredAge: '4h ago',
    },
  };
})();
