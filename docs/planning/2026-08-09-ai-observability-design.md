# AI & Agent Observability — Design

**Status:** approved design, not yet implemented
**Date:** 2026-08-09

## Goal

When an agent does something unexpected — fails to run, makes a change nobody asked for, burns
money in a loop — the user can find out what happened by reading a log file.

That sentence sets every decision below. **Files are the product; the UI is a viewer over them.**
`tail -f` is the primary interface, so the format is optimised for a human reading a terminal, and
anything that would make tailing unpleasant (JSONL, inline prompts) is pushed out of the line.

## Why this is mostly plumbing

The pieces largely exist and do not reference each other.

| Piece | State today |
|---|---|
| `logging/Logger.ts` | Leveled logger with a file sink and rotation. The sink is gated on `NEXUS_LOG_FILE`, which nothing sets, and `logging/config.ts` — which computes the log path — is **never called**. Console-only in practice, alongside 77 raw `console.*` calls. |
| `ctx.log` (`buildAgentContext`) | The one writer that genuinely produces a file. Levels are decorative: `debug()` appends exactly like `info()`. |
| Per-run log files | Only `AGENT_RUN_NOW` passes `logFileName`. Scheduler, event bus and the GraphQL resolver call `runner.run(agent)` bare, so **unattended runs have no isolated record** and their `agent_runs.log_file` is NULL. |
| Run id | `ipc-handlers.ts` mints `run-${Date.now()}`, broadcasts it, keys an AbortController with it, then discards it. Never reaches the runner, the DB, or a log line. |
| `AgentAIClient` | No instrumentation at all. No prompt, response, model, token count, cost, duration or turn count is recorded anywhere. |
| Tool calls | **Are** audited, via `NexusToolProvider` → `ToolRegistry.call()`. |
| Token/cost | `GatewayUsageRecord` exists but only `AIGatewayRoutes` writes it — WP sites calling out. Agent and chat LLM calls have none. |
| Audit sinks | Three, well built, centrally redacted, rotated — and carrying no run id, so they cannot be joined to the narrative. |
| Retention | Five uncoordinated policies (5 MiB×3, 20 files, 100 rows, 1000 records, 1000 entries), none visible or configurable, no aggregate cap. |
| UI | One button: `shell.openPath()` on `agent.log`. |
| Settings | No log level anywhere in `NexusSettings`. |

So: **AI-call instrumentation is a genuine gap. Everything else is connecting parts that already
exist.** The design reflects that ratio.

---

## 1. Layout

One root, so there is a single directory to `cd` into.

```
nexus-ai/logs/
  nexus-2026-08-09.log                     ← the combined stream; this is what you tail
  agents/
    security-sentinel-2026-08-09.log       ← per-agent durable record
    log-processor-2026-08-09.log
  transcripts/
    r_8f3a2c.transcript                    ← full LLM exchanges, referenced by log lines
```

Every agent line is written **twice** — once to its agent file, once to the combined stream. The
duplication is deliberate and cheap: it is what lets you tail one file to watch everything while
still being able to read one agent in isolation. `run=` on every line is what makes the two views
reconcilable.

Reports (`run-*-report.md`) are user-facing artifacts, not logs. They move to
`nexus-ai/agents/<agent>/reports/` and are out of scope for retention here.

## 2. Line format

```
13:31:02.123 INFO security-sentinel run=r_8f3a2c phase name=scan detail=acfprod  12 plugins
13:31:04.881 INFO security-sentinel run=r_8f3a2c llm.call model=claude-opus-5 turn=1 in=1204 out=318 cost=0.0091 dur=1.4s → r_8f3a2c.transcript
13:31:05.002 INFO security-sentinel run=r_8f3a2c tool.call tool=wp_plugin_list target=acfprod tier=1 dur=210ms ok=true
13:31:09.140 WARN security-sentinel run=r_8f3a2c finding severity=high id=FS-02 site=acfprod  unexpected file in wp-content
13:31:11.007 INFO security-sentinel run=r_8f3a2c mutation op=wp_plugin_update target=acfprod before="acf 6.8.5" after="acf 6.8.6"
```

