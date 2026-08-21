# The Agent as Actor — design note

*2026-08-21 · branch `poc/nexintelligence-ux` · companion to
[`architecture.md`](architecture.md) (ADRs 1–24) and
[`moments-model.md`](moments-model.md) · candidate ADRs 25–28 below, pending
adoption*

---

## 1. Purpose, and the diagnosis

The intelligence layer supplies and governs one actor today: the Docked Panel
chat. `chatAssembly.ts` is the **only** production caller of the assembler.
Arming, procedure delivery, citations, the Govern matrix and the session
registry all hang off that one path.

The SDK agent runtime is the other actor — and it is the **autonomous** one,
the class ADR-7 was written about. It has its own context (hand-rolled prompts
via `AgentAIClient`), its own permission vocabulary (manifest tiers), its own
findings store (`agent_runs` + `run-*-report.md`), and its own inbox
(RunDrawer, the Approvals tab). None of it reaches the layer except through two
narrow taps.

**This was never a design choice.** ADR-19 named the in-product chat as the
first consumer and external MCP clients as the second; the SDK agent runtime
was never given a slot, so it kept building in parallel and nothing said stop.
The roadmap records the deferral honestly — *"surfaces B/C/D (agent runtime =
where ADR-7 fail-closed bites)"* under **Later — deliberately not now**. This
note closes that gap.

### 1.1 Why it matters more than tidiness

A human-in-the-loop chat can be governed by the human. **An agent running at
3am against a production install can only be governed by the layer.** Agents
are the actor for which the layer's value is highest and its present coverage
is lowest. Chat was the right anchor slice because it is demonstrable; it was
never the point.

### 1.2 The evidence is already in the record

At WP-25's live smoke, the chat model **caught security-sentinel's fabricated
remediation checklist against the ledger, unprompted.** An LLM-composed
procedure with no reviewed document behind it is exactly the failure mode the
procedural plane exists to prevent — and it occurred on the one surface the
plane does not reach.

---

## 2. The vision

**An agent is an actor, not a product.** One supply chain, one grant model, one
place consequence lands, for every actor: human, interactive model, autonomous
scheduled agent, in-platform ability. The SDK is how you *write* an actor; it
is not a second system with its own memory, permissions and inbox.

This is recovered from the record, not imposed on it:

- `architecture.md` §2 draws four actor classes and wires "Autonomous scheduled
  agent" to the layer over MCP. The boundary rule — *actors never touch the
  estate directly* — is written about all of them.
- **ADR-7 has no population without agents.** "The autonomy class, not the
  operation, selects the semantics" describes a distinction no shipped actor
  currently makes: nothing in the system is `autonomous` today.
- **ADR-14** attributes events as *actor X via satellite Y* — a model built for
  many actors on one machine.
- **G4/G5** — agents as stateless visitors; the closed loop structural, "not by
  agent discipline." Both sentences are about agents.

### 2.1 What first-class means, per plane

| plane | first-class means |
|---|---|
| identity | `act_agent_<name>` with an autonomy class and a satellite `via` — not one id for all agents |
| task | a run is a task moment: TaskId, bundle, manifest, actions, outcome, on one `correlation` |
| supply | context comes from the assembler, not a hand-rolled prompt; ADR-7 finally bites |
| authority | the manifest *requests*; a grant *authorizes*. No actor declares its own authority |
| procedure | reviewed, hash-pinned runbooks — not LLM-composed plans |
| consequence | findings are situations with provenance and citations, not prose in a file |

---

## 3. Rulings made at this sitting (2026-08-21, owner)

Four forks were put and answered. They are recorded here as candidate ADRs;
adoption into `architecture.md` is a separate act.

**R1 · Peer actor, shared planes (candidate ADR-25).** `AgentRunner` remains the
agent runtime. It gains an actor id, a task frame, assembler-supplied context,
actor-scoped grants, and its findings become ledger producers; the session
registry learns to fold agent tasks into situations. *Rejected:* making a run
literally a chat-style session (couples the agent runtime to the chat surface's
machinery for a UX unification obtainable more cheaply), and governing the
dispatch boundary only (leaves agents with hand-rolled context, no ADR-7, no
manifest, no citations, and a separate UX — i.e. leaves them second-class).

