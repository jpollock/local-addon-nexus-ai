# Testing strategy — intelligence layer

*2026-08-16. Written after M1+M2 closed, from what the packets actually
practiced and what production actually taught. Owner-approved. New packets
inherit this; the protocol's definition-of-done implements the per-packet
slice of it.*

## The principle

Green tests and a working system are separated by exactly the things only
production can tell you — so the strategy has two halves: make the test
pyramid honest (tests that test the real thing, and tests of the tests), and
make production able to speak (a system designed to degrade silently must be
instrumented to report its own degradation).

This is not theoretical caution. This project's own record: a test suite that
was green while the intelligence core silently failed to initialize for hours
(M1 ABI incident — found only by a live smoke that counted ledger events);
two test files that were vacuous copies, passing unchanged through both a bug
and its fix (filter-apply, chat-service-history); a legacy test red because a
feature (BackupGate) shipped without updating it; suites silently losing 10
tests to a worktree artifact gap and 10 more to a jest worker collision.
Every layer below exists because one of these happened.

## The pyramid, bottom-up

**1 · Unit TDD + mutation batteries** *(per packet, enforced by the protocol)*
Watched-red TDD for new behavior. Mutation testing for load-bearing
assertions, with the hard-won rules: commit before mutating; checksum guards
are necessary but NOT sufficient (a mutation can land in a comment quoting
the code); anchor substitutions to code lines; require a WITNESS — an
observable only the mutated line can produce; removals get labeled as
unpinned-by-mutation, not fake pins; unreachable caps get pinned by clamping.
Run batteries strictly between full-suite runs, never concurrently.

**2 · Integration against real seams** *(per packet)*
Real `initIntelligenceCore` on temp dirs, real SQLite, real folds, real
`registerIpcHandlers`. Never a local copy of the logic under test — a test
that imports nothing from `src/` pins nothing (two were found; hunt them:
`grep -L "from '.*src/" tests/**/*.test.ts` is the crude sweep). Cheapest
honest fixture: seed-once-assert-many; direct emission for render-only
assertions; ids derived via the real helpers, never literals.

**3 · Parity + invariant pins** *(the regression floor)*
Additive parity: with the core absent/null, every enriched surface is
byte-identical to legacy — proven both directions, mid-document splices
handled by strip-and-compare. Invariants pinned as tests: append-only ledger,
monotonic ULIDs (incl. same-ms and rewound-clock), idempotent sweeps
(second run writes zero rows), ids-identical-by-construction (service vs
pure fallback), user_link precedence in SQL.

**4 · Baseline discipline** *(per packet, protocol-enforced)*
Compare total AND skipped counts, same environment only (worktree vs primary
is invalid — artifact-gated suites skip silently). Known reds are counted
explicitly, never normalized; an undiagnosed red gets its failure TEXT
captured, not just its count.

**5 · MCP-driven e2e journeys** *(WP-18; pre-merge-to-main / pre-release)*
A runner that talks MCP to a RUNNING Local instance and executes real
journeys — enrichment renders with real ages, live re-check reconciles and
emits, a chat turn leaves a manifest event. Requires the app; skips with a
loud banner, never a silent green. This codifies the hand-driven live smokes
that caught every real incident so far.

**6 · Real-ledger replay** *(WP-18; periodic / pre-release)*
Rebuild all folds from a copy of the production ledger (the messiest fixture
we will ever have) and assert invariants hold. Catches
shape-of-real-data breakage that synthetic fixtures cannot — the fold
tie-break bug reproduced only on real data on one machine.

**7 · Degradation (chaos) tests** *(WP-17)*
The non-fatality claims, moved from comments into tests: corrupt ledger,
throwing entity service, ABI-failure path — assert the addon is unaffected
AND the health surface reports the outage. Testing graceful degradation
without testing its visibility is how silent failure gets certified.

**8 · LLM-contract evals** *(per milestone; the consolidated owner sitting)*
The model's obligations — relay staleness disclosures, stop at gates, use
handed ids, honor runbook checkpoints — tested as contracts. Deterministic
halves automated (WP-13 runner); judgment halves human-in-the-loop, marked
OWNER-PENDING, never faked. Scheduled per milestone, not remembered.

**9 · Production self-verification** *(WP-17; continuous — the top of the pyramid)*
The layer monitors itself with its own machinery: freshness SLOs applied to
the PIPELINE — per-producer last-emission liveness, fold lag, mirror
divergence, init-failure persistence, assembler manifest age — surfaced as a
read-only health tool with OK/STALE/DARK verdicts. Rationale: non-fatal-by-
construction converts failure into silent absence; graceful degradation
without observability is hidden failure. The ledger is already the sensor;
health is one GROUP BY away.

## Division of labor

Per packet (protocol DoD): layers 1–4. Pre-merge-to-main and pre-release:
layers 5–6. Continuous: layer 9. Per milestone: layers 7 (once built, then
in `npm test`) and 8. The architect audits packet receipts; the owner runs
the eval sittings and reads the health surface.

## What we deliberately do not do

No aspirational coverage targets (mutation witnesses beat percentages). No
e2e in `npm test` (environment-dependent tests that can silently skip are
worse than absent — they must be loud or excluded). No faked LLM verdicts.
No normalizing reds: every known failure is either diagnosed, owned by a
packet, or explicitly counted at every baseline.
