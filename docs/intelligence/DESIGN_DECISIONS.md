# Design decisions — the register

*(2026-08-18. The design workstream's architecture.md: one entry per
binding ruling, with its source. Consolidated from the designer
exchange (§0–§2, v1–v6, the scope-block drafts) and the WORK_PACKETS
adjudications. Additions go through the same ratification loop that
produced these; nothing enters by drift. XD = experience decision.)*

## The four laws

- **XD-1 · Controlled Vocabulary** (v1, +v1.1 procedure rows, +locative
  phrasing). One word per act; user strings conform or the surface is
  wrong. Source: `user-docs/your-copy-and-the-live-site.md`.
- **XD-2 · Derived, never authored.** No sentence about data where the
  data exists; counts, verdicts, freshness, receipts are generated.
  Applies to design FIXTURES too (XD-16). Source: designer §3/§5b,
  ratified throughout.
- **XD-3 · The rank model.** Chat is a rank a session is at, not a
  place: ambient / companion / stage / record; promotion not
  navigation; the procedure outranks the transcript; data is never
  inside the chat. Source: designer §0, adopted whole.
- **XD-4 · The moments model** (1.3). Six working moments + Govern;
  per-moment center/edge/never-shows; the complexity budget (cut, or
  name a candidate moment and ratify — falsifiable per §1-obj.2); the
  walk list is closed; validation by instrumented walks. Source:
  `moments-model.md`.

## Rulings, chronological

- **XD-5 · Ceremony scales with consequence** — reads quiet and
  quieter; writes loud every time, no decay. (Adopted from designer v2
  era; the moments inherit it.)
- **XD-6 · Four clocks** — moment-true / period-accumulating /
  daily-closing / streaming stay separate sentences; a source-class
  clock never claims freshness beyond its records.
- **XD-7 · Supplied vs quoted (R3)** — silent reliance is never
  claimed; causal "used" is not derivable and never asserted.
- **XD-8 · Grants, not exceptions** — default denies (destination);
  widening is visible, per-install, revocable; consent that must be
  recorded is made at a control, never elicited in chat (rank §7).
  The approval card is consent WITHIN capability and stands.
- **XD-9 · The site-at-places matrix** — environment detail dies;
  divergence is the comparator's verdict, never cell inequality;
  place-scoped facts are rows with honest absences; pre-tracking
  history says "watching since", never "unknown".
- **XD-10 · Attested is not verified** — no checkpoint renders a
  verified tick; "verify" belongs to the live check alone; ATTEST_WORDS
  render in full at both densities (shortform marks DECLINED by the
  designer, decline ratified: no second wording of the one sentence
  the seam keeps single).
- **XD-11 · Badges mean "the runbook's added prudence"** — authored
  `unrequested:` in the reviewed document, derived at render; the ask's
  mechanics and the platform's write ceremony are never badged
  (ADR-17 fourth amendment).
- **XD-12 · No self-promotion, ever, by default** — a gate escalates
  ambient rank without limit and never takes the screen; if autonomy
  ever offers self-promotion it is a grant, made where grants are made.
- **XD-13 · The consequence order** (v1.3) — within-column, over
  SITUATIONS (causal coalescing); tier 3 is the reserved slot; gates
  classify by world state; place is a set; deferral is a session act
  (user-only, wake conditions); pinned by the one-morning fixture.
- **XD-14 · The Act boundary is the declaration** — one site under a
  runbook is Act-big; N sites by N asks are N Act-smalls; the arming
  event is the observable transition.
