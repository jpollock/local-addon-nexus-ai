/**
 * Situation headlines — the ratified sentence set for the Now list.
 *
 * These are TEMPLATES, not specimens. Each carries the guard that selects it and the
 * host fields it substitutes, so `sessionRegistry`'s headline composer can be rewritten
 * without any of these words being retyped, and so a generator can extract them.
 *
 * Slots are host fields, named exactly:
 *
 *   runNoun      RUN_NOUN[row.capability] — proposed vocabulary rows, §2 below
 *   done         sites written and standing
 *   failed       sites written and failed
 *   total        size of the derived target set
 *   age          how long the situation has been waiting, already humanised
 *   checkpoint   PendingGate's checkpoint id
 *   position     PendingGate's "n of m"
 *   awaits       PendingGate.awaits — what is needed of the user
 *   target       the site's display name, resolved — never a raw entity id
 *   finding      the incident's own subject line
 *   agentId      the agent that could not finish
 *   timeout      the timeout it exceeded
 *
 * Added for the coalesced classes:
 *
 *   leadFinding  the highest-severity member's subject line
 *   restCount    memberCount - 1
 *   memberCount  how many events the situation folded
 *   linkKind     the record link that justified the fold (never a payload field)
 *
 * Added for the deferred state:
 *
 *   reason       the user's own words, from the deferral record
 *   wakeLabel    the wake condition, humanised, or the no-wake sentence
 *   deferredAge  how long ago the deferral was recorded
 *
 * Nothing here computes anything.
 */
