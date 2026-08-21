---
title: Cycle seven — When the procedure is the customer's, not ours
author: designer (Nexus AI UX)
source: Authoring a procedure.dc.html (design component, project "UX Prototyping for Intelligence Docs")
date: 2026-08-21
answers: the cycle seven ask — six questions, a journey eval, and one refusal
status: proposed
---

# When the procedure is the customer's, not ours

*M7 Govern · not a seventh moment*

A customer writes a procedure. The question this cycle answers is not what the editor looks like — it is what every surface already drawn has to say about a document whose author is the person reading the screen.

## 0 · The reading that governs the sheet

One thing from the tree changes the shape of the answer, and it is not what the ask assumed.

**Attestation is authored today, for our documents too.** `runbookRegistry.ts` takes `raw.attest ?? 'narrative'` from the frontmatter and applies one structural guard: an `event` claim must name *some* evidence topic. It never checks that the topic exists, that any producer emits it, or that this checkpoint's tools produce it. What has been holding that is ops writing the documents — a social guarantee wearing a mechanical one's clothes.

So question 2 is not "what may a user document claim." It is "why does any document get to claim this."

## 1 · Provenance, everywhere (question 1)

**Quietly, and always.** A chip the same size as a citation's, present at every mount that names a document — declared block, approval card, Govern row, record — never loud unless something is wrong. A user document is not suspect; it is differently owned.

**Both origins carry a word.** `yours` for a document written in this install, `ships with Nexus` for one the addon carries. Marking only one would make the other's origin something the surface infers from an absence, and origin is never inferred.

## 2 · What a user document may claim (question 2)

**The class is derived, for every document, whoever wrote it.** From what the platform can actually check: does the named ledger topic exist, and do this checkpoint's tools emit it. The author names an evidence topic because that states their intent; the class follows from whether the platform can check it.

**Nothing is declined.** The document is read, and the reading is shown while it is being written rather than discovered at a gate. The worked example — a six-checkpoint handover runbook — claims four provable checkpoints and gets two:

| Checkpoint | Declared | Derived | Why |
|---|---|---|---|
| cp.backup | event | **event** | `wpe_backup_and_verify` emits `task.action.executed` |
| cp.freeze-plugins | event | **narrative** | Nothing emits `plugins.frozen` |
| cp.notify-client | event | **narrative** | Nothing emits `client.notified` |
| cp.handover-call | narrative | narrative | A call between people |
| cp.transfer-ownership | manifest | manifest | In the assembled manifest — supplied, not done |
| cp.close-engagement | narrative | narrative | No tool, no topic |

The words each class renders are the seam's, read from the derived fixture and never written on the sheet: *event* → "the platform can verify this from records"; *manifest* → "the platform can verify this from what it supplied"; *narrative* → "on your account only — the platform cannot verify this".

The sentence the author reads:

> **Nothing records `plugins.frozen`.** You asked the platform to verify this step from records. No producer writes that topic, so there is nothing for it to look for. This step will read as narrative — the platform will say what it can stand behind, not what you claimed.
>
> Keep the step. It still runs, it still gates, and it still appears in the record — it just will not carry a claim the platform cannot check.

**The seven shipped documents go through the same derivation.** If one loses a class, that is a finding about that document, never a reason to exempt it.

## 3 · The Govern matrix with a customer's document (question 3)

The gates column needs nothing new — it is derived, so a customer's document produces "2 of 6 checkpoints the platform can verify" the same way ours produces "4 of 8".

What it does not carry is the fact that separates the two rows: **who can change the document.** That is a fifth column.

- *yours* — "You can change it, and a change disarms this grant."
- *ships with Nexus* — "A Nexus release. You will be told when it does."

Both state the same mechanism from different sides. Neither is a warning: a document you can change is differently governed, not more dangerous.

## 4 · The refusals, with a face (question 4)

A refused document **stays in the list**, not running, with what is wrong, where in the file, and what would make it load. Its siblings load. Its refusal is recorded rather than logged.

The three registry codes, each drawn:

- **invalid-frontmatter** — "This document names a checkpoint twice." · `checkpoints[4].id` · *Two steps cannot share an id: the run would not know which one it was at.*
- **over-ceiling** — "This document is too long to be delivered whole." · 11,204 of 10,240 bytes · the registry's own reason quoted verbatim · *Split it. Two procedures that each fit are two things you can grant separately, which is usually what a document this long wanted anyway.*
- **duplicate-capability** — "Another document already serves this capability." · *Two documents for one capability would make the platform choose between them at arming time, and choosing is authoring.*

A document that vanishes teaches the author the platform lost it.

## 5 · The disarm, when you are the author (question 5)

The state does not change and the name does not change — the pin broke, and it broke the same way. What changes is the second sentence and the door.

- *When we changed it:* "The document on disk is not the one this grant was made against." → **Review the change and re-issue the grant**
- *When you changed it:* "You edited this document 20 minutes ago. The grant was made against the version before that edit." → **See what changed, then re-issue**

