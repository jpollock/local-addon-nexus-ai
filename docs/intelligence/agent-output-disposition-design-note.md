# What an agent run produces, and what it should demand — design note

*2026-08-21 · branch `poc/nexintelligence-ux` · companion to
[`agent-actor-design-note.md`](agent-actor-design-note.md) (phase 2's
substance) · **owner picked option 1 at the 2026-08-21 sitting**; this note is
the design and the ruling request*

---

## 1. Why this exists

`agent-actor-design-note.md` phase 2 said: *generalize `recordSentinelIncidents`
so every agent's findings become episodic.* Ten minutes into building it, the
producer's own code stopped me:

> *"The tap reads ONE agent's output. Every agent's findings are not incidents,
> and **widening this is a scope decision, not an implementation detail**."*
> — `incidentProducer.ts:246`

That is correct, and the reason is sharper than "the word is wrong."

---

## 2. What a run emits today — the inventory

| sink | what it carries | who reads it |
|---|---|---|
| event log (`nexus-*.log`) | `run.start/end`, `phase`, `action`, `site`, `finding`, `mutation`, `tool.call`, `llm.call`, `credential` | a human grepping |
| `agent_runs` row | status, error, summary, findings_count, log/report paths, `run_id`, `task_id` | Agents history UI |
| `run-*.log` | the run's own log file, 20 kept per agent | the Log chip |
| `run-*-report.md` | `AgentResult.summary` written to disk, 20 kept | **nothing** |
| Inbox | `kind`, `status`, `scope`, `code`, `severity`, `seenCount`, `payload` | Inbox UI (being folded into Now) |
| ledger | `episodic.incident.recorded` (sentinel only), `episodic.agent_run.failed` (WP-54a), `task.run.*` + acts (WP-57) | Now screen, chat retrieval |
| `AgentResult` | `verdict`, `findings[]`, `plan`, `sites{}`, `summary` | RunDrawer |
| auto-pause marker | `pauseIfStuck` | the scheduler |

Two observations fall straight out of the table. **`producesReports` is a
manifest flag with no surface at all** — seo-insights writes real reports to
disk that nothing displays. And the ledger sees almost none of this: one
agent's findings, one agent's failures, and the run frame.

---

## 3. The finding: three disposition vocabularies, and they disagree

**(a) SDK.** `Finding.severity` — five levels. `Finding.category` — four values
(`active-compromise`, `pre-breach`, `misconfiguration`, `informational`).

**(b) Inbox.** `InboxKind = 'decide' | 'problem' | 'know'`, with a real
lifecycle: `open | dismissed | done`, plus `seenCount` and `firstSeenAt`.

**(c) Ledger / Now.** Situation classes (`incident.no-run`, `agent.stuck`) and
`ConsequenceTier = 1 | 2 | 4`, derived from structural facts.

And the entire bridge from (a) to (b) is one line in `recordRun.ts`:

```ts
const kind = f.severity === 'info' || f.category === 'informational' ? 'know' : 'decide';
```

**Five severity levels and four categories collapse into two outcomes**, and
everything not explicitly informational becomes something the user must
*decide*. That is the mechanical cause of agents feeling noisy.

### 3.1 Severity is not calibrated across agents — measured

| agent | how `high` is assigned | what it means |
|---|---|---|
| security-sentinel | reserved for breach/breakage | **something is wrong now** |
| seo-insights | `orphans.length > 10 ? 'high' : 'medium'` | **there are a lot of these** |

Same word, two scales. `SEVERITY_FLOOR: 'high'` is calibrated to the first and
meaningless against the second — so the incident tap could never have been
widened by relaxing a threshold. Also worth naming: **`Finding.category`'s
values are sentinel's domain vocabulary leaked into the shared SDK type.** No
other agent can meaningfully set `pre-breach`.

### 3.2 Why not log levels

`WARN | INFO | DEBUG` rank **how loud**, which is a claim about the observer's
attention budget. What the user needs is **what does this demand of me, and who
can resolve it**.

This branch already resolved this and wrote it down: `ConsequenceTier` is
derived from *did a write land in scope* and *is there a derivable deadline* —
structural facts, never an adjective. That is the **derived-never-authored**
rule, and a severity level violates it by construction, because severity is
authored by the agent and (§3.1) uncalibrated between them.

---

## 4. The design — agent declares disposition, platform derives demand

The split is the point: **the agent declares only what it alone knows; the
platform derives everything that ranks.**

### 4.1 Authored — the disposition

