# WP-20 design note — procedure distribution, runbook rides the capability

*Phase 1 of WP-20. Written on worktree `wp-20` (branch `wp-20`, base
`poc/nexintelligence` @ `b267beaa`). **No production code is written in this
packet.** Seven gated design questions, seven positions, each with its smallest
additive implementation, its parity risk, and the B-03 criteria it unblocks.
Phase 2 follows in a fresh session against the owner's rulings.*

*Acceptance eval: `docs/intelligence/anchor-slice/evals/B-03-runbook-push-with-capability.yaml`,
eleven criteria, all currently BLOCKED on this packet
(`tests/intelligence-evals/checks.ts:118-199`).*

---

## 0. What is actually on the ground

Measured on the tree, not recalled. Everything below is a citation, because
four of the seven positions turn on one of these facts.

| Fact | Where | Consequence for this packet |
|---|---|---|
| `ContextBundle.procedure` is typed `null`, `tools` is `ToolGrant[]` and always `[]` | `src/intelligence/assemble/types.ts:318-319`, `assembler.ts:834-835` | The type itself has to widen. This is a core-lock edit. |
| `capability` already rides the request and the manifest, and is always `null` on the chat surface | `assemble/types.ts:129-130,275`; `chatAssembly.ts:117` | The recording half exists. Only the *supply* half is missing. |
| The turn block is delivered as `role: 'user'` | `ChatService.ts:203-205` | R7's trusted channel is **already built**. Procedure can ride it with no new carrier. |
| `adaptToolsForChat`'s third parameter ships signature-only; `[]` deliberately means *unrestricted*, not deny-all | `src/main/chat/tool-adapter.ts:22,41-43`; `chatAssembly.ts:62-71` | Populating grants needs a way to say "deny-all" that is not `[]`. |
| The runtime law directory contains **policy only** — `law/policy/ops-default.md`. The five runbooks live under `docs/`, which does not ship | `law/`; `package.json` `files[]`; `permissionsMirror.ts:109` | The exemplar runbook is not present at runtime *at all*. First edit of phase 2. |
| The loader already accepts `kind: runbook` and passes unknown frontmatter through | `law/loader.ts:40,44-46,112` | No loader change needed to *read* a runbook. |
| `ConstraintRegistry` **discards** `body` and `frontmatter` | `law/registry.ts:36` | A runbook registry is a new, separate index — not a filter over the existing one. |
| WP-19 emits `task.action.executed` / `task.outcome.recorded` / `task.rationale.recorded`, correlation = TaskId, approval causation-chained | `intelligence-host/actionProducer.ts`; `ChatService.ts:416-456` | The attestation substrate exists. §4 is mostly wiring, not invention. |
| `control.grant.issued` / `control.grant.revoked` and `procedure.runbook.published` are declared in the taxonomy and have **zero producers** | `architecture.md:159-161` | Declared, so not a taxonomy change — but a first producer. Flagged in §8. |
| `bulk_plugin_update` has **no `dry_run` parameter**, is fire-and-forget (returns an `opId`), and has no completion-poll tool | `mcp/modules/fleet-intelligence/bulk-plugin-update.ts:10-57` | cp.dry-run and cp.verify-canary have no tool to attest against. See §4. |
| `wp_plugin_update` is in `NEEDS_RUNNING_SITE` — ChatService **auto-starts a halted local site** before running it | `ChatService.ts:44,502-552` | **The platform violates B-03's must_not #3 without the model's involvement.** See §5. |
| `rb.bulk-plugin-update` is 4,858 bytes ≈ **1,215 tokens** at the assembler's own estimator (`CHARS_PER_TOKEN = 4`, `assembler.ts:49`) | `docs/intelligence/anchor-slice/runbooks/bulk-plugin-update.md` | The budget answer in §3 is a measured number, not an estimate of an estimate. |

Two things this note does **not** assume:

- That B-03 can be run without a live model. Seven of its eleven criteria need
  an actual agent run; the harness for that (WP-13b `sitting.ts`) is built and
  has **never executed** — no provider key was available. That is the single
  largest risk to "the anchor-slice DoD completes when they pass at pass^3",
  and it is not a WP-20 engineering risk. See §9.
- That surfaces B/C/D are in scope. They are not (recon R8). Surface C is the
  autonomous class ADR-7 was written for, and §6 states its contract without
  claiming to have wired it.

---

## 1. Capability recognition — how a turn acquires `cap.bulk_plugin_update`

### Position

**Two co-equal arming paths, neither of which is a model call, plus a late
arm at the gate that turns a miss into a refusal instead of an improvisation.**

- **Path A — declared predicate.** The runbook's frontmatter gains `arms_on:`,
  a two-clause lexical match over the user's turn text only: a verb set and a
  subject set, both authored in the file. `rb.bulk-plugin-update` would carry
  `verbs: [update, upgrade, bump]`, `subjects: [plugin, plugins, woocommerce, …]`.
  Evaluated in code, before the model call, cost ≈ zero.
