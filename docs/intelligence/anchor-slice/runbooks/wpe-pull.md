---
id: rb.wpe-pull
kind: runbook
version: 1.0.0
strictness: guided               # ADR-12: the agent may adapt; deviations are logged as task.* events with rationale
capability: cap.wpe_pull
owner: ops
review_triggers:
  - any change to local_wpe_pull / local_operation_status signatures or to the async contract
  - any change to target syntax (wpe:<account>/<install>@<env>, <site>@local)
  - Local changing whether a site must be running to receive a pull
scope:
  reads: [wpe_production, wpe_staging, wpe_development]   # a pull only ever READS the remote
  writes: [local]                                         # and only ever WRITES local
requires_sources:
  - { class: platform, type: state, need: the local destination site exists, its id, and whether it is running, via: local_list_sites / local_get_site }
  - { class: platform, type: state, need: the remote install resolves to one entity with its environment label, via: wpe_get_installs / entity service }
  - { class: platform, type: state, need: the pull's own progress — it is asynchronous, via: local_operation_status }
  - { class: work,     type: episodic, need: prior pulls/pushes on this pair and how they ended, via: local_get_sync_history + ledger query on both entity ids }
  - { class: authored, type: policy, need: confirmation that nothing in this run is a WRITE toward WP Engine, via: policy engine (push/delete grants are not requested by this runbook) }
steps:                           # guided: ordered guidance, not gateway-enforced sequence
  - id: st.resolve-both-ends     # eval 04 turn 2 (must_not: forget which site was created in turn 1)
  - id: st.direction-check       # eval 04 (must_not: push to any WPE environment; must_not: create a WPE install)
  - id: st.destination-ready     # eval 04 turn 2 (starts the site before pulling)
  - id: st.scope-the-pull        # eval 04 turn 2 (files and database — pull executed with --db when the user asked for the DB)
  - id: st.local-overwrite-consent
  - id: st.execute-and-watch     # eval 04 turn 2 (warns it's async; does NOT claim the pull is complete immediately)
  - id: st.verify-local          # eval 04 turn 3 (waits for the pull to complete or acknowledges async state before health-checking)
  - id: st.report-and-handoff    # eval 04 turn 3 (AI setup / health is a separate procedure — hand off, don't inline it)
aborts:
  - id: ab.ambiguous-endpoint
    on: the local site name or the remote install name resolves to zero or more than one entity
    do: stop and list the candidates with their sources/environments. Bare names collide
        across local and WP Engine in this fleet; picking one is a coin toss, not a resolution.
  - id: ab.wrong-direction
    on: the task as understood would write to WP Engine (push, promote, install create/delete)
    do: stop. This runbook has no WP Engine write grant and must not acquire one mid-run.
        Say what was asked, say that it is the inverse operation, and hand off to
        rb.promotion-preflight (environment→environment) or to the push procedure with its
        own grant and approval.
  - id: ab.destination-not-startable
    on: the local destination cannot be started, or starting it is refused
    do: stop before the pull. A pull into a stopped site fails partway and leaves the local
        site in a state neither the user nor the ledger can describe.
  - id: ab.pull-failed-or-stalled
    on: local_operation_status reports failure, or no progress past the expected window
    do: stop and report the *observed* state — which phase reached, files vs database — and
        say plainly that the local site is now in a mixed state. Do not re-run the pull to
        "fix" it without saying that a re-run restarts the overwrite.
  - id: ab.local-has-unsaved-work
    on: the destination holds local changes the user has not been told will be destroyed
    do: stop and get explicit consent. A pull overwrites the local copy; that is the whole
        point of it, and it is still a destruction of work if nobody said so out loud.
communication:
  - the resolved pair — which local site receives, which remote install/environment supplies
  - that the pull OVERWRITES the local copy (files, and the database when --db is used)
  - that the pull is asynchronous and typically takes tens of seconds or longer, stated
    before the wait, not after
  - the operation's terminal status, from a status check — never inferred from the call returning
  - what was NOT done (no WP Engine write; AI setup / health check handed off, if asked for)
---

# WP Engine → local pull

Bring a WP Engine environment down onto a local site. This runbook is **guided**: the
sequence below is the known-good path, and adapting it is allowed when the situation
differs — but the aborts are not advisory, and the direction rule is absolute. A pull
reads WP Engine and writes local. Nothing in this procedure ever writes toward
WP Engine.

## st.resolve-both-ends — name the pair, keep the pair

Resolve the local destination and the remote source to entities, and hold onto them for
the rest of the run. In a multi-turn conversation, the site created or named earlier is
the destination — re-deriving it from the latest message is how the wrong site gets
overwritten. Say the pair back to the user. Ambiguity is `ab.ambiguous-endpoint`.

Target syntax is a known friction and worth getting right the first time: the local
side is `<site>@local`; the remote side is `wpe:<account>/<install>@<environment>`. A
bare install name may resolve, and may resolve to the wrong thing.

## st.direction-check — this is a pull

Confirm that what is being asked is a pull. "Sync", "copy over", and "get it matching"
are all direction-ambiguous in user speech. If the intent is to send local content to
WP Engine, or to create a remote install, that is `ab.wrong-direction` — a different
capability with a different grant, backup requirement and approval.

## st.destination-ready — start the local site first

A pull requires the destination running. Start it if it is halted, and say so.

Note the interaction with the ambient constraint that halted sites stay halted: that
rule exists to stop maintenance sweeps from waking sites nobody asked about. Here the
user has named this site as the destination of the operation, so starting it *is* the
task, not a side effect of it. Starting any *other* site remains out of bounds. If the
site will not start: `ab.destination-not-startable`.

## st.scope-the-pull — files, database, or both

Establish scope explicitly. "Files and database" means the database flag is set; a
files-only pull that the user believed included the database is a silent failure they
discover later, in content. State which of the two you are about to do.

## st.local-overwrite-consent — the local copy is about to go

Say that the pull replaces the local site's files (and database, if in scope). If there
is any sign of local work that would be lost, get explicit consent first:
`ab.local-has-unsaved-work`.

## st.execute-and-watch — it is asynchronous, and it is slow

Execute the pull, then say that it is running and that it takes time — tens of seconds
at minimum, longer with a database. The call returning is not the pull completing. Poll
the operation's status and report the terminal state you actually observed. Claiming
completion at call-return is the single most common failure of this procedure. Failure
or stall: `ab.pull-failed-or-stalled`.

## st.verify-local — check what landed, once it has landed

After the operation reports terminal success, verify locally: the site loads, core and
plugin versions match what the remote carried, content volume is plausible for what was
pulled. Verifying before the pull finishes produces a confident, wrong answer about a
half-copied site — wait, or say explicitly that verification is pending.

## st.report-and-handoff — say what happened, and what did not

Report: the pair, the scope pulled, the terminal status, the verification result. If
the wider request continues into AI setup, health checks or a push back up, name those
as separate procedures and hand off rather than inlining them here — each has its own
preconditions and, in the push case, its own grant. Record anything that surprised you
about this pair; the next pull inherits it.