**R2 · Standing grant plus an explicit arm in code (candidate ADR-26).** The
manifest declares the capabilities an agent needs; a human grants them at
Govern, actor-scoped and hash-pinned; at runtime the agent calls
`ctx.arm(capability)` when it decides to act. The grant says *may*; the arm
says *now*. Checkpoint sequencing starts at the arm, not at process start, and
the arm is a recorded intent boundary before any write. *Rejected:* the grant
alone arming the whole run (loses the intent boundary, holds the procedure
across the reading majority of a run), and no standing grants at all (ends
unattended remediation entirely).

> **The arm is agent-timed, and nothing bounds it** *(architect review,
> 2026-08-21)*. R2 rejected holding the procedure across a run's reading
> majority — but an agent that calls `ctx.arm()` on line 1 reproduces the
> rejected option exactly, and nothing in the contract stops it. The rejection
> is a convention today, not a property.
>
> **Measure before enforcing.** `task.run.*` carries **arm-to-first-write** —
> the interval between the arm and the first gated act under it — so the
> distribution is in the record from phase 1 onward. Enforcement follows the
> evidence: if shipped agents arm tightly, the convention is real and needs no
> gate; if they arm at line 1, the bound is authored against a measured
> distribution rather than a guessed constant. Guessing a ceiling now would
> repeat the error ADR-17's byte ceiling had to be corrected for twice.

**R3 · Fail-closed on integrity and absence now; staleness with the hub
(candidate ADR-27).** ADR-7's staleness input **does not exist in a
satellite-only build**: `assemble/types.ts` records that the law registry is
built at process start from a directory on disk with no pull-time and no
signature, so `age_s` is NULL and fabricating one is forbidden. What is
measurable is enforced now — a missing or unloadable policy set, or a hash
mismatch under the agent's grant, drops the run to read-only diagnostics and
records why. Staleness enforcement lands with the hub, which is where a real
pin time comes from. *Rejected:* an mtime-based local clock (a proxy that reads
fresh on law months behind the repo — the fabricated-value failure this branch
refuses everywhere else), and mechanism-off-then-measure (leaves an accepted
ADR unenforced for the actor class it was written about).

**R4 · A grant substitutes for in-the-moment Tier-3 confirmation (candidate
ADR-28).** `NexusToolProvider`'s blanket Tier-3 refusal is replaced by a
conjunction: a destructive call is permitted only inside an **armed strict
runbook**, at a **checkpoint that claims the tool**, under an **actor-scoped
grant a human made at Govern** and the ledger recorded as
`control.grant.issued`. The human confirmation happens in advance and under
review, rather than in the moment.

> The loosening is real and must be stated as one. Today an agent cannot run
> Tier 3 at all.
>
> **The honest comparison is two-axis, not one** *(amended at architect review,
> 2026-08-21 — the first draft claimed "strictly more governed than the chat
> path", which is true on one axis and false on the one that motivates
> in-the-moment consent)*. Against the chat path this is:
>
> - **more reviewed** — the procedure was authored, reviewed, versioned,
>   hash-pinned and sequence-enforced before the run existed, where a chat
>   approval is a human clicking yes on a plan they read once; and
> - **less contemporaneous** — **no human judges this situation as it
>   happens.** Contemporaneous consent is not a weaker form of review that
>   advance review supersedes; it is a different thing, and it is the thing
>   being given up.
>
> So: *differently governed, more reviewed, less contemporaneous.* Any surface
> or packet restating this rule restates all three clauses.
>
> *Rejected:* report-only remediation (everything else in this design still
> lands, but sentinel can never fix anything unattended), and
> off-production-only (excludes the 3am compromised production case that
> motivates the capability at all).

**R4 gate · an owner sitting on a real destructive path, before first
production enablement.** Nothing with a fraction of this consequence has
shipped on this branch without one. The sitting runs the full conjunction —
armed strict runbook, claiming checkpoint, actor-scoped grant — against a real
destructive operation on a real site, and judges it. Phase 5 does not complete
without it, and no production grant is issued before it passes.