(function () {
  /**
   * §2 · Proposed vocabulary rows — one run noun per capability.
   *
   * Controlled Vocabulary v1.3 ratified the capability LABELS ("Update plugins across
   * sites"), which name an act and do not nominalise into a subject. A headline needs a
   * noun, so these are proposed as a second column on the same rows rather than as new
   * words: same referent, subject form.
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
      door: 'Open the run',
      state: 'nothing written yet',
      meta: '{runbookId}',
      rule: 'Tier 2 · the world is untouched',
      tier: 2,
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
      door: 'Open the run at {checkpoint}',
      state: 'nothing written yet',
      meta: '{runbookId}',
      rule: 'Tier 2 · the world is untouched',
      tier: 2,
      note: 'The gate names what it needs, from PendingGate.awaits. "Nothing has been written yet" is the fact that decides how urgent this is, so it is stated rather than implied by two zeros.',
    },
    {
      id: 'run.waiting.part-changed',
      guard: 'row.kind === "run" && (done > 0 || failed > 0) && gate !== null',
      headline: '{done} of {total} are changed and the rest are waiting on you',
      ask: 'Waiting at {checkpoint}, {position}. {failed} failed. Continue, or stop and keep what is standing.',
      door: 'Open the run at {checkpoint}',
      state: '',
      meta: '{runbookId}',
      rule: 'Tier 1 · mid-change, only you can move it',
      tier: 1,
      note: 'Not on the current fleet, and the tier that matters most when it appears: a part-changed world compounding against an untouched world keeping is the whole basis of the tier 1 / tier 2 split.',
    },
    {
      id: 'incident.no-run',
      guard: 'row.kind === "incident" && row.runId === null && memberCount === 1',
      headline: '{finding} on {target}, and nothing is fixing it',
      ask: 'Contain it now, or say why not. Nothing has been written under a procedure.',
      door: 'Open {target}',
      state: 'No run attached',
      meta: '{producer}',
      rule: 'Tier 1 · nothing is holding it back but you',
      tier: 1,
      note: 'The finding is the incident\u2019s own subject line, so the headline states what is wrong rather than that an incident exists.',
    },
    {
      id: 'incident.coalesced',
      // The fold is legitimate only where the RECORD links the members. A shared payload
      // origin, a shared target, or a shared timestamp are not links — see GROUP below.
      guard: 'row.kind === "incident" && memberCount > 1 && row.linkKind !== null',
      headline: '{target} has {leadFinding}, and {restCount} more findings',
      headlineFallback: '{memberCount} security findings on {target}',
      fallbackGuard: 'no member carries a severity field, so no member can lead',
      ask: 'Contain it now, or say why not. Nothing has been written under a procedure.',
      door: 'Open {target}',
      disclosure: '{memberCount} findings \u2014 show them',
      disclosureOpen: 'Hide the findings',
      state: 'No run attached',
      meta: '{producer} \u00b7 linked by {linkKind}',
      rule: 'Tier 1 · nothing is holding it back but you',
      tier: 'the highest tier among the members',
      note: 'The headline is DERIVED from the members, never borrowed from one: target, the consequential member, and the count of the rest. A four-part situation whose headline is one part\u2019s sentence is the prepending defect one level up. The count is stated in the headline and in the disclosure, so the row needs no parts chip.',
    },
    {
      id: 'agent.stuck',
      guard: 'row.kind === "agentFailure"',
      headline: '{agentId} could not finish a run',
      ask: 'It timed out after {timeout}. Retry it, or leave it stopped.',
      door: 'Open {agentId}',
      state: '',
      meta: '{agentId}',
      rule: 'Tier 3 · the agent is asking, not the fleet',
      tier: 3,
      note: 'The one class where the subject is the platform rather than the fleet, which is why it sorts below both waiting classes however old it is. Its door is the agent\u2019s own page, which is where its permissions live.',
    },
  ];

  /**
   * §5 · GROUPING — not coalescing. A shared field is a fact; a shared cause is a
   * verdict. Where the record does not link the members, they stay separate rows
   * under a label, and the label states the limit.
   *
   * The label is NOT a card: no border, no fill, no stripe. That is the whole visual
   * difference, and it is legible without reading the words — coalescing produces one
   * bordered object, grouping produces several under a caption.
   */
  var GROUP = {
    id: 'group.by-target',
    guard: 'two or more rows share a target AND row.linkKind === null',
    label: '{memberCount} findings on {target}',
    limit: 'The record does not link these, so they are listed separately.',
    note: 'This is what the un-coalesced case renders as after WP-51. The class does not disappear when links become available \u2014 any producer that mints no TaskId, any finding from an earlier scan, and any two findings that genuinely are unrelated still land here.',
  };

  /**
   * §6 · The deferred state. Cycle two, ratified: keeps its tier, keeps its place,
   * lowers escalation only. It does not leave the list \u2014 leaving is a dismissal
   * by another name.
   */
  var DEFERRED = {
    rule: 'Tier {tier} · deferred by you — tier and place unchanged',
    recorded: 'Deferred by you {deferredAge} — {reason}',
    wake: '{wakeLabel}',
    endDoor: 'End the deferral',
    outOfBadge: true,
    appliesTo: 'the situation, never its parts — deferring one member while its siblings escalate would split a situation the platform just asserted is one thing',
    note: 'Dimmed, out of the badge, reason and wake condition on the row. Three ways it ends, each recorded: the wake fires, the user ends it early, or the situation is answered.',
  };

  /**
   * §3 · The list verdict. Generated from the rows the columns are about to render,
   * the same way the accounting line already is — so it cannot disagree with them.
   * Rendered ONCE: the badge, the accounting line and this sentence were three
   * statements of one count.
   */
  var VERDICT = {
    allUnwritten: '{needsYou} things need you, and none of them has changed anything yet',
    someChanged: '{needsYou} things need you, and {changedRuns} of them have already written somewhere',
    guard: 'allUnwritten when every waiting row has done === 0 && failed === 0',
    note: 'No single row can say this, and it is the most useful sentence the data produces: nothing is half-done, so nothing is expensive to stop.',
  };

  /** §7 · The header. An absence of zero is not an absence. */
  var HEADER = {
    away: 'You were away {age}',
    awayGuard: 'render only when the gap is an hour or more; otherwise the header is the product name alone',
    accounting: 'clauses are OMITTED when their count is zero, never rendered as "0 changed overnight" — enumerating what is not true is how a line becomes noise',
  };

  /** §4 · Freshness, and the reserved row renamed out of doctrine language. */
  var FRESHNESS = {
    replaces: 'AUTHORED.DRIFT_NO_COUNT',
    was: 'No producer reports how many facts are past their freshness window, so this line cannot state the count.',
    now: 'Freshness is not being reported yet.',
    note: 'The packet was right to author something: the contract carries no stale count, so the alternative was a fabricated number. It authored one clause too many.',
  };

  var HEALTH = {
    headingWasDoctrine: 'The record\u2019s own health',
    headingLoud: 'What Nexus can\u2019t see right now',
    loud: '{darkCount} checks haven\u2019t reported in {oldestAge}',
    quiet: 'All {checkCount} checks are reporting.',
    note: 'The ruling guaranteed this row a seat so bad news cannot be scrolled away. A quiet single line satisfies that when there is no bad news; a bordered panel announcing that nothing is wrong competes with the list it sits above.',
  };

  /**
   * §8 · Door strings carry no terminal punctuation. The shipped render appends a
   * full stop to "Open where you are needed" \u2014 which means it is appending to
   * every door string, not just that one. A control takes no terminal period.
   */
  var DOOR_RULE = {
    noTerminalPunctuation: true,
    namesDestination: 'a door says where it goes; "Open where you are needed" promises a place it cannot deliver on a row that names no gate',
    color: 'action blue rgb(0,107,214) — never brand green',
    everyRowHasOne: 'an incident with no run still has a site',
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
    group: GROUP,
    deferred: DEFERRED,
    verdict: VERDICT,
    header: HEADER,
    freshness: FRESHNESS,
    health: HEALTH,
    doorRule: DOOR_RULE,
    doors: DOORS,
    colours: COLOURS,
    reserved: RESERVED,
    accounting: ACCOUNTING,
  };
})();
