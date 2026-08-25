# Agent Logging Reference

## Where logs live

All logs are under `~/Library/Application Support/Local/nexus-ai/logs/`:

```
logs/
  nexus-2026-08-10.log              ← combined stream (tail this one)
  agents/
    security-sentinel-2026-08-10.log
    log-processor-2026-08-10.log
    auth-probe-2026-08-10.log
  transcripts/
    r_abc123.jsonl                  ← full LLM exchanges (off by default)
```

Each agent line appears **twice**: once in `nexus-YYYY-MM-DD.log` and once in its own agent file. The duplication is deliberate — it lets you tail the combined file to see everything while still isolating one agent's history.

## How to read a line

```
00:00:00.000 INFO auth-probe run=r_msmvt5s000 run.start trigger=cron fullRun=false
00:02:03.967 INFO auth-probe run=r_msmvvqdg00 tool.call tool=wpe_get_installs tier=1 dur=3959ms ok=true
07:00:00.012 INFO seo-insights run=r_msnata8c00 run.skip trigger=schedule reason=agent-disabled
```

Format: `HH:MM:SS.mmm LEVEL source run=<id> [event] [k=v…]  [message]`

- **Time only**, not a full timestamp — the date is in the filename
- **Level is not padded** — `INFO` and `WARN` are 4 chars, `DEBUG` and `ERROR` are 5, deliberately unaligned
- **`run=` first** after source, because `grep run=r_abc123 logs/**/*.log` reassembles a whole run across every file
- **Event name** (optional) — from a fixed vocabulary (see below)
- **Key=value pairs** — logfmt style, so `grep`, `awk` and regex all work
- **Message** (optional) — separated by **two spaces**, so `awk -F'  ' '{print $2}'` extracts it reliably

## Three questions this log answers

### 1. Did my agent run?

```bash
# Today's combined log
tail -f ~/Library/Application\ Support/Local/nexus-ai/logs/nexus-$(date +%F).log

# One agent
tail -f ~/Library/Application\ Support/Local/nexus-ai/logs/agents/security-sentinel-$(date +%F).log

# Reassemble one run
grep 'run=r_abc123' ~/Library/Application\ Support/Local/nexus-ai/logs/**/*.log
```

If you see no lines for an agent, look for `run.skip` — that's why it didn't run.

### 2. What did it do?

Tool calls, mutations and findings all appear as structured events. Example:

```
00:00:04.435 INFO auth-probe run=r_msmvt5s000 tool.call tool=wpe_get_installs tier=1 dur=4431ms ok=true
00:00:24.130 INFO auth-probe run=r_msmvt5s000 tool.call tool=wp_plugin_list target=theawfulproduc tier=1 dur=19695ms ok=true
00:00:26.342 INFO auth-probe run=r_msmvt5s000 run.end status=success dur=26342ms findings=0
```

### 3. Why did it not run?

`run.skip` is emitted **once per agent per reason per day**, so a long-disabled agent emits one line, not one per tick:

```
07:00:00.012 INFO seo-insights run=r_msnata8c00 run.skip trigger=schedule reason=agent-disabled
```

Reasons include:
- `agent-disabled` — agent toggled off in Preferences
- `trigger-disabled` — the specific trigger (cron/event) is disabled
- `trigger=manual` — user clicked Run Now on a disabled agent

## Event vocabulary

Structured events carry a fixed set of fields. Anything else is a freeform `info`/`warn`/`error` line.

| Event | Fields | Example |
|---|---|---|
| `run.start` | `trigger`, `fullRun` | `run.start trigger=cron fullRun=false` |
| `run.end` | `status`, `dur`, `findings`, `failedCalls` (when non-zero) | `run.end status=success dur=26342ms findings=0` |
| `run.skip` | `trigger`, `reason` | `run.skip trigger=schedule reason=agent-disabled` |
| `phase` | `name`, `detail` | `phase name=cron detail="log-processor nightly sync"` |
| `action` | `action`, `result`, `dur` | `action action=fetchLogs result=ok dur=1234ms` |
| `site` | `site`, `status` | `site site=acfprod status=running` |
| `llm.call` | `model`, `turn`, `in`, `out`, `cost`, `dur`, `transcript` | `llm.call model=claude-sonnet-4 turn=1 in=1204 out=318 cost=0.0091 dur=1400ms transcript="/path/to/r_abc123.jsonl"` |
| `llm.error` | `model`, `turn`, `dur` | `llm.error model=claude-sonnet-4 turn=1 dur=2000ms` (message: `rate limit exceeded`) |
| `tool.call` | `tool`, `target`, `tier`, `dur`, `ok` | `tool.call tool=wp_plugin_list target=acfprod tier=1 dur=210ms ok=true` |
| `mutation` | `op`, `target`, `ok` | `mutation op=wp_plugin_update target=acfprod ok=true` (emitted by runtime on Tier 2/3 tool completion) |
| `finding` | `sev`, `id`, `site` | `finding sev=high id=FS-02 site=acfprod` (message: `unexpected file in wp-content`) |
| `credential` | (no current emitters) | Reserved for future use — no agent or tool currently emits this event |