```ts
export type Disposition = 'problem' | 'decide' | 'know';

interface Finding {
  // …existing…
  /** What KIND of thing this is. Overrides the agent's manifest default. */
  disposition?: Disposition;
}

interface AgentDefinition {
  // …existing…
  /** This agent's default disposition, reviewed in the manifest. */
  findingDisposition?: Disposition;
}
```

**Resolution order:** the finding's own → the agent's manifest default →
`'know'`.

**Why a manifest default and not a per-finding requirement.** seo-insights has
**14** `ctx.log.finding(...)` call sites; sentinel's specialists have their own.
Declaring once, in a reviewed manifest, means sentinel says `problem` and
seo-insights says `know` and **not one call site changes**. It is the same
shape as the agent-actor note's "the manifest requests, the grant authorizes",
and the same shape as `producesApprovals` / `effect` / `allowsProduction`.

**Why `'know'` is the fallback.** An agent that has declared nothing has not
earned the user's attention. The alternative — defaulting to today's
`decide` — preserves current behaviour but keeps the noise, and the noise is
what we are fixing. *(This is the one place I am overriding the "a missing
setting is the safe value" instinct: for attention, quiet is the safe value.
Flagged as a ruling point in §6.)*

**On the words.** I recommend **reusing the Inbox's three verbatim** rather
than inventing synonyms like `observation | proposal`. They are ratified
vocabulary, they were exercised against a real user, and a fourth vocabulary is
precisely the disease this note is about. The cost is that `decide` names what
the *user* does rather than what the *thing is*, which reads slightly oddly as
an authored field. I think that is the cheaper price.

### 4.2 Derived — the demand

Nothing below is authored by an agent. Each is already available:

| input | already exists as |
|---|---|
| is it still open? | Inbox `status`, incident `resolved` |
| did a write land in scope? | `rankSession`'s ruled T1 arm |
| is there a derivable deadline? | `rankSession`'s second T1 arm |
| how often has it recurred? | Inbox `seenCount`, `firstSeenAt` |
| did the user ask for it? | runbooks' `unrequested:` |
| is the agent blocked? | `agent.stuck` (WP-54a) |

### 4.3 The consequence that resolves phase 2

**"Incident" stops being a threshold and becomes derivable.**

> An incident is a `problem` with a lifecycle.

seo-insights declaring `know` never produces one, *whatever* severity its
findings carry — so the widening question that blocked phase 2 is answered by
the abstraction rather than by re-tuning `SEVERITY_FLOOR`. `severity` survives
as a **domain-local** field, useful inside one agent's own report and never
again a cross-agent gate.

### 4.4 What gets deleted

The `recordRun.ts` inference line. `kind` comes from the resolved disposition.
That is the whole behavioural change on the Inbox side.

---

## 5. What this does NOT solve

- **`producesReports` still has no surface.** A report is a fourth thing beside
  the three dispositions — not a problem, not a decision, not a notice, but an
  artifact to *read*. seo-insights writes them today and nothing shows them.
  Named here; owned by a UX packet.
- **`Finding.category`'s sentinel-specific values** stay in the shared SDK type
  until something removes them.
- **Rendering.** A `problem` from a non-sentinel agent, or a `know` that
  reaches Now, still needs ratified copy. Only two situation classes exist
  (`agent.stuck`, `incident.no-run`) and neither covers this. **This is a
  designer input, and it is the real gate on the visible half.**

---

## 6. Ruling requests

1. **The closed set, and the words.** Three (`problem | decide | know`), reusing
   the Inbox's ratified vocabulary? Or a domain-neutral rename
   (`problem | proposal | observation`), accepting a fourth vocabulary?
2. **The fallback.** `'know'` (quiet by default, recommended) or `'decide'`
   (today's behaviour preserved, noise preserved)?
3. **Is `RemediationPlan` a fourth disposition or an attachment to `decide`?**
   The SDK already carries a plan an agent proposes and a human approves. It
   reads like `decide` with a payload, but it may deserve its own word.
4. **Designer:** copy for a non-incident finding reaching Now. Blocking for the
   visible half; nothing else in this note waits on it.

## 7. Sequencing

Unblocked by any ruling, and useful regardless: the **citation supply** work
from the agent-actor review's finding 6 — an agent run's tool trace becoming a
citable universe, mirroring `supplyFromBundle`. Every disposition benefits from
a finding that can cite what it saw.

Blocked on ruling 1+2: the SDK field, the manifest default, the `recordRun`
change. Small once ruled — one type, one resolution helper, one deleted line,
two manifest declarations.

Blocked on ruling 4: anything rendering in Now.