**R4 wants the owner's name on it explicitly.** It is the largest loosening
this project has made, and adoption-by-design-note is not the right instrument
for it. Recorded here as *ruled in principle, pending explicit owner ruling*;
the packet cites the ruling, not this note.

---

## 4. §A — The actor and task spine

### A.1 Actor

`buildAgentContext` mints the actor once per run:
`{ id: 'act_agent_<name>', kind: 'agent', autonomy }`.

- `actorFor()` (`actionProducer.ts:328`) stops inferring from `accessMethod`
  and reads the actor off the task frame when one is present. Today it maps
  **every** agent-runtime call to `act_agent_runtime`, collapsing four shipped
  agents into one ledger identity.
- `incidentProducer.ts:90`'s hardcoded `SENTINEL_ACTOR` becomes derived from
  the same place. It is already the right *shape*; it should not be a constant,
  and today the two attribution schemes disagree.
- **Open, small:** existing actor ids use underscores (`act_chat_agent`,
  `act_grant_materializer`); agent names permit hyphens. Pick one convention in
  the packet and pin it.

### A.2 Autonomy is derived from the trigger, not the setting

The SDK's `AgentAutonomy = 'suggest' | 'ask' | 'auto'` is a **user preference
about ceremony**. The layer's `Autonomy = 'interactive' | 'autonomous'`
(`assemble/types.ts:45`) is an **actor class**. Same word, different concepts,
and conflating them would put a ceremony preference in charge of a safety rule.

ADR-7's own justification is a fact about the trigger — *"a human is present to
judge"* — and `AgentRunner.run()` already computes exactly that value:

- `cron` / `event` → `autonomous`
- `manual` (Run Now, with the modal open) → `interactive`

No new setting, no vocabulary collision, and the rule lands on precisely the
population it was written for. Consequence, accepted: the same agent is a
different actor class on a Run Now than on its cron. That is the correct
reading of ADR-7, not an artifact.

### A.3 Task

A run becomes a task moment:

- A TaskId (ULID) minted per run, in a new `agentTaskFrame` beside
  `taskFrame.ts`.
- `task.run.assigned` at start, `task.run.completed` at end — the two topics
  §4.2 reserved and which **nothing has ever produced** (zero producers in the
  tree).
- `AgentRunner.run()` and `AgentDispatcher.dispatch()` pass
  `task: { id, causation, actor }` into both chokepoints. Those parameters
  already exist and are simply `undefined` on this path:
  `NexusToolProvider.ts:199` calls `registry.call(...)` with six arguments,
  omitting the seventh.

That single threading makes `WHERE correlation = <taskId>` return the
assembly, every gated call, every outcome and the findings as one thread — for
the actors that do the most unattended writing.

### A.4 Both ids survive

`runId` remains the **log** correlator; `grep run=<id>` is a documented
workflow and is not broken. TaskId is the **ledger** correlator. `agent_runs`
stores both — which finally gives `run_id` a reader, closing the
written-but-never-read-back gap CLAUDE.md records.

---

## 5. §B — The SDK contract

All additive. The four shipped manifests keep working unchanged.

```ts
interface AgentContext {
  // …existing: trigger, event, tools, state, ai, log, autonomy,
  //            credentials, db, settings, fullRun…

  /** This run's ledger identity. Distinct from the log's runId. */
  task: { id: string; actor: ActorRef };

  /** Assembled supply: ambient policy, armed procedure, twin facts + SLOs, episodic priors. */
  context: AgentBundleView;

  /** Arm a capability this agent holds a grant for. Records intent; starts sequencing. */
  arm(capability: string): Promise<ArmOutcome>;
}

interface AgentDefinition {
  // …existing…
  /** Capabilities this agent REQUESTS. This list never authorizes — a grant does. */
  capabilities?: string[];
}

interface RemediationStep {
  // …existing…
  /** The armed runbook's checkpoint this step instantiates. */
  checkpoint?: string;
}

interface Finding {
  // …existing…
  /** When the fact was true at its source. Never "now". */
  observedAt: number;
  /**
   * ADR-24 spans in `title` / `description` resolve against THIS RUN's supply
   * (manifest + tool trace). Set by the platform at fold time, never authored.
   */
  citation?: CitationState;
}
```