**Note on `run.end`'s `failedCalls` field:** appears only when non-zero. An agent that caught a tool failure and carried on still has `status=success` — the run succeeded. A non-zero `failedCalls` means some tools failed, but the agent handled it.

## Log levels

Four levels: `ERROR | WARN | INFO | DEBUG`

- **Global default**: the `logLevel` setting (`nexus settings set logLevel DEBUG`), defaults to `INFO`; `NEXUS_LOG_LEVEL` overrides it
- **Per-agent override**: set in agent settings (debugging one agent shouldn't flood the whole log)
- **`NEXUS_LOG_LEVEL` env var**: wins over both, for dev launches from a shell

Levels gate what reaches the file, not just the console.

## Retention and disk budget

- **Daily files**, named by date: `nexus-2026-08-10.log`
- **Size guard**: if a file exceeds 5 MB within a day, it rotates to `nexus-2026-08-10.log.1`, `.log.2`, `.log.3` (generation appended after the extension)
- **Day-based retention**: logs kept for 14 days, transcripts for 3 days (both configurable)
- **Total disk budget**: 250 MB default, oldest-first eviction across all categories
- **Preservation**: runs that errored, timed out, or performed Tier 3 operations are exempt from eviction

The budget prevents runaway agents from filling the disk. Preferences shows total size broken down by combined / per-agent / transcripts / audit.

## Transcripts

Full LLM exchanges go to `transcripts/<runId>.jsonl`, referenced in `llm.call` log lines via the `transcript` field:

```
13:31:04.881 INFO security-sentinel run=r_8f3a2c llm.call model=claude-opus-5 turn=1 in=1204 out=318 cost=0.0091 dur=1400ms transcript="/Users/.../logs/transcripts/r_8f3a2c.jsonl"
```

**Off by default.** Enable per agent: open the agent's workspace → Settings tab → toggle "Write transcripts".

Why separate files?
1. A 4,000-token prompt inline destroys the tail-ability this design optimizes for
2. Transcripts are the disk cost — they get shorter retention (3 days vs 14)
3. Site content and pasted chat text live in transcripts — isolating them means the strictest redaction applies only there

## Redaction and withholding

Every value passes through the existing `redactParams` / `maskSecretsInString` from `src/main/mcp/audit.ts`. See [`CLAUDE.md § Logging & Audit`](../CLAUDE.md#logging--audit) for the full mechanism.

Two layers:

1. **Withholding** (for freeform command fields): `code`, `command`, `commands`, `args`, `argv`, `query`, `sql`, `script`, `patch` are replaced with `[WITHHELD: freeform input, 412 chars]`
2. **Masking** (for all other values): PEM blocks, API keys, Bearer tokens, `password=x` assignments, opaque 20+ char runs

Transcripts get the same treatment.

## Token cost accuracy

The `cost=` field in `llm.call` events uses token prices valid as of the date in `PRICES_AS_OF` (`src/main/logging/costTable.ts`). If Anthropic changes pricing and this table isn't updated, the cost field becomes stale. It reflects the price at the time the log was written, not necessarily the price billed.

To verify: check `costTable.ts` for the `PRICES_AS_OF` comment and compare against current Anthropic pricing.

## Useful queries

```bash
# All runs for one agent today
grep security-sentinel ~/Library/Application\ Support/Local/nexus-ai/logs/nexus-$(date +%F).log

# One complete run
grep 'run=r_abc123' ~/Library/Application\ Support/Local/nexus-ai/logs/**/*.log

# All skipped runs today
grep 'run.skip' ~/Library/Application\ Support/Local/nexus-ai/logs/nexus-$(date +%F).log

# Failed tool calls across all agents
grep 'ok=false' ~/Library/Application\ Support/Local/nexus-ai/logs/nexus-$(date +%F).log

# Mutations (things that changed production)
grep 'mutation' ~/Library/Application\ Support/Local/nexus-ai/logs/nexus-*.log

# Total cost for one run
grep 'run=r_abc123' ~/Library/Application\ Support/Local/nexus-ai/logs/**/*.log | grep 'llm.call' | awk '{for(i=1;i<=NF;i++)if($i~/^cost=/)print $i}' | cut -d= -f2 | paste -sd+ - | bc

# Errors only
grep ERROR ~/Library/Application\ Support/Local/nexus-ai/logs/nexus-$(date +%F).log
```

## What to send to support

When reporting an issue:

1. The relevant run's lines: `grep 'run=r_abc123' logs/**/*.log > run.log`
2. If the issue involves an LLM call and transcripts are enabled: the transcript file
3. The agent name and approximate time
4. Whether this was a scheduled run, event-triggered, or Run Now

Do **not** send the entire combined log — it may contain other users' data if this is a shared machine. Isolate the specific run.
