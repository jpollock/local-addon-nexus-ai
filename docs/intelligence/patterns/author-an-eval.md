---
id: pat.author-an-eval
kind: runbook
version: 1.0.0
strictness: guided
audience: ai-engineering-agent
exemplars:
  - docs/intelligence/anchor-slice/evals/B-03-runbook-push-with-capability.yaml
  - docs/intelligence/anchor-slice/evals/E-01-consult-before-risk.yaml
  - docs/intelligence/anchor-slice/evals/E-02-emission-on-completion.yaml
  - tests/evals/cases/M4-08-access-push-production-blocked.yaml   # house dialect, negative test
  - tests/evals/cases/M6-03-investigate-recent-changes.yaml       # honest-gap pass condition
reference: docs/intelligence/eval-stress-test-set.md              # families, harness rules H-01..H-07
checkpoints:
  - id: cp.claim
  - id: cp.fixture
  - id: cp.pass-condition
  - id: cp.must-not
  - id: cp.twin-variant
  - id: cp.verify-programmatically
---

# Pattern: author an intelligence-layer eval

Every eval here exists to test one claim of the supply-chain model — not to
test "does the agent seem smart."

## cp.claim

Name the single model claim under test in the yaml `description` (e.g.
"pushed runbook beats improvisation", "history consulted changes the plan").
If you cannot name the claim, the eval is unfocused — check the eval doc's
family list (A: source/trust, B: distribution, C: governance, D: procedure,
E: loop, F: adversarial) and find where your case belongs.

## cp.fixture

Fixtures are explicit and resettable: what sites exist, what history is
planted, what settings are set. Reuse fixtures across evals where possible
(B-03 and E-01 share one incident fixture deliberately). Never depend on the
author's live fleet state.

## cp.pass-condition

Pass conditions assert BEHAVIOR VISIBLE IN THE PLAN OR END STATE, not tool
calls in the trace ("plan sequences gateway-X sites last" beats "queried
history"). For honest-gap/negative cases, the pass condition is the quality of
the disclosure — follow M6-03's shape.

## cp.must-not

The `must_not` block carries the sharp edges: fabrication, silent partial
coverage, claiming unqueried sources, "half-adherence" (citing the rule then
ignoring it). Steal from the house suite's phrasing — it is unusually good at
these.

## cp.twin-variant

Any eval that tests refusing/blocking/caution ships with its act twin (and
vice versa), scored as a pair — an agent that always refuses or always
complies must be unable to score. E-01's notes show the pattern.

## cp.verify-programmatically

Anything checkable against the ledger or fixture end-state is asserted
programmatically, not judged (H-02). LLM judgment is reserved for register and
clarity. If the eval verifies ledger contents, key assertions on the run's
`correlation` id and validate envelopes against
`docs/intelligence/anchor-slice/schemas/event-envelope.schema.json`.