Notes:

- `permissions.tier` in the manifest keeps doing what it actually does
  (`AgentRegistry.ts:142` — the default tier for contributed tools) and stops
  *reading* like an authority declaration. Documentation change, not a schema
  break.
- `Finding.observedAt` makes a discipline that already exists at one call site
  into the type's problem. `AgentRunner.ts:243` hands `recordSentinelIncidents`
  the scan's completion time with a comment forbidding "now"; every other
  finding producer would have to re-derive that rule.
- `ArmOutcome` reuses the existing refusal vocabulary rather than inventing
  one — a capability not granted, a runbook unavailable, a hash mismatch are
  already `DisarmReason` values with user-actionable text.
- **The citation contract reaches the unattended path** *(architect review,
  2026-08-21 — §2.1 promised citations the first draft's contract did not
  carry)*. A sentinel finding is model-authored prose making historical and
  stateful claims about a live site, which is exactly the population ADR-24
  exists for. **An uncited finding on the unattended path is the WP-25 failure
  wearing a type** — the fabricated remediation checklist was model-authored
  prose that no record supported, and typing it as a `Finding` does not make it
  supported.

  The mechanism is the one that already exists, not a second one:
  `supplyFromBundle` (`citation/resolve.ts:418`) derives the run's citable
  universe from its bundle plus its tool trace, and the finding's spans resolve
  against that. Same shared claim→record join the judge and the renderer use —
  ADR-24 P5 is explicit that a second derivation means the judge and the user
  are looking at two different universes. Cited-but-unresolvable stays the
  loudest state here as it is in chat; on the unattended path it is louder
  still, because nobody was watching when the claim was made.
- `AgentBundleView` and `ArmOutcome` are **named here and defined in their
  packets**, not elided by accident. `AgentBundleView` is a read-only
  projection of the assembler's `ContextBundle`, narrowed to what an agent
  author may touch; fixing its exact surface before phase 4 has a real bundle
  to project would be guessing at it.

---

## 6. §C — Supply: assembly on the agent path

`buildAgentContext` calls the **same assembler library** (already host-agnostic
behind `host/ports.ts`) with the actor, the armed capability or `null`, the
task, targets resolved from the run's site scope, and a budget.

The agent receives:

- **Ambient policy** at its pinned version.
- **The armed runbook**, under ADR-20's existing mechanism — the canonical
  whole document once, hash plus checkpoint cursor thereafter.
- **Twin facts with SLOs**, staleness disclosed, and the cache/live boundary
  mechanized: acting intents require a live pre-check for every fact the
  runbook lists as a precondition.
- **The episodic prior-incidents query** — E-01's consult-before-risk. For an
  unattended remediation agent this is precisely the check you want before it
  touches anything.

Each run writes a `task.context.assembled` manifest. *"What did the agent know
when it acted?"* becomes a stored answer for the actors that act unattended.

### 6.1 The distinction that must not collapse

Everything on this seam is non-fatal by construction. Applied without care,
that rule turns fail-closed into fail-open-on-exception. So:

- A **refusal bundle is a decision, and it binds.** Missing or unloadable
  policy set, or a hash mismatch under the grant (integrity, not staleness —
  the document on disk is not the document that was reviewed) → the run
  proceeds with read-only diagnostics only, and records why.
- An **assembler fault degrades.** A throw, an unreadable store, an absent
  core → the run proceeds exactly as it does today, unassembled, and the fault
  is logged.

These are different code paths with different meanings and must be tested as
such. A test that cannot tell them apart is testing neither.

---

## 7. §D — Authority: the grant gains an actor

### D.1 The widening

`CapabilityGrantSetting` gains an optional `actor?: string`.

**Absent means today's behaviour for the interactive actor** — the
human-driven set, byte-identical to the present build. A grant naming an actor
applies to that actor only.

