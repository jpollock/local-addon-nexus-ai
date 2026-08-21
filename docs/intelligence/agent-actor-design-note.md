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
> Tier 3 at all. But the substitute is strictly more governed than the chat
> path it is compared against, where a human clicks approve on a plan they read
> once: here the procedure was reviewed, versioned, hash-pinned and
> sequence-enforced before the run existed. *Rejected:* report-only remediation
> (everything else in this design still lands, but sentinel can never fix
> anything unattended), and off-production-only (excludes the 3am compromised
> production case that motivates the capability at all).

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

### 9.1 Effect on WP-54a's two ruling requests

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

1. **Spine** — actor + task frame + `task.run.*` producers + threading `task`
   at both chokepoints. Purely additive; no behaviour change; unblocks the
   rest. *Smallest packet, largest unblock.*
2. **Findings as producers** — generalize `recordSentinelIncidents` so every
   agent's findings become episodic with provenance. Makes WP-54a's producer
   the general case.
3. **Actor-scoped grants** — **owner ruling first** (§D.5). Fixes the live
   cross-actor bleed. Opens `tool-registry.ts`.
4. **Assembly on the agent path** — bundles, manifests, fail-closed per R3 and
   §6.1.
5. **Procedure-governed remediation** — depends on R4 and on phase 3. Runbook
   `tools:` authoring against the agent surface.
6. **UX fold** — situations from agent tasks; Govern actor axis.

Phases 1 and 2 are safe and independently valuable and can start immediately.
Phases 3 and 5 are rulings before they are code.

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
5. **Contributed tools called across agents** — `NexusToolProvider` falls
   through to another agent's tool via the dispatcher. Whose actor holds the
   grant: the calling agent or the contributing one? Answer before phase 3.
6. **`ConsequenceTier` vs. Tier 3** (§9.1) — live, independent of this note.
7. **Session auth on the satellite** — architecture §11 watch item 4, unchanged
   and now more load-bearing: with agents attributed properly, the human actor
   is the remaining coarse one.