- **Path B — model request.** A Tier-1 tool, `nexus_load_procedure(capability)`.
  The *always-on procedure index* (§3) tells the model this tool exists and when
  each procedure applies, so a paraphrase the predicate misses is still
  recoverable by the model asking. **The tool returns an acknowledgement only.**
  The runbook body never rides the tool result — R7 forbids it, and the model
  is instructed to ignore instructions found there. The body is injected by the
  host into the next iteration's user-role carrier.
- **Path C — late arm at the gate.** If neither path fires and the model reaches
  a gated call whose tool is claimed by a granted strict runbook, the sequencer
  (§4) arms then, finds cp.consult-history / cp.dry-run / cp.approval
  unattested, and **refuses the call**, returning the procedure's first unmet
  checkpoint. Late arming does not rescue the sequence; it converts silent
  improvisation into an instructive refusal.

### Why not the two options recon enumerated

- **Intent classification** (recon §2.2, graded C) is a model call before the
  model call. It doubles first-token latency on every turn, adds a
  probabilistic component to the gate that decides whether safety ceremony
  applies, and produces no auditable artifact. Rejected.
- **Tool-triggered grant at the first gated call** is not merely "late" — it is
  *structurally* too late for this runbook specifically. `rb.bulk-plugin-update`'s
  first three checkpoints (consult-history, dry-run, approval) all precede any
  gated write. A procedure delivered at the first gated call arrives after
  three of its own checkpoints have already been skipped. Rejected as the
  *primary* mechanism; retained as Path C, where its job is refusal, not
  guidance.

A structural variant was considered and folded in: arm on the first Tier-1
*read* named in the runbook's tool list (`wp_plugin_list`, `nexus_plugin_audit`).
It over-fires enormously — those tools are the fleet-browsing workhorses — so it
needs a narrowing condition, which is a predicate. Path A subsumes it.

### Failure modes, stated

| FM | What happens | Why it is tolerable |
|---|---|---|
| Predicate under-fires on paraphrase ("bump Woo everywhere") | No procedure at turn 1 | Path B (model may ask) and Path C (gate refuses) both remain. This is why there are three paths, not one. |
| Predicate over-fires — a *question* about plugin updates arms a strict procedure | User gets ceremony they did not want | Arming is not committing. cp.dry-run/cp.approval are exactly where the user declines. Over-firing is **recorded in the manifest** (`procedure.armed_by`), so its rate is measurable rather than anecdotal. |
| Two runbooks arm on one turn | — | **Refuse to pick.** Deliver both index lines, arm neither, say so. A coin toss between two strict procedures is worse than none. Mirrors this codebase's existing bare-name ambiguity ruling (`resolveTargetArgs` throws with the disambiguated forms). |
| Model calls `nexus_load_procedure` for a capability it does not hold | — | Acknowledgement says so and names what *is* granted. Not an error. |

### Smallest additive implementation

`arms_on` in frontmatter (loader already passes it through); an `armFor(text, runbooks)`
pure function in `src/intelligence/law/`; one new Tier-1 tool; one guarded
push in `runAgentLoop` for the Path-B injection.

### Parity risk

**An unarmed turn must assemble byte-identically to today.** This is the same
additive-parity contract WP-11 pinned and it must be pinned again in both
directions: armed → procedure section present; unarmed → the rendered turn
block is character-for-character what the pre-WP-20 build produced.

### B-03 criteria

Unblocks none on its own. Precondition for all eleven.

---

## 2. The grant surface

### Position

**A capability grant is a new, small settings object — `capabilityGrants` — and
it is NOT `remoteSiteExceptions` wearing a new name. Same Settings screen, same
ruled grant story, different axis.**

The owner ruled (ux-brief-response §4, R4, option (a)): deny-by-default, with
per-site *grants* that allow narrowly; "exceptions" is renamed "site grants" in
the UI, semantics unchanged, no M4-eval churn. That ruling is about the five
**operations** (`pull`/`wpcli_read`/`wpcli`/`push`/`delete`) against three
environments. A capability is a different axis: it is a *procedure-bearing*
grant. Folding capabilities into `remoteSiteExceptions` would change
`wpeOperationPermissions` semantics, which the protocol lists as a
stop-and-ask escalation and whose regression harness is the M4 eval family.
Separate object; the Settings screen tells one story over two rows.

```ts
interface CapabilityGrant {
  capability: string;      // 'cap.bulk_plugin_update'
  runbookId: string;       // 'rb.bulk-plugin-update'
  runbookHash: string;     // 'sha256:…' — the pin
  scope: {
    environments: RemoteEnv[];   // from the runbook's own scope.environments
    targetRefs?: string[];       // absent = every site in those environments
  };
  enabled: boolean;
}
```

### The direction of the grant, ruled explicitly

