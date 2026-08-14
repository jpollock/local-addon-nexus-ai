# Track 3 — Backup Gate and the Sandbox Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make it safe for an agent to change a production site, by doing the work on a disposable local copy, showing a diff, and pushing only on approval — with a real backup gate in front of every overwrite.

**Architecture:** A `SandboxSession` state machine over the existing pieces: `site_links` (Track 1) for the install↔sandbox link, Local's `AddSiteService` for provisioning, MagicSync for pull and push, and the tier system for deciding when the sandbox is required at all. The gate is a precondition enforced in `ToolRegistry.call()`'s neighbourhood, not an advisory string in a tool description.

**Tech Stack:** TypeScript, the `LocalHostAdapter` / `LocalServicesBridge` pull-push surface, Jest.

**Spec:** `docs/planning/2026-08-13-nexus-native-fleet-workspace-design.md`, section "The sandbox loop".

## Status of this plan

**Stage 1 is ready and urgent. Stages 2–3 are ready. Stage 4 is gated on UI.** Stage 1 is a live data-loss defect that exists today, independent of everything else in this track — it should ship whether or not the rest does.

## Global Constraints

- The gate is a **precondition**, not a warning. A tool that can overwrite either verifies a usable backup exists or refuses. `wpe_backup_and_verify` is deliberately Tier 2 precisely so this can be automated.
- Every destructive step is reversible or refused. No step both destroys and cannot be undone.
- A pull re-diffs at push time. The diff shown to a human and the diff applied must be the same diff, or the push aborts.
- Every stage ends green: `npx tsc --noEmit` and `npx jest tests/unit`.

---

## Stage 1 — `T-BACKUP-GATE` *(ship independently; this is a live defect)*

`local_wpe_pull` overwrites a local site at Tier 2 with no gate. Today that needs a deliberate human action, which is the only reason it has not caused loss. The moment the sandbox loop pulls on the user's behalf, it becomes automated data destruction.

### Task 1.1 — A real precondition

**Files:** create `src/main/safety/BackupGate.ts`, `tests/unit/safety/BackupGate.test.ts`

`BackupGate.requireBackup(target)` resolves to either a verified backup reference or a refusal carrying the reason.

**Corrected 2026-08-13 after implementation found the original framing unbuildable.** The plan originally said verification means the backup exists *and* its recorded completion is after the last mutation to the target. There is no last-mutation signal on either side: local sites have per-file mtimes and no database change timestamp, and CAPI install objects carry no `updated_at`. Fabricating one from max file mtime would be expensive, unreliable, and would look like protection while providing none.

The gate therefore **creates a fresh backup as part of itself** rather than looking for an existing one. "The backup is newer than the last mutation" then holds by construction, with no timestamp comparison. Pull triggers `local_export_site` and blocks on completion; push triggers `wpe_backup_and_verify`, which already blocks.

This is simpler and strictly safer than the original design. It is also more expensive — 1–5 minutes per destructive operation — and that cost lands on the sandbox loop, which pulls on the user's behalf. See the note under Stage 2.3.

### Task 1.2 — Wire it into the overwriting tools

`local_wpe_pull` (overwrites a local site) and `local_wpe_push` (overwrites a remote). Push is already Tier 3, so it has a confirmation token — it still needs the gate, because a token proves intent, not recoverability.

Test the refusal path first and assert **no write occurred**. A gate whose failure path is untested is not a gate.

### Task 1.3 — Local-side backups

`wpe_backup_and_verify` covers the remote; `local_export_site` covers the local side and is tracked by `OperationTracker` with a `completedAt`, so completion is observable.

Export unconditionally. The optimisation — export only when the local site has diverged since its last pull — needs Task 2.2's manifest and is deferred.

**Consequence for Stage 2.3, worth deciding early:** if every pull carries a full export, sandbox *refresh* becomes expensive, which makes reuse materially more attractive than re-pulling and weakens the case for ephemeral sandboxes (decision D8 in the decisions record). Revisit D8 once the real cost is measured.

---

## Stage 2 — Sandbox lifecycle

### Task 2.1 — `SandboxSession` state machine

**Files:** create `src/main/sandbox/SandboxSession.ts`, `src/main/sandbox/types.ts`

States: `none → provisioning → pulling → ready → dirty → diffing → awaiting-approval → pushing → verifying → done`, plus `failed` reachable from any state carrying the state it failed in. Persist in `graph.db` — a session must survive an addon restart, or a crash mid-push leaves a user with no idea what state production is in.

Model transitions explicitly and test the illegal ones. The valuable tests here are the ones asserting you *cannot* get from `dirty` to `pushing` without passing through approval.

### Task 2.2 — Divergence detection

Production moves while the sandbox is open. Re-diff at push time against the manifest captured at pull time; if the remote changed underneath, refuse and surface what changed.

MagicSync already does manifest diffing, but note the known weaknesses recorded in `docs/superpowers/specs/2026-08-10-recording-sessions-design.md`: comparison is mtime-based rather than content-based, two different exclusion lists govern preview versus transfer, and the rsync exclusion list is fetched from a remote URL at push time. **Do not assume the manifest is the truth.** For this track, capture a content hash of the changed set rather than relying on mtimes.

### Task 2.3 — Provision-or-reuse

Given an install with no linked sandbox, provision one and link it via `site_links`. Given one already linked, decide refresh-or-reuse on freshness. Sandboxes persist after push in V1 with an explicit discard action; ephemeral sandboxes are the better answer and are deferred.

---

## Stage 3 — Routing risky operations through the sandbox

### Task 3.1 — The sandbox decision

A pure function of *(operation tier, target environment, sandbox availability)* → `direct | sandbox-required | refuse`. Pure and separately tested, because it is the rule everything else hangs off.

The ladder from the design: reads always direct; content edits direct via remote WP-CLI; plugin and config changes direct but higher-tier; code and structural changes require the sandbox.

### Task 3.2 — Diff generation

A structured diff — file-level with content hashes, plus a human-readable rendering. The mockup shows a unified-diff block with inline check results; the structured form is what the API returns and the rendering is derived from it, not the reverse.

### Task 3.3 — Post-push verification

Re-run the assessment that produced the finding and report what moved. Without this the loop is open and no trust accumulates — Session 10's entire hesitation was about whether the AI would actually fix the thing.

---

## Gated stage

### Stage 4 — The approval surface *(gated)*

**Decision needed:** the shell question from Track 2 Stage 5, plus who may approve.

The design is explicit that a modal fails the trust model and the approval must be an in-flow page. Beyond that, the approval surface assumes a single actor — there is no identity model yet, so "approved by" cannot be recorded. Every research participant raised permissions; none of that can be built until identity exists.

Until then, Stages 1–3 expose the loop through MCP tools, which is enough to validate the mechanics without the surface.

---

## Sequencing

Stage 1 ships alone and immediately. Stage 2 depends on Track 1's `site_links` (done). Stage 3 depends on Stage 2. Stage 4 waits.

**The known gap inherited from Track 1 lands here:** `remote-exec.ts` and `get-site-changes.ts` still resolve installs through the old `hostConnections` inference rather than `site_links`. Track 3 is what actually routes remote execution, so replacing those two call sites belongs in Stage 3 — otherwise a user-corrected link still does not affect where commands run.