`<time> <LEVEL> <source> run=<id>  <event> <key=value…>  <free text>`

- **Time only, not a full timestamp.** The date is in the filename; repeating it on every line
  costs ten columns of terminal width for information already known.
- **logfmt key=value**, so `grep`, `awk` and a regex all work, without needing `jq` to read it.
- **`run=` first**, because `grep run=r_8f3a2c logs/**/*.log` reassembling a whole run across every
  file is the single most valuable query this design enables.
- **One event per line.** Multi-line content never appears in the stream — see §4.

### Event vocabulary

Small and fixed. Anything outside it is a free-text `info`/`warn`/`error`/`debug` line.

| Event | Carries |
|---|---|
| `run.start` | trigger (cron/event/manual), scope size |
| `run.end` | status, duration, findings, total cost |
| `run.skip` | **why a run did not happen** — disabled, empty scope, load failure |
| `phase` | name, optional detail |
| `action` | label, result, duration |
| `site` | site, status |
| `llm.call` | model, turn, in/out tokens, cost, duration, transcript ref |
| `llm.error` | model, turn, error |
| `tool.call` | name, target, tier, duration, ok/error |
| `mutation` | operation, target, **before→after** |
| `finding` | severity, id, site |
| `credential` | provider, action — never values |

`action` and `site` are separate events rather than three shapes sharing `phase`. The point of a
closed vocabulary is that `grep event=phase` returns one field shape; collapsing `{name,detail}`,
`{action,result,dur}` and `{site,status}` under a single word costs exactly the property the
vocabulary exists to provide. One word, one shape.

`run.skip` closes the one case that currently produces zero bytes: `auto-run-gate` returns a bare
`false`, so a scheduled run that was skipped is invisible. "The agent didn't run" is the first
scenario a user will bring, and it must not be the one with no evidence.

`mutation` carrying before→after is what makes "it changed something I didn't expect" answerable
from the log itself rather than by inference from an intent line.

## 3. Run id

`r_<base36 timestamp><4 random>` — short enough to type, unique enough to grep.

Minted by `AgentRunner.run()` for **every** run, not just Run Now, and threaded into:

- every log line from that run, in both files
- `agent_runs.run_id` (new column)
- every `operation-audit.log` entry produced during the run (new field)

That last one is the join between the compliance record and the narrative, and it is the reason
the audit sinks stay as they are rather than being merged into this system: they answer *what was
done*; these files answer *why*, and `run=` connects them.

Chat turns get `c_<…>` and gateway requests `g_<…>` in the same field, so "AI interactions across
Nexus" is one queryable space rather than three.

## 4. Transcripts

The line records metadata; the exchange goes to `transcripts/<runId>.transcript` and the line
points at it with `→`.

Three reasons, and all three matter:

1. A 4,000-token prompt inline destroys the thing we chose files for.
2. Transcripts are the disk cost. Giving them their own file gives them their own retention, so
   the narrative can be kept for weeks while transcripts are kept for days.
3. Transcripts are where site content and anything a user pasted into chat live. Isolating them
   means the strictest redaction and the shortest retention apply to exactly one file type.

Off by default. Enabled by an explicit **"Record full AI transcripts"** setting, not by log level —
raising a log level should never silently start recording customer content.

## 5. Levels