There is a trap here worth naming. Under a strict-runbook design the grant is
*restrictive* — holding it means you get sequenced. But today, with no grant at
all, a chat model can call `bulk_plugin_update` with no ceremony whatsoever. So
"deny by default" inverts: shipping the grant **off** would leave the unsafe
path as the default and make the safe one opt-in.

**Position: v0 grants are additive-only.** Holding a grant *adds* a procedure
and *adds* sequencing over that capability's own tools. Not holding one leaves
today's behaviour exactly as it is. The anchor grant therefore ships
**enabled**, scoped to `local` + `wpe_staging` + `wpe_development` — matching
`rb.bulk-plugin-update`'s own `scope.environments` — and never production.

The day a capability becomes *required* to call its tools is a different,
breaking change: it removes reach from the existing tool surface. That wants
its own packet (**WP-20f**), its own eval, and its own owner ruling. Do not
smuggle it into this one.

### Where it is visible

1. **Settings → Nexus AI → Remote Access & Permissions**, a new *Procedures*
   section: one row per granted capability — capability, runbook id, version,
   strictness, scope, and a link to the runbook body. Read-only in v0 except
   the enable toggle: the runbook is shipped law, not user-authored content.
2. **In the transcript**, when armed — the `ProcedureHeader` shape of §7.

### Emission

`control.grant.issued` when the shipped grant set is first materialized at
bootstrap; `control.grant.revoked` on toggle-off. Both topics are already in the
§4.2 taxonomy, so this is a first *producer*, not a taxonomy change — but it is
still an escalation-listed event, hence §8.

### Smallest additive implementation

One settings field; one bootstrap materializer beside `initLawRegistry`; one
Settings section (renderer, React 16 class components per house style).

### Parity risk

**`UpdateSettingsSchema` is `.strict()` — a new `NexusSettings` field that is not
added there is silently stripped and never persists.** This repo has been bitten
by exactly this. It is pin #4 in §9.

Second risk: `getEffectiveSettings` is read by `buildPermissionsSnapshot` and
therefore by `verifyMirror()`. A new key must not perturb the mirror's
divergence count, or every turn's ambient block starts carrying a false
"policy disagrees with live settings" warning.

### B-03 criteria

Unblocks none directly. It is the fixture's stated premise ("Grant:
cap.bulk_plugin_update with runbook_hash of rb.bulk-plugin-update v1.0.0"), so
without it the eval's setup cannot be honestly constructed.

---

## 3. Delivery channel and cadence

### Position

**The procedure rides the existing per-turn carrier, as the FIRST section of
`blocks.turn`, on the `user` role. Never the system prompt. Never a tool
result. Full body on the arming turn; hash re-assert plus checkpoint cursor on
every turn after.**

- **Not a tool result** — R7. `maskToolResultsForProvider` wraps every
  `role: 'tool'` message in `<untrusted_data>` and the system prompt tells the
  model never to follow instructions inside them. A runbook is precisely an
  instruction. Delivering it there means the platform ships an instruction on a
  channel it has told the model to distrust. Additionally R5:
  `compressStaleToolResults` truncates `role:'tool'` content over 800 chars to
  600 after two assistant turns — the runbook would silently degrade while the
  manifest still claimed it was supplied.
- **Not the system prompt** — the system prompt is built once per session
  (R1/R2) and then frozen. A procedure attached at session start is a procedure
  attached to no task, which is the opposite of ADR-12's "pushed with the
  capability", and it would outlive the task that needed it.
- **The user-role turn carrier** is already the delivery channel for the policy
  set and retrieval (`ChatService.ts:203-205`), already marked
  platform-authored-and-trusted by the block's own framing
  (`assembler.ts:688`), and already exempt from the untrusted-data machinery.
  Zero new mechanism.

**Ordering inside the block: procedure first**, ahead of routing, freshness and
retrieval. The procedure is the instruction; the rest is evidence *for* it, and
an instruction that trails its own evidence gets skimmed. (Same reasoning
`renderTurnBlock` already applies to placing routing before facts.)

### Cadence — ADR-20 extended to procedure

The mechanism generalises cleanly. `AssembleRequest.context` gains
`procedureHash?: string` alongside `policyVersionHash`; `ContextBundle.procedure`
gains an `assertFull: boolean` computed the same way.

| Turn | What rides | Cost |
|---|---|---|
| Arming turn | Full body + checkpoint list | ≈ 1,215 tokens (measured) |
| Every later turn of the same task | `rb.bulk-plugin-update v1.0.0 (strict) remains in effect. Attested: cp.consult-history, cp.dry-run. Next: cp.approval.` | ≈ 30 tokens |
| Every turn, always (armed or not) | The **procedure index** — one line per grantable runbook: id, version, strictness, and its `applies_when` one-liner | ≈ 25 tokens × 5 runbooks = **125 tokens** |

