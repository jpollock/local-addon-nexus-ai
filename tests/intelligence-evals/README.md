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

## `sitting.ts` — the live-model sitting harness (WP-13b)

**Separate program, separate job.** `run.ts` reports what the platform can and
cannot support. `sitting.ts` captures what a real model actually does on the
real chat surface, so the owner can judge E-01's six OWNER-PENDING criteria by
reading transcripts instead of driving a UI.

**It spends real API tokens and is never part of `npm test`.** `main()` is
guarded by `require.main === module`, and `sitting.test.ts`'s first test pins
that guard — a regression there would turn `npm test` into a metered API bill.
Every run prints its cost warning before it starts and its measured payload
sizes after.

```bash
# The smoke run — ONE model call, one transcript. Do this first.
NEXUS_EVAL_API_KEY=<key> npx ts-node --project tsconfig.test.json \
  tests/intelligence-evals/sitting.ts --runs 1 --out /tmp/wp13-sitting-smoke

# The sitting proper — H-01's pass^3.
NEXUS_EVAL_API_KEY=<key> npx ts-node --project tsconfig.test.json \
  tests/intelligence-evals/sitting.ts

# E-01's abstain twin — same prompt, no planted history. Score the pair together.
NEXUS_EVAL_API_KEY=<key> npx ts-node --project tsconfig.test.json \
  tests/intelligence-evals/sitting.ts --empty-history --out /tmp/wp13-sitting-empty

npx ts-node --project tsconfig.test.json tests/intelligence-evals/sitting.ts --help
```

Writes `run-<n>.md` plus `judgment-sheet.txt` to `--out` (default
`/tmp/wp13-sitting`), mode 0600. Exit `0` clean · `1` a run errored · `2` bad
arguments, no key, or the wrong native-module ABI.

### Why the OWNER-PENDING instructions needed replacing

WP-13's six pending criteria print "point a development build at the fixture
dataDir, open the Docked Panel with a fixture site selected". The architect's
2026-08-17 note found that is **not literally executable**: the fixture seeds
the LEDGER only, so the six fixture sites do not exist in Local's site store,
the panel cannot select one, and with no fixture target the assembler never
retrieves the planted history. The judgment sheet this harness prints says so
and supersedes those instructions with transcript paths.

### What is real, and what is not

| | |
|---|---|
| **real** | the fixture core, ledger, webhook producer and folds; `assembleForChatTurn` and the assembler; `ChatService` (system prompt, per-turn carrier, agent loop, PII masking, tool adapter); the real `ToolRegistry` with real safety tiers; the model call |
| **fixture** | the four tool *handlers*, which answer from the fixture's own twin facts (`sittingWorld.ts`); `bulk_plugin_update`, which is simulated and says so in its own result |
| **absent** | the product UI. No renderer exists, so an approval card cannot be clicked — it renders as text and `--approvals deny\|approve` decides the answer |

That statement is reproduced verbatim in every transcript header, because a
reader who opens one file in isolation must not have to infer what they are
looking at.

The tool surface is deliberately **closed**: exactly `nexus_list_sites`,
`wp_plugin_list`, `find_sites_with_plugin` and `bulk_plugin_update`. The
fixture `NexusServices` omits `localServices`, `graphService`, `searchService`
and `operationAuditLog`, so there is no path by which a tool could quietly
answer from the owner's real fleet, read real chat history, or append to the
compliance record. A tool that lied about the fixture would not add noise — it
would invalidate the judgement.

### The key

`NEXUS_EVAL_API_KEY` first; otherwise the product's own path, mirrored from
`chat-ipc-handlers.ts` (`KeyVault(registryStorage, STORAGE_KEYS.API_KEYS)` →
`encrypted_<provider>`, then the legacy plain-text blob). The one thing that
cannot be mirrored is decryption: `KeyVault` decrypts through Electron's
`safeStorage`, which is keychain-backed and exists only inside Electron. An
Electron-encrypted value is therefore **refused with the env-var remedy**, never
guessed at — `KeyVault`'s own no-safeStorage fallback would hand the API a
base64 ciphertext and produce a 401 that looks like a bad key. The key is never
printed and never written to disk: every transcript, the console summary and
both crash paths run through `scrubSecrets`.

### Two follow-ups WP-13b deferred — both taken in WP-13c

1. **`createEvalFixture({ plantIncidents })`.** The empty-history twin used to
   mirror `seedFleet`'s ten-line loop inside `sittingWorld.ts`. There is now one
   seeding path: the option gates the planted *history* alone, so the two halves
   of E-01's act/abstain pair cannot disagree about which sites exist, what they
   run, or that the halted one reports nothing. `sitting.test.ts` pins that the
   option changes the history and nothing else.
2. **The ABI remedy is shared.** `nativeModuleRemedy()` lives in
   `nativeModule.ts` and both CLIs call it, so `run.ts` no longer inherits a
   bare `NODE_MODULE_VERSION` stack trace — it prints the `npm run pretest`
   remedy and exits 2, like the sitting harness. Pinned in
   `nativeModule.test.ts`, including the ordering property (the preflight has to
   run before anything opens the ledger).

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
- `sittingWorld.ts` — WP-13b. The fixture `NexusServices`, the real
  `ToolRegistry` loaded with four fixture-backed handlers, and the
  empty-history twin of the fixture.
- `sitting.ts` — WP-13b. The live-model CLI: key resolution, provider capture,
  transcript rendering, judgment sheet. **Spends tokens; never in `npm test`.**
- `sitting.test.ts` — WP-13b's deterministic half, including an end-to-end pin
  that drives the whole harness with the model call scripted, so "the planted
  incident reaches the model in the turn block" is measured on every `npm test`
  at zero cost.

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
