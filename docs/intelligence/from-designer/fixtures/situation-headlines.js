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
      //
      // WP-48 GATE RULING (2026-08-20, architect + owner). Amended in the
      // RATIFIED SOURCE rather than patched in the composer, so the guard and
      // the code stay one rule and the agreement pin keeps holding.
      //
      // `&& gate === null` is belt-and-suspenders: a row STANDING AT A GATE can
      // never be "cannot start", whatever any count says. Measured on the live
      // fleet, one such row (cp.backup, 4 of 8) received this class's ask and
      // it was false about it. The cause was a NAME COLLISION, now removed:
      // `total` binds to the arming record's own scope — the "derived target
      // set" this slot table always named — instead of to places-from-outcomes,
      // which is the set that has an OUTCOME. Both facts are real; only one is
      // this slot's.
      guard: 'row.kind === "run" && done === 0 && failed === 0 && total === 0 && gate === null',
      headline: '{runNoun} has waited {age} and changed nothing',
      ask: 'It never received a target list, so it cannot start. Give it one, or close it.',
      chip: '',
      state: 'nothing written yet',
      meta: '{runbookId}',
      tier: 2,
      rule: 'Tier {tier} · the world is untouched',
      note: 'Two rows on the current fleet are this class, on different runbooks. The runbook id leaves the headline for the meta line: it identifies the procedure and never said what happened.',
    },
    {
      id: 'run.waiting.mid-procedure',
      // WP-50 GATE RULING (2026-08-21, architect). Amended in the RATIFIED
      // SOURCE rather than patched in the composer, as WP-48's amendment was,
      // so the guard and the code stay one rule and the agreement pin holds.
      //
      // `&& total > 0` REMOVED. Neither of this class's sentences reads
      // `{total}` — the headline names the checkpoint and what it awaits, and
      // the ask names the position and states that nothing has been written.
      // The clause gated a sentence on a fact the sentence never states, and it
      // withheld this row from the sheet that drew it: measured on the owner's
      // real fleet, the `cp.backup, 4 of 8` run has a GENUINELY EMPTY target
      // set, so `total > 0` failed, guard 1's own `gate === null` excluded it
      // too, and the row fell to the derived sentence.
      //
      // NEW STANDING RULE, from this: **a guard may condition only on facts its
      // sentence's claim depends on.** Gating on an unstated fact is how a TRUE
      // sentence gets withheld — and a withheld sentence is invisible, which
      // makes it worse than a false one, which at least argues with the reader.
      //
      // Mutual exclusivity still holds on `gate`: guard 1 carries
      // `gate === null` and this carries `gate !== null`. And the honest gap
      // stays honest — a gateless run whose target set is UNKNOWN (null)
      // matches neither guard and falls to the derived sentence, because the
      // record genuinely does not say what it was armed with.
      guard: 'row.kind === "run" && done === 0 && failed === 0 && gate !== null',
      headline: 'A {checkpoint} step is waiting on your {awaits}',
      ask: 'Waiting at {checkpoint}, {position}. Nothing has been written yet, so stopping here costs nothing.',
      chip: '',
      state: 'nothing written yet',
      meta: '{runbookId}',
      tier: 2,
      rule: 'Tier {tier} · the world is untouched',
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
      tier: 1,
      rule: 'Tier {tier} · mid-change, only you can move it',
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
      tier: 1,
      rule: 'Tier {tier} · nothing is holding it back but you',
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
      tier: 3,
      rule: 'Tier {tier} · the agent is asking, not the fleet',
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

  /**
   * §5 · THE DOORS. WP-54, from the owner's screen review and the designer's own.
   *
   * A door names WHERE IT GOES. "Open where you are needed" survived ratification and
   * failed its first contact with a person — the owner, reading it on the live build:
   * *"not sure what that really means."* Every door below names its destination from a
   * fact the row already carries, so the label is derived and the reader knows what the
   * click costs before making it.
   *
   * A CONTROL TAKES NO TERMINAL FULL STOP. None of these carries one, and the generator
   * enforces the rule for every control label it extracts rather than for these five —
   * the period that shipped on the row door was APPENDED by the extraction, so the fix
   * belongs to the class and not to the string.
   *
   * `backToNow` is the way back. A door that leads out with no way back is the
   * missing-front-door defect one screen deeper, which is what the re-entry shipped as.
   */
  var DOORS = {
    runAtGate: 'Open the run at {checkpoint}',
    run: 'Open the run',
    incident: 'Open {target}',
    agent: 'Open {agentId}',
    backToNow: 'Back to Now',
    note: 'Four row doors and one way back. The run doors split on whether the record holds a gate, because a run with no cursor has no checkpoint to name and inventing one would be the substitution defect in its politest form.',
  };

  /**
   * §6 · THE SEVERITY STRIPE, ratified and never shipped (Q6, 2026-08-21).
   *
   * Three pixels on the left edge, red at tier 1, orange at tier 2, grey at tier 3, and
   * NO STRIPE AT TIER 4 — the column that holds tier 4 already says what it is.
   *
   * THE GUARD, ratified with it: **the stripe encodes TIER and must never drift into a
   * severity scale.** Now that severity is confirmed present in the incident payload the
   * discipline matters more, not less: a coalesced headline may name its highest-SEVERITY
   * member while the stripe encodes the highest-TIER one, and those are different facts
   * on purpose.
   *
   * `link` is the door's colour. A door is a link and reads as one; brand green is the
   * product's own mark, not a destination.
   */
  var COLOURS = {
    tier1: 'rgb(221,18,67)',
    tier2: 'rgb(255,97,25)',
    tier3: 'rgb(198,205,208)',
    link: 'rgb(0,107,214)',
    note: 'The four values are the revised sheet\u2019s own constants (RED, ORANGE, the grey edge, and the anchor colour in its stylesheet), carried here so the build reads them from one place.',
  };

  /**
   * §7 · THE RESERVED ROW, IN THE USER'S WORDS. WP-54 item 11.
   *
   * "RESERVED · THE RECORD'S OWN HEALTH" is our noun. A person does not have a record
   * whose health they track; they have a platform that either is or is not watching their
   * sites. The row's PURPOSE is untouched — XD-23's guaranteed seat, one row, unable to
   * grow or be scrolled away — and only its name and its good-news line change.
   *
   * `quiet` replaces "the record is reporting — nothing dark, nothing late" for the case
   * where there is no news. Good news gets one quiet line, not a panel.
   */
  var RESERVED = {
    head: 'Watching your sites',
    quiet: 'Everything is reporting.',
    note: 'The heading is a question the user already asks. The quiet line is the whole of the good news, and it is deliberately the shortest sentence on the screen.',
  };

  /**
   * §8 · THE ACCOUNTING LINE. WP-54 items 9 and 10.
   *
   * TWO RULES, both from the owner's review. **The count is stated once** — it was on the
   * badge, in the accounting line and in the verdict, three renderings of one number, and
   * the verdict is the one that says something. **A zero is never enumerated**: "0 checks
   * dark" is contradicted two lines below by the reserved row saying nothing is dark, and
   * a clause about nothing is a clause that should not be there.
   *
   * "checks dark" was jargon. `dark` is the plain sentence, and it states the count and
   * stops: a DARK producer is one that has NEVER reported, so there is no duration to put
   * after it, and the designer's "in 9 hours" would have to be invented. The clause is
   * ABSENT when nothing is dark, never zeroed.
   */
  var ACCOUNTING = {
    changed: '{count} changed overnight',
    dark: '{count} checks haven\u2019t reported',
    note: 'Each clause renders only when its own count is above zero, and neither restates the verdict.',
  };

  window.NEXUS_HEADLINES = {
    runNoun: RUN_NOUN,
    templates: TEMPLATES,
    verdict: VERDICT,
    freshness: FRESHNESS,
    doors: DOORS,
    colours: COLOURS,
    reserved: RESERVED,
    accounting: ACCOUNTING,
  };
})();