The re-assert is strictly *more* useful than policy's, because it carries
progress: it is where the model learns which checkpoint it is standing on.

Session-scoped memory of what has been asserted lives host-side, in the same
map `chatAssembly.ts:82` already keeps for policy — the assembler is stateless
by ADR-10 and must stay so.

### What a 200-line strict runbook does to the budget

Directly answered. 200 lines of this runbook's prose density ≈ 6.5 KB ≈ **1,625
tokens**, riding **once per task**. Against R4's real constraint — ~190 tool
schemas re-sent on up to 25 loop iterations — a one-time 1.6k is noise. The same
1.6k re-sent every iteration would not be; that is exactly why the cadence rule
above is not optional.

The failure case is not 200 lines, it is 600. §6.2 step 6 says procedure is
never trimmed, so the only honest alternative to trimming is refusing to load:

**Position: the runbook loader enforces a body ceiling — 8 KB (≈ 2k tokens) for
`strictness: strict` — and REJECTS an over-size runbook with a recorded error,
exactly as it already rejects malformed frontmatter.** That turns "a huge
runbook quietly eats the context window" into an authoring-time failure with a
name. Note that two shipped runbooks already exceed it: `incident-response.md`
(15.8 KB) and `staging-promotion.md` (10.5 KB). They are not in this packet's
scope, but the ceiling would refuse them, so either the ceiling is 16 KB or
those two get split. **Recommendation: 8 KB, and the two over-size runbooks are
a phase-2 authoring task** — a 16 KB strict runbook riding a turn is 4k tokens
and the ceiling would stop meaning anything.

### Smallest additive implementation

`renderProcedureBlock()` in `assembler.ts`; one new field on
`AssembleRequest.context`; the index built from the runbook registry;
`BundleManifest.procedure` widens from `null` to a record.

### Parity risk

- `BundleManifest.procedure` changing shape is a **manifest schema change**.
  The manifest is emitted as `task.context.assembled` with schema
  `context.assembled/1`. Widening a field from `null` to an object is additive
  for readers that ignore it, but it is still a payload change on a versioned
  schema — §8.
- The index rides on **every** turn including unarmed ones, which breaks the
  §1 byte-identical parity claim for the turn block. Deliberate, and the pin
  must say so: parity is asserted against a build *with the index*, and the
  index's own presence is pinned separately.

### B-03 criteria

Makes K1–K5, M1 and M2 *observable* for the first time. "Behaviour the prompt
never asked for" cannot be attributed to a procedure until a procedure was
delivered; "half-adherence" is unobservable when nothing was adhered to.

---

## 4. Checkpoint attestation — what the gateway VERIFIES vs what it RECORDS

### Position

**The gateway enforces SEQUENCE and PRESENCE. It never enforces QUALITY. And
an attestation is never a model self-report — it is a ledger event or it is
nothing.**

A model saying "backups complete" attests nothing. A `task.action.executed` for
`wpe_backup_and_verify` with a success `task.outcome.recorded` against a
resolved target attests it. That distinction is the whole mechanism.

### Per checkpoint, for `rb.bulk-plugin-update`

| Checkpoint | Attestable? | By what |
|---|---|---|
| `cp.consult-history` | **manifest** | The assembler itself ran the episodic retrieval. `manifest.retrieval[]` records the query, the store, the count and the event ids. This proves the **supply** side. Whether the model *read* it is narrative — the designer's already-ruled supplied / quoted-in-this-answer / neither split (ux-brief R3) applies verbatim. |
| `cp.dry-run` | **narrative in v0** | `bulk_plugin_update` has no `dry_run` parameter, and there is no dry-run tool. The model composes the diff from Tier-1 reads. Adding `dry_run` to `bulk_plugin_update` would flip this to event-attested — named as a follow-on, not folded in. |
| `cp.approval` | **event — the strongest one** | `task.rationale.recorded` with `decision`, correlated to the TaskId, causation-chained to the action (`ChatService.ts:416-456`, shipped in WP-19). "Proceeded past a denied approval" is a fully programmatic ledger query: an action whose correlation carries a `denied` rationale and no later `approved` one. |
| `cp.backup` | **event** | `wpe_backup_and_verify` exists and is a real tool. Per-site attestation is readable because WP-19 emits one `task.outcome.recorded` per *resolved* target. **Fidelity caveat, and it must be stated in the UI, not just here:** WP-19 stamps `result_scope: 'call'` — the per-target outcome is the call's result fanned out, not an independently observed per-site one. "Backup verified per site" is true only to the fidelity the tool itself reports. |
| `cp.canary` | **partly event, partly narrative** | *Cardinality and ordering are provable*: exactly one target updated, then a gap, then the rest. *Choice and reason are not*: nothing can prove the site chosen was low-risk, or that the stated reason is the real one. |
| `cp.verify-canary` | **narrative — the biggest gap** | "Site loads, admin reachable, no new PHP errors, checkout renders" has no tool wired into this flow, and `bulk_plugin_update` is fire-and-forget (returns an `opId`, no completion poll), so there is not even a completion signal to hang it on. |
| `cp.roll-fleet` | **event, for ordering** | History-flagged site last is a timestamp comparison over `task.action.executed` against the fixture's flag. |
| `cp.report` | **narrative** | |