- **XD-15 · The scope block** — four derived lines; byte-identical
  across selection bar, companion, stage; targets are CELLS (site,
  place); the arming carries the scope; split-by-authority renders the
  refusal before the gate (refusal shifted left); barred never blocks
  runnable; a later widening starts a SECOND run (hash-pinned
  procedure; approval doesn't stretch; continuity in the from-line).
  **Amended at the fold (2026-08-18):** byte-identity holds as
  FACT-identity at companion rank — headline, places, group heads
  with counts, door and from-line byte-invariant; explanation (cell
  lists, reasons) may fold behind a disclosure whose DISCLOSED text
  is byte-identical to the stage rendering. A density may defer
  explanation; it may never defer a fact, and never the door. The
  barred head and door never defer. Source:
  `from-designer/from-designer-05-companion-density-final.md`,
  ratified in `for-designer-fold-response.md`.
- **XD-16 · Fixtures come from the derivation** — one shared fixture
  file generated from `deriveDeclaredProcedure`; a checkpoint sequence
  authored anywhere, including in a design fixture, is a defect;
  transcription is authoring by another name.
- **XD-17 · Supersede, don't update** — retired candidate sheets are
  marked superseded in their headers; the shell (or the live sheet) is
  the contract; five copies are five things to drift.
- **XD-18 · The governDoor is a structured target**, not a URL —
  `{surface, section, capability, runbookId}`; the eventual surface
  resolves it; pins test resolution, not format.
- **XD-19 · The journey evals bind** — J-Glance, J-Inspect,
  J-Act-small, J-Return, J-Refusal (replacing J-Govern), plus
  J-Act-big=B-03 and J-Investigate=D-02; must-nots are the never-shows
  with teeth; judged halves are sittings; BLOCKED until surfaces exist.
  **Amended at the fold (2026-08-18):** J-Refusal's governing text is
  now the fold's spec section (both refusal states — world-state and
  grant — plus the split, the zero-cell container, and the
  offer-that-breaks-the-enforced-rule must-not, proven same-day by
  the first design sitting); re-transcription into the shipped YAML
  is WP-33b's.

- **XD-20 · Density changes rendering, never facts** — which
  checkpoints tick, what the badge says, the attest wording, the
  runbook reference appearing once, and what an empty plan produces
  are seam-governed and density-invariant; a difference between
  densities on any of them is a defect in one of the sheets, never a
  density choice. Source: RB-E's closing contract, ratified in
  `for-designer-densities-response.md`.
- **XD-21 · Empty consequence earns no container** — a declared
  procedure whose plan is zero cells opens no run and draws no
  checkpoint list; the refusal stays a turn with the derived plan
  attached and its alternatives as offers, a door where a grant is
  the answer. Source: RB-E 2c + RB-D 1b, ratified ibid.

- **XD-22 · Guided renders steps, never checkpoints** — a guided
  runbook (`steps`, `checkpointCount: 0`) never renders a checkpoint
  rail, a tick, a denominator, or an attest line; inventing a
  checkpoint for a guided document is the XD-16 defect in a new
  costume. M5's surfaces are designed against `rb.diagnose-site`'s
  real shape. Source: designer `fixture-diff-notes.md`, ratified in
  `for-designer-fixture-diff-response.md`.

- **XD-23 · The ambient triage** — waiting and changed are two
  columns of one verdict; every row shows the rule that placed it
  (the sort inspectable where it is used); causally linked events
  render as one situation at its highest tier with parts stated; the
  reserved epistemic row is always one row and cannot grow or scroll
  away; drift renders nowhere and the panel says where it went; no
  dismiss — a row leaves only by being answered. Deferral: user-only
  (an agent lowering its own gate's escalation is eliciting
  inattention — the self-promotion power inverted), keeps tier and
  position, lowers escalation only, recorded on the run with reason
  and wake condition; ends by wake (condition named), early end
  (also a session act, also recorded, superseding), or answer. The
  ambient badge counts situations CURRENTLY ESCALATING — an
  instrument, not an inventory — and the panel's accounting line
  states deferrals so the count never reads as the whole truth.
  Badge loudness stays inside the design system; a variant proposal
  requires sitting evidence (J-Glance's judged half). Vocabulary:
  deferred / wake / end the deferral (v1.2 rows). Source: designer
  "Ambient triage" sheet, ratified in
  `for-designer-triage-response.md`.

- **XD-24 · The corroboration render** — draws what the model marked
  and nothing else (no similarity matching, no classifier, no
  reclassification after writing); existence checked against the
  task's supply, support never checked at render (the eval's
  question); three states with unresolvable the LOUDEST (a claim
  pointing at a record nobody supplied looks like evidence — worse
  than pointing at nothing); strictness set by the moment
  (Investigate loud on uncited facts, Glance renders no citations);
  a citation is a trailing door at the end of its claim — never a
  superscript, never a footnote list, never a copy of the record's
  contents ("a copy is a second place a fact can be wrong"); trust
  label inherited verbatim, no invented score or confidence;
  pre-convention sessions say the convention did not exist rather
  than rendering every sentence as choosing to go uncited; judge and
  render resolve through ONE join. Marker: the system's Chip, system
  face (mono variant only on sitting evidence); tool-call citations
  stay the trace's own words. Source: designer "Corroboration
  render" sheet, ratified in
  `for-designer-corroboration-response.md`.