The parity floor is therefore **one-sided, and deliberately so**: chat is
unchanged, and agents stop inheriting grants nobody made for them. That second
half is a restriction, not a widening, and §D.5 rules it rather than letting it
arrive as a side effect of a schema field.

`getCapabilityGrants()` becomes actor-filtered. The refusal points need the
actor, which means threading it to `checkCheckpointSequence`
(`tool-registry.ts:241`) — the locked-file change WP-20b deferred with
*"threading it down is a locked-file change… 20c/20d thread identity when they
have a reason to open that file."* This is the reason.

**The blast radius is one field, not a new parameter.** `ToolRegistry.call`
already accepts `task?: { id?, causation? }`; the actor rides there. No
positional argument is added to audit chokepoint one.

### D.2 What it fixes, which is live today

- A human granting a capability in chat currently **widens what every agent may
  reach**, because `reachRefusal` (`sequenceGuard.ts:521`) reads a global grant
  set with no actor.
- A chat session's pending arming can currently **refuse a concurrent agent's
  tool call**: `armingGapRefusal` reads the process-wide queue that
  `procedureArming.ts` itself documents as not session-keyed. Under this design
  an agent's arming lives on its task frame, not in that queue.
- A scheduled agent refused a write is currently pointed at the Govern matrix —
  a UI nobody is sitting at. With an actor on the refusal, the door can name
  *which agent* needs *which grant*, and the refusal can surface where a human
  will actually see it (§F).

### D.3 Govern gains an axis, not a surface

The same seven rows, each showing who holds the capability.
`governMatrix.ts`'s derivation rule is preserved intact — every column derived,
the column moves when the document does. The actor column derives from the
grant record, so it moves when a grant does.

WP-20f's structural property extends cleanly: **a new agent arrives with no
grants.** Its manifest's `capabilities:` list renders as ungranted rows a human
can act on — the same "a row is the only thing a user can act on" rule the
sheet already forbids hiding. The two mandated-explicit capabilities
(`cap.promote_environment`, `cap.incident_remediation`) stay mandated-explicit
for agents, and arguably more emphatically.

### D.4 `allowsProduction` gets a real boundary

Today it is enforced only in `SitePicker.tsx:72` and `AgentRunModal.tsx` — and
the SDK's own doc comment admits it: *"the UI lock is a courtesy, not the
boundary."* Under this design, "may this agent touch production" is a grant
**scope condition**. `ResolvedGrant.scope` already carries
`{ environments?, targetRefs? }`, so nothing new is invented. The manifest
field stays as a UI hint; the grant is the gate.

### D.5 One consequence that wants a ruling of its own

Today `reachRefusal` reads the global set, so if a human holds
`cap.bulk_plugin_update`, an agent calling `bulk_plugin_update` passes reach.
Actor-scoping **refuses it**. That is a real restriction arriving alongside the
fix, and it is WP-20f's shape exactly — a deny-flip, obtained structurally. It
should be ruled the way WP-20f was ruled, not slipped in with a widening.

### D.6 The migration re-issues; it does not reinterpret *(phase-3 precondition)*

*Architect review, 2026-08-21.* Making `actor` absent **mean** interactive-only
silently reinterprets every grant already in
`intelligence_grants_materialized` — it changes what a stored record means
without touching it. That is precisely what WP-45's P4 re-pin ruling forbids: a
grant must never silently survive a change of meaning, and must never silently
die of one.

So the migration follows P4's pattern rather than inventing one:

- Every existing grant is **re-issued as a visible `control.grant.issued`
  event** at its new, actor-bearing shape. Nothing is reinterpreted in place.
- The issuance carries a **new member of `GRANT_ISSUE_REASONS`** naming what
  actually happened — an actor-scoping migration, not a human act at Govern and
  not a mechanical re-pin. *(Count, stated both ways so the packet cannot pick
  wrong: the array at `capabilityGrants.ts:102` holds four today, so this is
  the **fifth array member**; `repinned` sits deliberately outside the ratified
  three, so it is the **fourth ratified** — which is the sense the review's
  "fourth" carries.)*
- Idempotence comes from the record, as P4's does: once re-issued, the grant's
  stored shape already carries the actor, so the transition cannot fire twice.
  No new marker key — the protected `intelligence_grants_*` namespace is
  untouched.