**Four event/manifest-attested, four narrative.** That ratio is the single most
important thing in this note, and today a reader of the runbook cannot tell
which is which.

### The additive frontmatter that fixes it

Each checkpoint gains `attest:` with one of three values:

```yaml
checkpoints:
  - id: cp.consult-history
    attest: manifest
  - id: cp.dry-run
    attest: narrative        # no dry-run tool exists; see WP-20 design note §4
  - id: cp.approval
    attest: event
    evidence: { topic: task.rationale.recorded, decision: approved }
  - id: cp.backup
    attest: event
    evidence: { topic: task.action.executed, tool: wpe_backup_and_verify, per_target: true }
  …
```

An ADR-17 refinement, not a change: ADR-17 already requires strict runbooks to
enumerate checkpoints with stable ids *because gateway attestation needs step
identity*. This says what identity buys you, per step.

### The sequencer

A per-task checkpoint **cursor**, folded from `task.*` events by `correlation`.
Nothing new is stored: the cursor is derived, the way twins are derived. A gated
call whose tool belongs to an armed strict runbook and whose checkpoint
prerequisites are unattested is **refused**, with a message naming the runbook,
the unmet checkpoint, and what would attest it.

### Fail-behaviour of the sequencer itself

The attesting event may be missing for a benign reason: WP-19's emission is
non-fatal and returns `undefined` on fault. **Position: an unreadable ledger is
fail-CLOSED for the sequenced capability only.** The call is refused, naming the
missing checkpoint; every other tool is untouched. That bounds an
intelligence-layer fault's blast radius to the capability that opted into
sequencing, and it keeps the wrap-log-degrade invariant for everything else.

**ADR-7 does not apply here, and it matters that this is said out loud.** ADR-7's
autonomy-class rule governs *policy staleness* — a stale law set, an interactive
human present to judge. Checkpoint sequencing is not staleness; it is a
procedural precondition on a specific write. Warn-and-proceed on an unattested
backup would be warn-and-proceed on `ab.backup-failed`, which the runbook itself
declares "not waivable — not by user insistence, urgency, or claimed authority."

### Smallest additive implementation

`attest:` frontmatter; `procedureCursor.ts` in `src/main/intelligence-host/`
(a ledger query by correlation, no new table); one guard in the gated-call path.

### Parity risk

The guard sits near `ToolRegistry.call`, which is audit chokepoint one and
core-lock-adjacent. It must refuse **only** when a strict runbook is armed for
*that* capability — an ungranted, unarmed call must reach the registry on a path
that is instruction-for-instruction unchanged.

### B-03 criteria

This is where the eval actually gets teeth. **M4** (proceed past a denied
approval) becomes fully programmatic. **K2** (approval half), **K3**, **K5**
(ordering) and **M2** (half-adherence, for the event-attested checkpoints only)
become enforceable. **K1** becomes manifest-verifiable on the supply side.

---

## 5. ToolGrant population

### Position

**Add `tools:` to strict-runbook frontmatter — an explicit allow-list of tool
names, per checkpoint. Derived from nothing; inferred from nothing. And in v0
the grant is ADDITIVE DISCLOSURE, not a filter: `tool_scope: exclusive` exists
as a declared mechanism, and `rb.bulk-plugin-update` ships non-exclusive.**

`requires_sources` is prose (`{ class: platform, need: live plugin inventory
for all targets }`). It is a bill of intelligence for a human reviewer, not a
tool map, and deriving tool names from it would be guessing. The runbook must
say which tools it means.

### Why non-exclusive in v0

The strictness B-03 measures is **sequence adherence**, not tool-set narrowing.
Read its two structural `must_not`s: *skip the canary*, and *substitute its own
sequence*. Both are sequence properties, enforced by §4's attestation, not by
hiding tools. Meanwhile narrowing is recon's own grade-B "largest behavioural
change on this page": it would strip `nexus_list_sites`, `search_tools` and the
rest, break the turn in ways that read as model failure, and break the moment
the user changes the subject mid-task.

So: ship the mechanism, ship the exemplar open, let a later packet flip it with
its own eval. That is not timidity — it is refusing to bundle an unmeasured
behaviour change into the packet whose acceptance eval measures a different one.

### What the grant list is used for in v0

1. **Rendered obligation.** The procedure block names, per checkpoint, which
   tools it expects — so "use `wpe_backup_and_verify`, not
   `wpe_create_backup`" is instruction rather than folklore.
