---
title: Fixture diff notes — hand-built rb-bulk-plugin-update.js vs generated declared-procedures.json
author: designer (Nexus AI UX)
date: 2026-08-18
subject: the densities hold
status: swap complete; four divergences for adjudication
---

# What the swap changed, and what it found

The prototypes (RB-D turn 1, RB-E stage density, RB-D final companion) now read two files:

- `fixtures/declared-procedures.json` — verbatim copy of `docs/intelligence/design-fixtures/declared-procedures.json`, plus `fixtures/declared-procedures.js`, a mechanical `window.NEXUS_PROCEDURES = <that json>` wrapper so a browser sheet can load it with a script tag. Both regenerate together; neither is hand-edited.
- `fixtures/scenario-bulk-plugin-update.js` — scenario narrative ONLY: site names, backup ids, the selection the run armed from, and the scope block's lines. Checkpoint order, attest classes, attest wording, badges, version, hash, capability and the provable denominator are all read from the derived data. Checkpoint labels are the document's own `reason` phrase, sentence-cased, so no label is authored either.

The hand-built file is preserved verbatim at `handoff/from-designer/rb-bulk-plugin-update.hand-built.js` for the diff.

## What matched

Checkpoint ids and order (consult-history, dry-run, approval, backup, canary, verify-canary, roll-fleet, report); every attest class; the four `unrequested` badges and which checkpoints carry them; `verifiableCount: 4`; `strictness: strict`. The substance of the transcription held.

## Divergences, for adjudication

**1 · Attest wording — the generated file and the shipped renderer disagree, and this one is not mine.**
The hand-built fixture took its three strings from `src/renderer/components/DockedPanel/procedureModel.ts` (`ATTEST_WORDS`), read on 18 Aug:

| class | procedureModel.ts (shipped renderer) | declared-procedures.json (generated) |
|---|---|---|
| event | `verified from records` | `the platform can verify this from records` |
| manifest | `verified as supplied` | `the platform can verify this from what it supplied` |
| narrative | `your account only, not verified` | `on your account only — the platform cannot verify this` |

Both are derived-looking, and they are not the same sentence. `procedureModel.ts` says its strings are "verbatim from the seam, which took them verbatim from `nexus_load_procedure`", and warns that two vocabularies would let the model's sentence and the human's drift apart — which is exactly what this table is. The prototypes now render the generated wording, because the generator is the ratified source. But the shipped panel renders the other one today, so a user comparing the panel to a sheet sees two vocabularies for one fact. This is a defect in one of the two artifacts and I cannot say which: ours renders whatever you rule.

**2 · Version — v1.0.0 → v1.2.0.**
The hand-built fixture's reference read `rb.bulk-plugin-update · v1.0.0`; the document is at 1.2.0. Fixed everywhere, including the empty run's attached plan. My transcription was stale, not wrong at the time.

**3 · Checkpoint labels were authored, and are not any more.**
The hand-built file carried display labels I wrote ("Consult incident history", "Back up each site", "Prove it before scaling it"). The generated file has no label field — it has the document's `reason` ("has this bitten us before?", "before anything writes", "prove it before scaling it"), which is what the runbook itself says. The sheets now render the reason phrase, sentence-cased. Pin 7 caught something real here: my labels were a second wording of the document's own words, and two of the eight were noticeably softer than what the runbook says.

**4 · Fields the generated file does not carry, and where they now live.**
`scope` (the block's groups, places line, from-line), the scenario `sub`/evidence text, and the card line are not in the derived data and stay in the scenario file, marked as scenario. One is worth flagging: the barred group's door now reads `Review what agents may do → cap.bulk_plugin_update`, built from the generated `capability` field rather than from my prose "plugin updates on production". That satisfies the pin that the door names the capability in the matrix's vocabulary — but if the Settings matrix labels that grant in human words rather than by id, the door should render the matrix's label and the id should be what it resolves by. Tell me which string the matrix shows and I will render that.

## Not covered by this swap

The other six runbooks are in the copied JSON and unused so far. `rb.diagnose-site` is `guided` with `steps` and `checkpointCount: 0`, which is the vocabulary distinction the sheets have never had to render — when M5's surfaces get designed, that is the shape to design against, and no sheet should invent a checkpoint for a guided runbook.
