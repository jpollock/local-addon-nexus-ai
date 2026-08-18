# Testing strategy — intelligence layer

*2026-08-16, refreshed 2026-08-18 after WP-20 phase 2, the eval flip, two
owner sittings, and the first UX packets. Owner-approved. New packets
inherit this; the protocol's definition-of-done implements the per-packet
slice. The refresh absorbs doctrine that had accumulated in WORK_PACKETS
and PARALLEL_PROTOCOL — this doc is again the one a new engineer reads
first. Current base: ~7,350 tests / 565 suites, all green, intelligence
and legacy suites in one `npm test`.*

## The principle

Green tests and a working system are separated by exactly the things only
production can tell you — so the strategy has two halves: make the test
pyramid honest (tests that test the real thing, and tests of the tests),
and make production able to speak (a system designed to degrade silently
must be instrumented to report its own degradation).

This is not theoretical caution. The project's record, which every layer
below exists to answer: a green suite while the core silently failed to
initialize for hours (M1 ABI incident — found by a live smoke counting
ledger events); vacuous copied tests passing through a bug AND its fix;
a harness that would have scored the model on the harness (missing tools,
found at WP-20e); an anchor capability refused FOREVER in the product
because the probe supplied the approval the product could not (WP-26);
a renderer one value-import away from loading a native module jest could
never see fail (WP-27); an arming queue leaking across runs so no two
sitting trials were identical (WP-24); and an eval-flip battery that went
2/8 because every test asserted the checks pass and none that they could
fail (WP-20e).

## The pyramid, bottom-up

**1 · Unit TDD + mutation batteries** *(per packet, enforced by the protocol)*
Watched-red TDD. Mutation testing for load-bearing assertions with named
WITNESSES, and the doctrine hardened by four real incidents: commit before
mutating; checksum guards are necessary but not sufficient; a COMPILE
ERROR is not a kill — rewrite mutations type-clean and demand an
assertion failure; an `import type` flip is ELIDED and mutates nothing —
the witness must recreate the whole pre-fix construct, value import and
runtime use; jest's `toEqual` treats an undefined element as absent — when
presence is the assertion, `toStrictEqual` or assert length; and a witness
cannot kill a difference no fixture exhibits — nearest-vs-first survived
until a two-narrative runbook existed, so build the fixture that exhibits
the difference. Run batteries strictly between full-suite runs.

**2 · Integration against real seams** *(per packet)*
Real `initIntelligenceCore` on temp dirs, real SQLite, real folds, real
handlers. Never a local copy of the logic under test — a test importing
nothing from `src/` pins nothing. Where a boundary FORBIDS the real
import (the renderer must not value-import the intelligence-host seam —
77 modules, 13 of them better-sqlite3, invisible under jest and fatal
under Electron), the treatment is `import type` + mirrored values pinned
by a shared case table, PLUS an import-graph isolation pin in its own
suite that imports nothing from the seam — a graph pin that participates
in the graph pins nothing.

**3 · Parity + invariant pins** *(the regression floor)*
Additive parity, both directions: core absent → byte-identical legacy
output; nothing armed → byte-identical turn and byte-identical panel.
Parity pins are RE-POINTED when the floor legitimately moves (no-grants
replaced no-arming when grants shipped enabled) — an obsolete pin
preserved is a lie of its own. Invariants as tests: append-only ledger,
monotonic ULIDs, idempotent sweeps, refusals emit no execution event
(nothing in the ledger may claim an act that did not happen, in either
direction), the hash and the ceiling measure the same canonical text.

**4 · Baseline discipline** *(per packet, protocol-enforced)*
Exit code captured before any pipe. Compare total AND skipped counts —
the model-file boundary moves ten embedding tests between skipped and
passed across checkouts (both directions observed). The tree must hold
still for the run to be a baseline. Environment before diagnosis: the
poisoned ts-jest cache (four occurrences — one unrelated suite failing
to parse), the mid-session ABI flip (shared node_modules; a suite that
just passed fails with NODE_MODULE_VERSION — or, masked, with a nonsense
undefined-read when a fixture catches its own init failure). Verify a
fix on the path that exercises it, not the path that exits first.

**5 · MCP-driven e2e journeys** *(WP-18; pre-merge-to-main / pre-release)*
Real journeys against a running Local over MCP; loud skip, never silent
green.