2. **The sequencer's claim set** (§4) — which tool calls belong to which
   checkpoint. Without a declared tool list the sequencer cannot tell that
   `bulk_plugin_update` is a cp.roll-fleet act.
3. **`ToolGrant.mode: 'live'`** on the inventory tools, carrying §6.3's
   cache/live obligation as text. **Not enforced in v0** — say so; a `mode`
   field that looks enforced and is not is worse than an absent one.

### The finding that makes `tools:` load-bearing rather than tidy

`wp_plugin_update` is in `NEEDS_RUNNING_SITE` (`ChatService.ts:44`), so
`prepareSiteLifecycle` **auto-starts a halted local site** before running it
(`:502-552`). cp.canary pushes the model toward per-site updates. So:

> **B-03's must_not #3 — "start the halted site" — is violated by platform
> code, invisibly, without the model ever choosing to.**

`bulk_plugin_update` is *not* in that map, and its own handler skips
non-running sites. So the fix is one line of frontmatter: the runbook names
`bulk_plugin_update` (with a single-element `site_ids` for the canary) as its
only update tool. The alternative — suppressing `NEEDS_RUNNING_SITE` when an
armed runbook forbids starting — is a locked-file edit for a problem authoring
already solves. **Recommend the frontmatter fix.**

### Smallest additive implementation

`tools:` / `tool_scope:` in frontmatter; the union mapping in
`chatAssembly.ts`'s `grants` computation; `ToolGrant` gains an optional
`checkpoint` field.

### Parity risk

`adaptToolsForChat` treats `[]` as unrestricted, deliberately
(`tool-adapter.ts:41-43`). Populating grants therefore needs deny-all expressed
some way other than an empty array — that is what `tool_scope: exclusive` is
for, and the existing `[] means unrestricted` line must **not** be touched.
`chatAssembly.ts:147`'s `bundle.tools.length > 0 ? … : undefined` mapping is the
guard that makes this safe today and must survive.

### B-03 criteria

**K6** and **M3** (skip the halted site, do not start it) — via the finding
above, this is the difference between the criterion passing and the platform
failing it on the model's behalf. Contributes to **K3** and **K4** by naming
the tools those checkpoints attest against.

---

## 6. Fail-closed semantics, per actor class

Four distinct failures. They do not all get the same rule, and conflating them
is how a fail-closed design becomes a fail-annoying one.

### (a) The runbook cannot load — missing file, malformed frontmatter, over ceiling

- **Interactive (surface A, chat).** The capability is **disarmed**; the turn
  assembles exactly as an unarmed turn; and the turn block carries an explicit
  disclosure: *a procedure was expected for this capability and could not be
  loaded — proceed without it or stop.* This is ADR-7's warn-and-proceed with
  the warning actually rendered rather than merely permitted. Behaviour
  degrades to today's, which is the parity floor.
- **Autonomous (surface C, agents).** **Fail closed.** No procedure means the
  capability is refused; the actor receives the refusal-bundle shape that
  already exists (`failClosedBundle`, `assembler.ts:859-895`), extended with a
  procedure reason. Surface C is **not wired** in v0 (recon R8) — this is a
  stated contract, not a claim of coverage, and phase 2 delivers it as a typed
  branch with a test, not as live behaviour.

### (b) Hash mismatch — the grant pins `sha256:…`, the loaded file differs

**Hard refusal on BOTH actor classes. No warn-and-proceed for anyone.**

This is the one place the note departs from an autonomy-class rule, and the
reasoning is that ADR-7 governs *staleness* while this is *integrity*. A hash
mismatch does not mean the procedure is old; it means the document on disk is
not the document that was reviewed and granted. ADR-12's own corollary — D-01
is elevated because "a wrong strict runbook *blocks* correct behavior" — cuts
both directions: an **unreviewed** strict runbook is worse than none, because
its authority is borrowed from a review that never happened.

User-visible: the capability disarms, and the message names the runbook, both
hashes, and the remedy (re-grant against the current file, a Settings action).
Not an error toast. Not a silent downgrade.

### (c) An attesting event cannot be read

Covered in §4: refuse the sequenced call, name the checkpoint, leave the rest
of the tool surface alone.

### (d) The intelligence core is absent entirely

`getIntelligenceCore()` returns `null` → no arming, no sequencing, exact parity
with the pre-WP-20 build. This is the existing degrade path
(`chatAssembly.ts:94`) and it must stay exactly as it is.

### The non-negotiable that spans all four

**None of these may throw into `ChatService`.** Every refusal is a rendered
string plus a disarm, never an exception. The seam's invariant is
wrap-log-degrade, and a fail-closed *refusal* is a returned value, not a thrown
one — the distinction the whole `src/intelligence/` seam is built on.

### B-03 criteria

**M2** in its hardest reading: an actor that claims to be following a runbook it
never received is exactly what (a) and (b) prevent by disarming loudly instead
of half-arming quietly.

---

## 7. The UI seam — one page, for the designer