Saying the first sentence to the person who made the edit twenty minutes ago is the platform pretending not to know.

## 6 · Where authoring lives (question 6)

**Govern. Not a seventh moment.** Writing a procedure is changing what agents may do — a different grain from issuing a grant, the same act: deliberate, made at a control, recorded, never elicited in conversation. A seventh moment would split Govern by artifact type, which is the error of splitting Return by whether a run halted.

## 7 · J-Author — a procedure of your own, from writing it to running it

**Must**
- The derived reading of every checkpoint is visible while the document is being written, with the reason each class was derived.
- A checkpoint whose claim the platform cannot check reads as narrative and says why, naming the topic that nothing emits.
- A refused document names what is wrong, where in the file, and what would make it load — and stays visible in the list of your procedures.
- Every surface that names the document renders its origin, and the same origin word appears at every mount.
- Editing a granted document disarms the grant, and the disarm names the edit the author made rather than describing a mismatch in the abstract.
- Arming the customer's procedure produces the same declared block, marks and attest words as a shipped one — one seam, whoever wrote the document.

**Must not**
- A green tick, or any attest word above narrative, on a step the platform cannot check.
- A document's authored attest class rendered anywhere as though it were the platform's reading.
- A refused document that disappears, or whose refusal reaches only a log.
- A shipped document rendering no origin while a user document renders one.
- A disarm that tells the author their document does not match, without saying which edit or when.
- Any path from a conversation to writing, editing, importing or reloading a procedure.

**Programmatic:** derived class equals the platform's own check for every checkpoint of every loaded document, shipped ones included; refusal payload carries code, path, field and remedy; origin present at every document mount, asserted per mount; grant state after an edit equals disarmed with the editing event's id on the record; declared-block output for a user document and a shipped one differ in origin and content only — never in marks, wording or denominator shape.

**Judged sitting:** Give someone a procedure they wrote that claims more than the platform can check. Can they tell, without being told, which of their steps the platform will be able to prove — and do they believe the platform is being straight with them rather than refusing their work?

## 8 · The one thing I would refuse to build

**A two-tier attestation, where a customer's document is narrative-only and ours is trusted because we wrote it.**

It encodes origin as trust: our documents can prove things because we wrote them, theirs cannot because they did not. That is precisely the claim the corroboration render refuses — a citation is not believed because of who wrote the sentence; it resolves or it does not, and the render says which.

It is also not the safe option it looks like. Narrative-only means every checkpoint of every customer procedure is unprovable, so the Govern row reads "the grant itself, and nothing after it" forever — and a person granting it is told the platform can check nothing, when for some of those steps it can check perfectly well. Under-claiming is a different dishonesty from over-claiming, not an absence of one.

And it hides the real defect. Attestation is authored today, in our documents, with a guard that checks a claim is well-formed rather than true. A two-tier rule would leave that in place and put a fence around customers instead — so the day someone writes a runbook for us, or an ops document is edited under time pressure, the fabricated tick arrives from the trusted tier.

**What I would build instead:** one rule for everyone. The platform derives what it can prove, shows that reading while the document is being written, and applies it to the seven documents that ship today as the test that the rule is honest. If our own documents come through unchanged, the rule has cost nothing. If one does not, we have found something worth finding.

## 9 · What is absent, and on purpose

- No editor chrome on the sheet. What the text editor looks like is the least interesting question here and the one most likely to distract from the six that matter.
- No linting, no severity levels, no warnings-versus-errors. A document loads or is refused, and the derivation is a reading rather than a critique.
- No score, no quality rating, no "strength" of a procedure. The denominator already says what the platform can prove, and a second number would invite improving the wrong thing.
- No template gallery or starter runbook. A procedure you did not write is one you cannot vouch for at a gate, and the first thing a template teaches is that you do not have to read it.
- No import from a file or a URL, and no sharing.
- No conversational route to authoring: chat may walk you to the door and say what is behind it, exactly as it does for every other Govern act.

## 10 · One scope flag, and one thing I need

**Scope flag, not a refusal.** An agency shipping its house rules to clients is a different product from a person writing their own procedure. A document whose author will never see the fleet it runs on has nobody present at consequence who can vouch for it, which is the assumption every gate in this system rests on. It needs its own doctrine — who vouches, what the installer sees, whether a third-party document can be more than narrative — and it should not ride in on this cycle.

**What I need before the surface is built:** the gateway's emitted-topic set, as data the derivation can read. Everything else on this sheet is derivable from the tree today; that one is a contract that does not exist yet, and it is the difference between deriving attestability and guessing it.

## 11 · Vocabulary proposed

Two rows for the origin mark: **yours** (a document written in this install) and **ships with Nexus** (one the addon carries). Second person matches the product's voice. One word and two — against the one-word chip rule, so the shipped mark may need shortening if the rule binds strictly.