### D.7 Cross-agent contributed tools are a security ruling *(phase-3 precondition)*

*Architect review, 2026-08-21 — elevated from open question 5, which filed this
as sequencing. It is not.* `NexusToolProvider` falls through to another agent's
contributed tool via the dispatcher, so a call can have two agents behind it.
Whose actor holds the grant has no safe default:

- **Check the caller (A).** Then agent B's tools are reachable by anyone who
  can drive A — B's capability surface is annexed by every agent that declares
  one of its tool names.
- **Check the contributor (B).** Then A escapes its own scope: a capability A
  was never granted becomes reachable by routing through B.

Both have holes, so neither may be a default, and this must be ruled before
actor-scoping ships — an unruled default here is a hole that arrives *with* the
mechanism meant to close one. A likely shape is the conjunction (both A and B
must hold the grant), but that is a candidate, not a ruling, and it needs
measuring against the shipped cross-agent calls first — `seo-insights` declares
log-processor's `get_log_aggregates`, `fetch_log_window` and
`analyze_*` tools, so the population is real and small enough to enumerate.

---

## 8. §E — Procedure: the plan as an instance of the runbook

`law/runbooks/incident-remediation.md` (v1.2.0, strict) already names *"any
change to SentinelExecutor's gating"* in its own `review_triggers`. It has been
describing an agent that never read it.

- **The runbook is the procedure; the plan is the instance.**
  `RemediationStep.checkpoint` binds a step to a checkpoint id in the armed
  document. Steps claiming a checkpoint are sequenced and attested by the guard
  that already exists; steps claiming none are refused under `exclusive` tool
  scope or permitted under `advisory` — the same rules chat plays by.
- `ctx.arm('cap.incident_remediation')` puts the whole hash-pinned document in
  the bundle for that run.
- ADR-17's `unrequested:` badge gains an unattended consumer. On this path it
  is what separates prudence an operator authored from steps a model invented —
  and per WP-20d, **no shipped runbook claims a contributed tool today**, so the
  runbooks' `tools:` declarations will need authoring against the agent surface.
- Under R4, the destructive half becomes reachable: armed strict runbook +
  claiming checkpoint + actor-scoped grant. Each conjunct is independently
  necessary and each is independently testable.

This closes the WP-25 smoke finding **structurally** rather than by review: a
remediation step that no reviewed document contains has nowhere to execute.

---

## 9. §F — UX: one place consequence lands

An agent run is a task; a task with consequence is a **situation**.

- The fold learns agent tasks as a source. WP-54a is building exactly this by
  hand for `agent.stuck`; under this design that bespoke producer becomes the
  **general case** rather than a per-template special case.
- **The moments model is actor-agnostic by construction.** Glance, Inspect,
  Act-small, Act-big, Investigate, Return + Govern describe what the *user* is
  doing, not who produced the item. Nothing in it needs an "agent" concept —
  which is why folding is possible at all rather than requiring a parallel
  taxonomy.
- Findings become situations in Now. Approvals use the existing card and Govern
  door. `producesReports` — which by its own doc comment **has no surface
  anywhere today** — gets Inspect depth, instead of a third inbox being built
  for it.
- **RunDrawer stays**, as the diagnostic view of a run. That is the log's
  surface and it is good at it. The fold is of *consequence*, not of
  diagnostics.
- What agents keep as genuinely theirs: schedule and cadence, enablement, site
  scope, run logs. Real agent-runtime concerns with no chat analogue.

### 9.1 The halted armed run — the highest tier, and it has no producer

*Architect review, 2026-08-21. Missing from the first draft entirely.*

An agent run that dies mid-procedure with a write already landed — Local quits,
the process crashes, the 5-minute dispatch timeout fires between checkpoints —
is **the highest-consequence state the order describes**: the world is
mid-change and only the user can move it. That is not a judgement call about
severity; it is `rankSession`'s ruled T1 arm read literally
(`sessionRegistry.ts`): *"a write has landed in scope"*, which is exactly
`row.outcomes.writeLanded`.