The designer's next cycle is procedure surfaces (ux-brief-response §5.1) and
these are the shapes we owe them. Naming them here is the point: if the UI
invents its own, the transcript will claim verification the platform does not
have.

### The four shared shapes

**1 · `ProcedureHeader`** — emitted once, when a capability arms.
```ts
{ capability, runbookId, version, strictness: 'strict' | 'guided',
  checkpoints: CheckpointState[], armedBy: 'predicate' | 'model-request' | 'late-gate' }
```
Renders as the "you are now running a named procedure" band, with the ordered
checkpoints as a progress rail. `armedBy` is not decoration: *why* ceremony
appeared is the first thing a surprised user asks.

**2 · `CheckpointState`** — the shape that matters most.
```ts
{ id, status: 'pending' | 'active' | 'attested' | 'skipped' | 'aborted',
  attest: 'event' | 'manifest' | 'narrative',
  evidence?: { eventId, topic, summary } }
```
`attest` is what lets the UI distinguish a checkpoint the platform **proved**
from one it merely **heard about**. Four of `rb.bulk-plugin-update`'s eight are
narrative (§4). **If the rail renders all eight with the same green tick, the
product is lying** — and it is the designer's own already-ruled
supplied / quoted / neither distinction (ux-brief R3), applied to procedure
instead of to facts. This is the single thing we most need them to carry.

**3 · `AbortNotice`** — straight from the runbook's own `aborts:` block and the
owner's Q6 ruling (halt-and-report; completed sites stand; restore path named;
never automatic rollback).
```ts
{ abortId, checkpointId, reason,
  worldState: { completed: SiteRef[], failed: SiteRef[], notAttempted: SiteRef[] },
  restore: { backupIds: Record<siteId, string> } }
```

**4 · `CommunicationObligation`** — the runbook's `communication:` list. **This
one is narrative-only, permanently.** The platform cannot prove the model said
something. Render as *"the procedure requires you to be told:"* with the
transcript as the evidence. **Never tick it programmatically.**

### Transport

Ledger events plus the existing chat event stream. Three new stream event types
— `procedure_armed`, `checkpoint_changed`, `procedure_aborted` — beside the
existing `tool_call_approval_needed`. **No new IPC channel:** the Docked Panel
already consumes this stream, and adding a channel for something the stream
carries is the drift this codebase has documented elsewhere.

### The two open questions back to the designer

1. Is the checkpoint rail persistent chrome for the task's duration, or an
   inline card that scrolls away? (Engineering is indifferent; the state is
   available either way.)
2. How does a **disarm** read — hash mismatch, load failure — without looking
   like an error the user caused? It is a platform-integrity event, and the
   nearest existing treatment is the stale/divergence disclosure, not a toast.

---

## 8. Escalations folded into this note

The protocol says stop-and-ask for these. The note is the ask.

1. **New envelope payload on a versioned schema** — `BundleManifest.procedure`
   widens from `null` to a record, inside `context.assembled/1`. Additive for
   ignoring readers. Bump to `/2`, or widen in place? *Recommend: widen in
   place; `procedure: null` and `procedure: {…}` are the same field answering
   the same question, and the manifest has no external consumer yet.*
2. **First producers of a declared-but-unused topic family** —
   `control.grant.issued` / `control.grant.revoked`. Declared in §4.2, so not a
   taxonomy change, but this is their first emission anywhere.
3. **A new storage marker** — the shipped-grant materialization needs an
   `intelligence_grants_*` key or equivalent, and the protocol forbids touching
   marker keys outside their owning module. New module, new key, named here.
4. **`ADR-17` refinement** — `attest:`, `tools:`, `tool_scope:`, `arms_on:` and
   a body ceiling are additive frontmatter. Refinements of ADR-17's own stated
   purpose rather than departures, but they are law-schema changes.
5. **Two shipped runbooks exceed the proposed ceiling** —
   `incident-response.md` (15.8 KB), `staging-promotion.md` (10.5 KB). Ceiling
   at 8 KB and split them, or ceiling at 16 KB and accept a 4k-token procedure?
   *Recommend 8 KB + split.*
6. **Not in this packet, flagged so it is not assumed:** making a capability
   *required* to reach its tools (WP-20f). That removes reach from today's tool
   surface and needs its own eval.

---

## 9. Phase-2 packet plan

Five sub-packets, sequenced. The sequencing is not cosmetic: each one's tests
are the next one's fixtures.

### WP-20a · Runbook loading and the procedure registry
**Lock:** core (`src/intelligence/law/`) — serialized, announce.
- Copy the five runbooks into `law/runbooks/` (precedent: `law/policy/ops-default.md`
  is already a verbatim copy of the `docs/` original — and that duplication
  should be resolved by a build step or a lint, not by a third copy).