- **XD-25 · The Govern matrix** — every row a capability the registry
  serves, every fact derived (document, version, pinned hash, the
  attestable-vs-narrative split from the checkpoints themselves); a
  capability arrives denied and no row is granted because a document
  exists; the production rows render "Never by default" — disclosed
  and actionable, not quietly absent; a door lands on the ROW; a
  grant states the act that made it from its own event; DISARMED is
  granted-and-not-in-force, never denied (the switch renders consent,
  the chip renders force — an integrity failure is the platform's
  report, not a revocation); the gates column is derived and never
  softened ("the grant itself, and nothing after it" on granted rows
  as loudly as denied), and its PIN is the property that it moves
  when the document does; the act is a control — no conversational
  route in or out; one capability at a time; no health score; no
  runbook copy. Labels are ratified vocabulary rows with the id in
  mono beside them — the refusals cite ids. Source: designer "Govern
  matrix" sheet, ratified in
  `for-designer-govern-matrix-response.md`.

- **XD-26 · Return — the arrival and the re-entry** — the arrival is
  two columns of ONE VERDICT (waiting / changed), each sorted within
  itself by the consequence order, rendered with no interaction and no
  question asked; the headline is about the user's absence with the
  accounting line in one breath; every waiting row names the gate it
  waits at BY CHECKPOINT ID from the session's own cursor; opening a
  row PROMOTES the session — same session id, same cursor, same
  pending approvals, and a promotion that loses anything is a defect;
  an approval given before the excursion renders as STANDING with its
  moment, never re-asked; the declared list, order, attest words and
  denominator are read from the runbook document; the record for
  finished work exists before the user arrives; the reserved health
  row cannot grow or scroll away; marks discipline — the tick belongs
  only to an attested provable checkpoint, a reached narrative
  checkpoint is recorded-not-proved and takes the neutral dot,
  identical across the densities and this surface ("a difference
  between the densities and this sheet would be a defect in one of
  them"). Unknown-arm: the platform names ITS OWN limit ("cannot
  establish"), never an invented procedure state; nothing armed; the
  run stays in the record. No scrollback as re-entry; no
  everything-since-you-left prose; no second approval; no badge on
  changed. COPY RATIFIED (2026-08-19, fixtures received): the 6c
  strings ("This session was running a procedure, and the platform
  can no longer say which" + body, two doors), the class-derived
  absence line ("This file is a drop-in, so no place records a
  version for it. The dashes are not missing data — there is nothing
  here that varies by place."), and the disarmed-band reason line
  ("The document on disk is not the one this grant was made against.
  Not staleness — the review this grant carries happened against
  different text, so the capability behaves as though it were never
  granted.") — recorded verbatim in
  `from-designer/from-designer-09-return-arrival.md` and
  `from-designer/fixtures/scenario-return.js`. Source:
  designer "Return arrival" sheet (cycle five), ratified in
  `for-designer-return-response.md`.

## How a ruling gets here

Designer position or architect note → ratification response (both
recorded) → entry in this register → where load-bearing, a pin or a
fixture. A ruling without a register entry binds nobody; an entry
without a source document is a defect in this file.
