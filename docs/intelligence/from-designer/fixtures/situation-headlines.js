/**
 * Situation headlines — the ratified sentence set for the Now list.
 *
 * These are TEMPLATES, not specimens. Each carries the guard that selects it and the
 * host fields it substitutes, so `sessionRegistry`'s headline composer can be rewritten
 * without any of these words being retyped, and so a generator can extract them.
 *
 * Slots are host fields that already exist, named exactly:
 *
 *   runNoun      RUN_NOUN[row.capability] — proposed vocabulary rows, §2 below
 *   done         sites written and standing
 *   failed       sites written and failed
 *   total        size of the derived target set
 *   age          how long the situation has been waiting, already humanised
 *   checkpoint   PendingGate's checkpoint id
 *   position     PendingGate's "n of m"
 *   awaits       PendingGate.awaits — what is needed of the user
 *   target       the site or install the situation is about
 *   finding      the incident's own subject line
 *   agentId      the agent that could not finish
 *   timeout      the timeout it exceeded
 *
 * Nothing here computes anything. `done === 0 && failed === 0` is the whole basis of
 * "changed nothing", and both numbers are already what the current headline prints.
 */
(function () {
  /**
   * §2 · Proposed vocabulary rows — one run noun per capability.
   *
   * Controlled Vocabulary v1.3 ratified the capability LABELS ("Update plugins across
   * sites"), which name an act and do not nominalise into a subject. A headline needs a
   * noun, so these are proposed as a second column on the same rows rather than as new
   * words: same referent, subject form. Not to be rendered until ratified.
   */
  var RUN_NOUN = {
    'cap.bulk_plugin_update': 'A plugin update run',
    'cap.incident_containment': 'A containment run',
    'cap.incident_remediation': 'A remediation run',
    'cap.promotion_preflight': 'A promotion check',
    'cap.promote_environment': 'A promotion',
    'cap.wpe_pull': 'A site pull',
    'cap.diagnose_site': 'A diagnosis',
  };

  var TEMPLATES = [
    {
      id: 'run.waiting.nothing-written',
      // The class the current headline renders as "0 done and standing, 0 failed".
      guard: 'row.kind === "run" && done === 0 && failed === 0 && total === 0',
      headline: '{runNoun} has waited {age} and changed nothing',
      ask: 'It never received a target list, so it cannot start. Give it one, or close it.',
      chip: 'Waiting',
      state: 'nothing written yet',
      meta: '{runbookId}',
      rule: 'Tier 2 · the world is untouched',
      note: 'Two rows on the current fleet are this class, on different runbooks. The runbook id leaves the headline for the meta line: it identifies the procedure and never said what happened.',
    },
    {
      id: 'run.waiting.mid-procedure',
      guard: 'row.kind === "run" && done === 0 && failed === 0 && total > 0 && gate !== null',
      headline: 'A {checkpoint} step is waiting on your {awaits}',
      ask: 'Waiting at {checkpoint}, {position}. Nothing has been written yet, so stopping here costs nothing.',
      chip: 'Waiting',
      state: 'nothing written yet',
      meta: '{runbookId}',
      rule: 'Tier 2 · the world is untouched',
      note: 'The gate names what it needs, from PendingGate.awaits. "Nothing has been written yet" is the fact that decides how urgent this is, so it is stated rather than implied by two zeros.',
    },
    {
      id: 'run.waiting.part-changed',
      guard: 'row.kind === "run" && (done > 0 || failed > 0) && gate !== null',
      headline: '{done} of {total} are changed and the rest are waiting on you',
      ask: 'Waiting at {checkpoint}, {position}. {failed} failed. Continue, or stop and keep what is standing.',
      chip: 'Mid-change',
      state: '',
      meta: '{runbookId}',
      rule: 'Tier 1 · mid-change, only you can move it',
      note: 'Not on the current fleet, and the tier that matters most when it appears: a part-changed world compounding against an untouched world keeping is the whole basis of the tier 1 / tier 2 split.',
    },
    {
      id: 'incident.no-run',
      guard: 'row.kind === "incident" && row.runId === null',
      headline: '{finding} on {target}, and nothing is fixing it',
      ask: 'Contain it now, or say why not. Nothing has been written under a procedure.',
      chip: '',
      state: 'No run attached',
      meta: '{producer}',
      rule: 'Tier 1 · nothing is holding it back but you',
      note: 'The finding is the incident\u2019s own subject line, so the headline states what is wrong rather than that an incident exists. Four of these are open on one site.',
    },
    {
      id: 'agent.stuck',
      guard: 'row.kind === "agentFailure"',
      headline: '{agentId} could not finish a run',
      ask: 'It timed out after {timeout}. Retry it, or leave it stopped.',
      chip: 'Stuck',
      state: '',
      meta: '{agentId}',
      rule: 'Tier 3 · the agent is asking, not the fleet',
      note: 'The one class where the subject is the platform rather than the fleet, which is why it sorts below both waiting classes however old it is.',
    },
  ];

  /**
   * §3 · The list verdict. Generated from the rows the columns are about to render,
   * the same way the accounting line already is — so it cannot disagree with them.
   */
  var VERDICT = {
    allUnwritten: '{needsYou} things need you, and none of them has changed anything yet',
    someChanged: '{needsYou} things need you, and {changedRuns} of them have already written somewhere',
    guard: 'allUnwritten when every waiting row has done === 0 && failed === 0',
    note: 'No single row can say this, and it is the most useful sentence the data produces: nothing is half-done, so nothing is expensive to stop.',
  };

  /** §4 · The freshness line, replacing the packet\u2019s authored paragraph. */
  var FRESHNESS = {
    replaces: 'AUTHORED.DRIFT_NO_COUNT',
    was: 'No producer reports how many facts are past their freshness window, so this line cannot state the count.',
    now: 'Freshness is not being reported yet.',
    then: 'Nothing is needed of anyone, so nothing is in this list \u2014 each one carries its own date where it lives.',
    note: 'The packet was right to author something: the contract carries no stale count, so the alternative was a fabricated number. It authored one clause too many. Same honesty, and it stops explaining the pipeline to a customer.',
  };

  window.NEXUS_HEADLINES = {
    runNoun: RUN_NOUN,
    templates: TEMPLATES,
    verdict: VERDICT,
    freshness: FRESHNESS,
  };
})();
