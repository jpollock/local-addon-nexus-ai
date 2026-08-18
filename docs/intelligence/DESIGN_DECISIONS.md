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

## How a ruling gets here

Designer position or architect note → ratification response (both
recorded) → entry in this register → where load-bearing, a pin or a
fixture. A ruling without a register entry binds nobody; an entry
without a source document is a defect in this file.