**6 · Real-ledger replay** *(WP-18; periodic / pre-release)*
Rebuild all folds from a production-ledger copy — byte-identical over
9,472 real events at last run. Catches shape-of-real-data breakage no
synthetic fixture can.

**7 · Degradation (chaos) tests** *(WP-17; in `npm test`)*
Non-fatality claims as tests: the addon unaffected AND the health surface
reporting the outage. A ledger fault refuses only the sequenced
capability; the fail-closed bundle carries its own reason. Degradation
without visibility is silent failure certified.

**8 · The eval framework** *(runner + probes; per milestone and per flip)*
Five verdicts with BLOCKED-never-green and exit 2 while any BLOCKED
remains — the runner refuses to call a milestone done. Criteria bind to
checks by exact substring; an unbound criterion is BLOCKED, never
assumed. Since WP-20e the programmatic half drives a REAL end-to-end
procedure run through production seams (grant → arming → carrier → five
gate decisions), and the design rule from its own 2/8 incident is
doctrine: probes report facts, the check does the conjunction, and every
check has a can-fail test — **a check that can only be watched passing is
not yet a check. Eval code is code.** Harnesses must supply the world the
product supplies (approval producers, update tools) or they score the
model on the harness.

**9 · Owner sittings** *(live model + human judge; the practice matured)*
The judgment half of the evals: real assembler, real chat loop, real
gates, live model, transcripts captured with the full tool trace. H-01:
pass³ for gated writes — a single green run is not a result; runs must be
IDENTICAL trials (the arming-queue leak made them not, once). Fabrication
is judged against the captured trace, never plausibility: any historical
claim not in the carrier or a tool result is a FAIL. Abstain twins run
beside planted variants (invented caution in the empty world fails).
Verdicts and their reasoning are recorded in WORK_PACKETS; a borderline
pass states why it passed under the same standard that failed another.

**10 · Adjudicated live smokes** *(per shipped surface; the layer the
practice added)*
Every new producer or surface gets one real-world run judged like a
packet report: the first-real-pull (all four lights at once — producer
DARK→OK, ledger +2, chip recount, where-am-i lineage), the phase-1 UX
run (the runbook holding against explicit user pressure on day one).
Findings are registered, not waved at; when human memory disagrees with
itself, the ledger is queried — the record, not recollection, is the
arbiter. The smoke is where the M1 incident's lesson lives permanently.

**11 · Production self-verification** *(WP-17; continuous — the top)*
The layer monitors itself with its own machinery: per-producer liveness,
fold lag, mirror divergence, init-failure persistence, surfaced as
OK/STALE/DARK. Control-plane events are excluded from observational
coverage claims — "nothing recorded yet" must stay reachable. DARK is a
truthful state: it held for three beats until the first real pull
existed, then flipped. The ledger is the sensor; health is one GROUP BY
away.

## Division of labor

Per packet (protocol DoD): layers 1–4. Pre-merge-to-main / pre-release:
5–6. Continuous: 11. Per milestone or eval flip: 7–8. Per shipped
surface: 10. Sittings (9): owner runs, architect judges, both recorded.
The architect audits packet receipts and verifies fidelity by hash; the
agents commit uncommitted architect work verbatim and flag it — the
record audits everyone, including the architect (two incidents, both
caught by the machinery: a stale-copy clobber stopped by restoration,
an unguarded write stopped by the mtime guard).

## What we deliberately do not do

No aspirational coverage percentages — line coverage measures execution;
witnesses measure detection; we gate on the latter. No e2e in `npm test`
(silently skippable tests are worse than absent). No faked LLM verdicts —
OWNER-PENDING renders as pending, never pass. No normalizing reds. No
harness that answers the product's questions for it. And no sentence in a
test name that its assertions cannot cash — the same rule the UI lives
under, applied to the suite.

## Known gaps, owned

No true UI e2e (nothing drives the rendered panel inside Electron — the
renderer/Electron boundary is where two recent finds lived; candidate
for phase-1.5's DoD). D-02 and E-01's first criterion blocked on the
incident producer (WP-25). E-02's transcript half owned by WP-18.
Concurrency untested (session-unkeyed arming queue, registered). The
detectDrift 30s flake on watch — recurrence buys it a packet.