**Nothing produces it.** Chat survives this: sessions re-fold from the ledger
on boot, so a chat session caught mid-procedure re-materializes with its cursor
and its landed writes. Agents have no equivalent named anywhere — a run is not
a session, so no row exists to rank, and the T1 arm that would fire has no
input.

The spine (§A) is what makes the fix available rather than requiring new
machinery: once a run is a task, a run that emitted `task.run.assigned`, has
gated acts under its correlation, and **never emitted `task.run.completed`** is
detectable by a boot-time query over the ledger — no liveness heartbeat, no new
storage key, no process state that dies with the process. The fold reads that
as a situation and ranks it T1 on the existing arm.

Two properties this must have, both learnable from how the chat side got them:

- **The state is derived at boot from the record, never written at crash time.**
  A crash is precisely the moment a write does not happen.
- **An armed procedure whose run has vanished must not stay armed.** The
  session's procedure memory clears on a turn that does not deliver (ADR-20's
  amendment); the agent equivalent is that a re-armed capability on the next
  scheduled run ships the whole document again rather than re-asserting a
  procedure whose run no longer exists.

This is a **phase 6 requirement**, and it is the reason phase 6 is not
cosmetic: without it, the most consequential thing an agent can do to a fleet
is the one thing the fleet's own consequence order cannot show.

### 9.2 Effect on WP-54a's two ruling requests

- **A new event topic** — dissolves. `agent.*` was never going to be a topic and
  the envelope validator (`envelope/validate.ts:19`) is right to refuse it: an
  agent run is a `task`. The `agent.stuck` template's situation derives from
  `task.run.completed` plus the run's findings.
- **Tier 3 as a rank value** — does *not* dissolve. `ConsequenceTier = 1 | 2 | 4`
  (`sessionRegistry.ts:151`) encodes tear 3's ruling that tier 3 is structure,
  not rank; the ratified template assigns Tier 3. That contradiction is real,
  independent of this design, and stays a live ruling request.

---

## 10. Non-goals

- **No second Govern surface for agents.** An axis on the existing matrix.
- **No `agent.*` topic namespace.** The validator's seven type prefixes stand.
- **No hub work.** Staleness enforcement waits for it (R3); nothing else does.
- **No rewrite of `AgentRunner` or `AgentDispatcher`** for its own sake. R1
  chose peer-actor precisely to avoid one.
- **No new inbox.** The fold absorbs; it does not duplicate.
- **No change to the four shipped manifests** as a precondition. Every SDK
  change here is additive.

---

## 11. Interaction with in-flight work

| in flight | interaction |
|---|---|
| **WP-54** (group A, the fourteen) | Holds `src/renderer/` and eight `sessionRegistry.ts` functions. §F's fold touches the same file; sequence after it, do not race it. |
| **WP-54a** (`agent.stuck` producer) | Direct overlap and a **welcome** one — it is phase 6's first instance built by hand. Land it as designed; generalize afterwards rather than blocking it now. |
| **WP-56** (deferral affordance) | Crossed claim on `sessionRegistry.ts`. Same sequencing rule. |
| **WP-51** (three producers) | The arming-causation half is adjacent to §D's arming relocation. Read its outcome before phase 3. |
| **WP-20g** (ToolGrant reach) | §D.5's deny-flip is the actor-scoped sibling of 20g's rule 7. Rule them together if 20g is still open. |

---

## 12. Phasing

Each phase ships alone and carries value alone, per branch discipline.