`ERROR | WARN | INFO | DEBUG` — the existing `LogLevel` enum, not a new scale. ("DEV" is not a
standard level and adds nothing INFO/DEBUG don't cover.)

- Global default in `NexusSettings.logLevel`, default `INFO`.
- **Per-agent override** in agent settings. You debug one agent, not the whole app — a global DEBUG
  on a fleet of agents produces noise nobody reads.
- `NEXUS_LOG_LEVEL` still wins, for a dev launching from a shell.
- Levels gate what is written to file, not just console. Today `ctx.log.debug()` writes
  unconditionally, which is why the level knob currently means nothing.

## 6. Rotation and retention

- **Daily**, by date in the filename. A day is the unit a person reasons in.
- **Size guard within a day**: past `maxBytes`, roll to `nexus-2026-08-09.2.log`. Prevents one
  runaway agent filling a disk before midnight.
- **Retention in days**, not generations: logs 14, transcripts 3. Both configurable.
- **A total disk budget** (default 250 MB) with oldest-first eviction across all categories. Size
  caps per sink are what produced five uncoordinated policies; one budget is a number a user can
  actually reason about.
- **Failure-triggered preservation**: a run that errored, timed out, or performed a Tier 3
  operation is exempt from day-based eviction. The runs most worth auditing are otherwise the ones
  that age out on schedule like any other.

## 7. Disk visibility

Preferences → Nexus AI → **Logging**:

- total size, broken down by combined / per-agent / transcripts / audit
- the path, with Reveal in Finder
- level, per-agent overrides, transcript toggle, retention days, disk budget
- **Clear logs**, which states what it will delete before doing it

`StorageHealthPanel` gains logs as a category — it currently has no idea they exist.

## 8. SDK surface

Agents never touch files. `ctx.log` gains structured methods matching the vocabulary; the runtime
stamps agent name, run id, level and destination.

```ts
ctx.log.phase('scan', 'acfprod');
ctx.log.finding({ severity: 'high', id: 'FS-02', title: '…', site: 'acfprod' });
ctx.log.mutation({ op: 'wp_plugin_update', target: 'acfprod', before: 'acf 6.8.5', after: 'acf 6.8.6' });
```

`llm.call` and `tool.call` are emitted by the **runtime** — `AgentAIClient` and
`NexusToolProvider` — never by the agent. An agent cannot forget to log its own model calls, and
cannot lie about them. `info`/`warn`/`error`/`debug` stay freeform, because most of what an agent
has to say is prose.

## 9. Redaction

Every structured value and every free-text segment passes through the existing
`redactParams` / `maskSecretsInString` from `mcp/audit.ts`, including `FREEFORM_FIELDS`
withholding. Transcripts get the same treatment.

Reusing that path rather than writing a second one is the point: it is already the tested,
four-review-rounds-hardened implementation, and a parallel redactor is how one of them silently
falls behind.

## 10. Documentation

- `docs/logging.md` — developer reference: layout, format, vocabulary, levels, retention,
  redaction, how to add an event.
- A user-guide section: where logs live, what's in them, how to change level, how to read a run,
  what to send to support.
- **Fix `docs/user-guide.md:222`**, which is currently wrong on both file and scope: it says Tier
  2/3 operations go to `audit.log`; they go to `operation-audit.log`, and `audit.log` is the
  all-tiers buffer.

## Non-goals

Remote log shipping. Hash-chained tamper-evidence. A log search UI — `grep` is the UI, and that is
the decision, not a shortcut. Per-line encryption. Structured querying beyond what `grep` on
key=value gives.

## Testing

- Format stability: a golden sample per event type, so the shape cannot drift unnoticed.
- Redaction: credentials in prompts, tool args and free text never reach either file.
- Rotation: date rollover, mid-day size roll, day-based eviction, budget eviction order,
  failure-preservation exemption.
- Run id: propagates from `AgentRunner` into both files, `agent_runs`, and audit entries — for a
  **scheduled** run, not only Run Now.
- `run.skip`: emitted with a reason for each gate in `auto-run-gate`.
- Levels: `debug()` writes nothing to file at INFO; a per-agent override beats the global.

## Phasing

Each phase is independently useful and independently shippable.

1. **Skeleton** — run id, the writer, both files, event vocabulary, `ctx.log` wiring, `run.skip`.
   After this a run is readable end to end.
2. **AI instrumentation** — `llm.call` / `llm.error`, token and cost accounting, transcripts.
   Closes the actual gap.
3. **Control** — levels, settings, Preferences UI, retention and disk budget.
4. **Joins and docs** — run id into `operation-audit.log`, `mutation` before→after, both documents.
