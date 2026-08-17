# `tests/intelligence-evals/` — the anchor-slice eval runner (WP-13)

Loads `docs/intelligence/anchor-slice/evals/*.yaml`, executes what can be
executed against the **real** intelligence core, and reports **per criterion**
with evidence. It never fakes a model judgement and never lets an absence read
as a pass.

```bash
npx ts-node --project tsconfig.test.json tests/intelligence-evals/run.ts
npx ts-node --project tsconfig.test.json tests/intelligence-evals/run.ts --only E-02-emission-on-completion
npx ts-node --project tsconfig.test.json tests/intelligence-evals/run.ts --json
npx ts-node --project tsconfig.test.json tests/intelligence-evals/run.ts --seed-dir /tmp/wp13-fixture
npx jest tests/intelligence-evals            # the deterministic half, in npm test
```

Exit codes: `0` nothing failed and nothing was unanswerable · `1` a FAIL ·
`2` a BLOCKED or a spec-level defect (nothing broken, but the run could not
answer the question). Two codes because "it failed" and "we could not check"
call for different responses.

## Scout note — why a new tree, and what it does not reuse

`tests/evals/` already holds a 30-case suite in the **same YAML dialect**, and
its runner was considered first. It is not reusable here:

| | `tests/evals/runner/` | this runner |
|---|---|---|
| what it executes | nothing — prints prompts for a human, or shells out to `claude -p` | the real intelligence core |
| what it verifies | a human types scores into `score-eval.ts` | ledger state, assembled bundles, envelope schema |
| spec validation | none; `key_steps` is typed `string[]` and trusted | zod, with rejection reasons |
| unit of result | one weighted score per case | one verdict + evidence per criterion |

Those are different jobs, not different implementations of one job. The house
runner measures a model; this one measures whether the platform can support the
eval at all. Reusing it would have meant retrofitting programmatic verification
into a transcript scorer.

**It is excluded from `npm test` today and that is not a bug** —
`jest.config.js` `testPathIgnorePatterns` carries `/eval/`, which matches
`tests/eval/` (chat quality) and `tests/evals/`. It does **not** match
`tests/intelligence-evals/`, so this tree runs in `npm test` with no config
change. That was checked, not assumed.

**One thing WAS reused: the dialect.** Specs here parse with the same field
names the house suite uses, so a case can move between the two.

## The five verdicts

| verdict | meaning |
|---|---|
| `PASS` | a check ran against the real core and held |
| `FAIL` | a check ran and did not hold — a real defect |
| `BLOCKED` | checkable in principle, but a **named** capability does not exist. Carries a probe that *demonstrates* the absence |
| `OWNER-PENDING` | needs live model judgement (H-02). Carries the verbatim human prompt and run instructions |
| `SPEC-DEFECT` | the criterion contradicts a standing ruling or a code contract; the record gets fixed, not worked around |

Assignment is by a fixed precedence: executable → blocked-with-probe → judged →
spec-defect. **Rule 2 outranks rule 3 on purpose.** You cannot hand an owner a
prompt to judge a run whose premise cannot be constructed; filing that as
"pending" parks a platform gap in a human's queue forever.

A criterion with **no registered check is `BLOCKED`, never `PASS`**
(`runner.test.ts` pins it). An unchecked obligation that reads as met is the
vacuous-guard shape this harness exists to prevent.

## Files

- `specLoader.ts` — YAML → `EvalSpec`. House style is WP-08's law loader:
  js-yaml + zod, never throws, a malformed spec is rejected with a reason and
  its siblings still load, duplicate ids rejected in deterministic order.
- `fixture.ts` — the shared B-03/E-01 fleet, seeded through **real producers**
  (`core.tap` → `draftFromWpEvent` → `Emitter` → folds) on a temp SQLite ledger.
- `probes.ts` — observations of the real core. Probes produce evidence; they
  never decide verdicts.
- `checks.ts` — one adjudication per criterion, bound by an exact substring of
  the criterion text (not by index — indices renumber silently).
- `jsonSchemaCheck.ts` — a ~120-line draft-2020-12 **subset** validator, so
  E-02's schema criterion checks the JSON file on disk rather than re-checking
  the zod schema the events were already admitted by. **Any keyword it does not
  implement throws**; a validator that silently ignores what it does not
  understand always passes.
- `runner.ts` / `report.ts` / `run.ts` — orchestration, rendering, CLI.

## Why the runner is not itself a jest suite

A jest run must be green or red. An eval sitting needs a printed prompt for a
human to act on. Folding the two together would force every judged criterion
into a fake boolean — exactly what the packet forbids. So: the runner is a
library plus a CLI, and `runner.test.ts` drives it and asserts the honesty
rules (evidence present, BLOCKED names its gap, OWNER-PENDING carries a
runnable prompt, PASS never rests on model behaviour).

## Adding a criterion

1. Add it to the YAML. **Quote any value containing `": "`** — unquoted, YAML
   reads the sequence item as a mapping and the criterion silently changes
   shape. Two of the three anchor specs had this defect; `specLoader.test.ts`
   now guards it.
2. Add a check to `checks.ts` binding to a distinctive substring of the text.
   `checks.test.ts` fails if you skip this (orphaned criterion) or if your
   matcher binds to nothing (dead check).
3. Give the check real evidence. `report.test.ts` renders "no evidence
   recorded — this is a defect in the check" if you do not.