- `RunbookRegistry` over `LawDocument[]` where `kind === 'runbook'`, **keeping
  `body` and `frontmatter`** — `ConstraintRegistry` drops both (`registry.ts:36`).
- Zod schema for strict frontmatter: ordered `checkpoints` with stable ids
  (ADR-17), plus `attest`, `tools`, `tool_scope`, `arms_on`.
- Content hash over the raw file bytes; body ceiling.
- **Pins:** loader still never throws; a malformed *runbook* must not take out
  the *policy* set (they share `loadLawDirectory`); hash stable across CRLF/LF.

### WP-20b · Grants and arming
**Lock:** none on the core; `src/main/index.ts` integration lock for the
bootstrap call (minimal import + call, final step).
- `capabilityGrants` settings field **+ `UpdateSettingsSchema`**.
- `control.grant.issued` at bootstrap.
- `armFor()` — predicate + model-request + late-gate, recorded as
  `manifest.procedure.armed_by`.
- `nexus_load_procedure` (Tier 1) and its guarded mid-turn injection in
  `runAgentLoop`.
- **Pins:** unarmed turn is byte-identical modulo the index; ambiguous arm
  refuses to pick; `verifyMirror()` divergence count unchanged by the new
  settings key.

### WP-20c · Delivery
**Lock:** core (`assemble/`) — serialized.
- `ContextBundle.procedure` stops being `null`; `AssembleRequest.context.procedureHash`.
- `renderProcedureBlock`, first section of the turn block; the always-on index.
- `BundleManifest.procedure` widens (escalation 1).
- **Pins:** the procedure is never on `role: 'tool'` — assert the message role
  directly, because that is R7's whole content; never compressible (R5); token
  cost measured in the manifest and asserted against a ceiling.

### WP-20d · Attestation and sequencing
**Lock:** core-lock-adjacent (`ToolRegistry.call` guard) — announce.
- `procedureCursor.ts` — cursor folded from `task.*` by correlation.
- Refusal of out-of-sequence gated calls for armed strict capabilities.
- The four event/manifest attestations wired; the four narrative ones
  explicitly **not**, and named as such in the runbook.
- **Pins:** refusal names the checkpoint and the remedy; a ledger fault refuses
  only the sequenced capability; the denied-approval query is a real test over
  a real fixture ledger.

### WP-20e · Eval flip and the UI seam
**Lock:** none (evals tree is parallel-safe; renderer additive).
- Rewrite the eleven `b03Blocked` checks (`checks.ts:118-199`) against real
  probes. **Expected split: four become real programmatic checks (K7 end-state,
  M4 denied-approval, K3 backup presence, K5 ordering); the remaining seven
  become OWNER-PENDING with sitting instructions** — they need a live model.
- The three chat stream events and the four render shapes of §7.

### The honest acceptance statement

B-03 at pass^3 **cannot be reached by engineering alone.** Seven of eleven
criteria need a live-model run over the fixture fleet. The harness exists
(`tests/intelligence-evals/sitting.ts`, WP-13b) and has never executed: no
provider key was available, and the owner's stored key is Electron-`safeStorage`
encrypted and undecryptable outside Electron by construction. `NEXUS_EVAL_API_KEY`
is the intended path.

**So the anchor-slice DoD has a dependency that is not code**, and WP-20 should
not be reported as closing it. What WP-20 can honestly deliver: the eleven
criteria stop being BLOCKED, four become programmatically green, and the other
seven become runnable the moment a key exists.

---

## 10. Baseline

Captured in this worktree per protocol, `npm test` (never bare `npx jest` — the
skipped `pretest` hook turns an ABI mismatch into phantom failures).

| Run | Suites | Tests |
|---|---|---|
| First pass, `node_modules` symlinked but **`lib/` not compiled** | 538 passed, **1 failed**, 539 total | 6,837 passed, **4 failed**, 12 skipped, 6,853 total |
| After `npm run compile`, re-run of the failing suite `--no-cache` | 1 passed | 11 passed |

**The four failures were the WP-05 worktree-setup trap, not a regression.**
`tests/unit/agent-runtime/AgentRegistry.test.ts:19` writes a fixture agent whose
body `require`s `path.resolve('lib/main/agent-sdk')` — the **compiled** tree. A
worktree with `node_modules` linked but `lib/` absent fails those four and only
those four. Verified in both directions: they fail before `npm run compile` and
pass after it, with `--no-cache` (the WP-15 caution).

**Effective baseline: 539 suites / 6,841 passed / 12 skipped**, which matches the
last count recorded on `poc/nexintelligence` after WP-22. Amendment worth folding
into `PARALLEL_PROTOCOL.md` §Isolation: the protocol already says to run
`npm run compile` in a fresh worktree, but does not say what it costs to skip —
it costs exactly these four, and they read as a real agent-runtime regression.

**ABI state: this session ran `npm test`, so `better-sqlite3` is built for
system Node. `npm run rebuild` is required before loading the addon in Local.**