1. **Spine** — actor + task frame + `task.run.*` producers (carrying
   **arm-to-first-write**, R2's measurement) + threading `task` at both
   chokepoints. Purely additive; no behaviour change; unblocks the rest.
   *Smallest packet, largest unblock.*
2. **Findings as producers** — generalize `recordSentinelIncidents` so every
   agent's findings become episodic with provenance **and citations resolved
   against the run's supply** (§B). Makes WP-54a's producer the general case.
3. **Actor-scoped grants** — **three preconditions, all rulings:** §D.5 (the
   deny-flip), §D.6 (re-issue, never reinterpret), §D.7 (cross-agent
   contributed tools). Fixes the live cross-actor bleed. Opens
   `tool-registry.ts`.
4. **Assembly on the agent path** — bundles, manifests, fail-closed per R3 and
   §6.1.
5. **Procedure-governed remediation** — depends on R4, on the **R4 sitting**
   (a real destructive path, judged, before any production enablement), and on
   phase 3. Runbook `tools:` authoring against the agent surface.
6. **UX fold** — situations from agent tasks, **including the halted armed run
   (§9.1)**; Govern actor axis.

Phases 1 and 2 are safe and independently valuable and can start immediately.
Phase 3 is three rulings before it is code; phase 5 is a ruling and a sitting.

---

## 13. Open questions and watch items

1. **Actor id convention** (§A.1) — underscores vs. agent-name-verbatim. Pin in
   the phase-1 packet.
2. **The §D.5 deny-flip** — needs an owner ruling of its own, WP-20f-shaped.
3. **Runbook `tools:` authoring against contributed tools** — no shipped
   runbook claims one today; phase 5 cannot be tested without this.
4. **Budget on the agent path** — the assembler takes a token budget; agents
   have a *money* budget (`DailyBudgetGuard`). Two budgets, unreconciled. Not
   urgent, but do not let them silently become one.
5. *(Elevated out of this list at architect review — cross-agent contributed
   tools are a security ruling, not sequencing. Now **§D.7**, a phase-3
   precondition.)*
6. **`ConsequenceTier` vs. Tier 3** (§9.2) — live, independent of this note.
7. **Session auth on the satellite** — architecture §11 watch item 4, unchanged
   and now more load-bearing: with agents attributed properly, the human actor
   is the remaining coarse one.

---

## 14. Architect review — disposition (2026-08-21)

Verdict: diagnosis right, four rulings sound, six findings, none fatal. Two
settle before phase 3, one before phase 5. Every finding is applied above; this
table is the index, not the content.

| # | finding | disposition | lands in |
|---|---|---|---|
| 1 | R4's comparison is self-serving on one axis — "strictly more governed" is false on contemporaneity | Amended to **differently governed, more reviewed, less contemporaneous**; all three clauses travel together. R4 also gains an owner sitting on a real destructive path before first production enablement | §3 R4 · phase 5 |
| 2 | The arm is agent-timed and nothing bounds it — arming at line 1 reproduces the option R2 rejected | **Measure before enforcing**: `task.run.*` carries arm-to-first-write from phase 1; a bound is authored against a measured distribution, never a guessed constant | §3 R2 · phase 1 |
| 3 | A halted armed run is missing — the highest tier in the order, and chat's re-fold-on-boot has no agent equivalent | New section. Detectable from the record alone (assigned, gated acts, no completed); derived at boot, never written at crash time; T1 on `rankSession`'s existing ruled arm | §9.1 · phase 6 |
| 4 | The grant migration reinterprets rather than re-issues — what WP-45's P4 forbids | Follows P4: every grant re-issued as a visible `control.grant.issued` at its actor-bearing shape, under a new reason-vocabulary member; idempotent from the record, no new marker key | §D.6 · phase 3 |
| 5 | Cross-agent contributed tools is a security ruling, not sequencing — both defaults have holes | Elevated out of the open-questions list to a phase-3 precondition beside §D.5. Conjunction is a candidate, not a ruling | §D.7 · phase 3 |
| 6 | §2.1 promised citations the contract did not carry — an uncited finding on the unattended path is the WP-25 failure wearing a type | `Finding.citation`, resolved through the existing `supplyFromBundle` join — one derivation, per ADR-24 P5 | §B · phase 2 |

**Recorded from the review, worth keeping.** §A.2 is the **fifth instance of
the collision family** seen on this branch this week — one word carrying two
meanings, the shape `total` took at WP-48/50/52. Here it is `AgentAutonomy`
(a ceremony preference) against `Autonomy` (an actor class). Deriving the class
from the trigger resolves it without renaming either.

**Standing, on the owner:** R4 is the largest loosening this project has made.
It is ruled in principle and wants an explicit owner ruling with a name on it —
not adoption by design note.
