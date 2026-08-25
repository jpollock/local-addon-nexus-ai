# Scheduler Design

*Updated 2026-08-25 (was: "four schedulers", written 2026-05-26).*

**Seven scheduled mechanisms** run in the main process, started inside the
`readyPromise` IIFE in `src/main/index.ts` (classes live in
`src/main/startup/`, except `OpportunisticScheduler` in `src/main/scheduler/`
and `AgentScheduler` in `src/main/agent-runtime/`).

## Schedulers

| Scheduler | Class | Controlled by |
|---|---|---|
| Content index (local) | `OpportunisticScheduler` | `localContentIndexAutoEnabled` + `localContentIndexIntervalHours` |
| Halted site scan | `HaltedSiteRefreshScheduler` | `haltedSiteRefreshIntervalHours` (always runs, no toggle) |
| WPE SSH refresh | `WpeRefreshScheduler` | `wpeRefreshAutoEnabled` + `wpeRefreshIntervalHours` |
| WPE CAPI sync | Inline `setInterval` in index.ts (1h tick) | `wpeSyncAutoEnabled` + `wpeSyncIntervalHours` (staleness threshold) |
| WPE content index | `wpeContentIndexTimer` (`startWpeContentIndexScheduler`) | `wpeContentIndexAutoEnabled` + `wpeContentIndexIntervalHours` |
| External host refresh | `ExternalRefreshScheduler` | `externalRefreshAutoEnabled` + `externalRefreshIntervalHours` |
| External content index | `ExternalContentIndexScheduler` | `externalContentIndexAutoEnabled` + `externalContentIndexIntervalHours` |

**Plus `AgentScheduler`** (`src/main/agent-runtime/`) — cron/event triggers for
agents. This is what runs security-sentinel's daily 03:00 sweep. The schedule
source is the agent's **manifest**; a user cadence overrides it only when
`cadenceSetAt` proves it was explicitly picked (`resolveAgentCron`,
`src/main/agent-runtime/schedule.ts` — see CLAUDE.md "Agent schedules").

## Reactivity

Settings changes propagate via the `onSettingsUpdated` callback defined in
`src/main/index.ts` (grep `const onSettingsUpdated = ` — line numbers drift).
It restarts/stops **six** of the settings-driven mechanisms; the WPE CAPI
`setInterval` reads settings each tick instead. Both the IPC path
(`UPDATE_SETTINGS`) and the GraphQL path (`nexusUpdateSettings`) call it, so
`nexus settings set …` takes effect immediately.

Agent schedules react through a different path: `AGENT_SETTINGS_UPDATE`
re-registers the agent with `AgentScheduler` when `cadence`/`cadenceSetAt`
actually changed.

## Defaults

Everything that costs anything is **opt-in, default off**:
`localContentIndexAutoEnabled`, `wpeSyncAutoEnabled`, `wpeRefreshAutoEnabled`,
`wpeContentIndexAutoEnabled`, `externalRefreshAutoEnabled`,
`externalContentIndexAutoEnabled` — all `false`.
`haltedSiteRefreshIntervalHours`: 24h, always on.

## Adding a new scheduler

1. Create a scheduler class with `start()`, `stop()`, `restart(intervalMs)`
2. Start it in the `readyPromise` IIFE block in `index.ts`
3. Wire `restart`/`stop` into the `onSettingsUpdated` callback (grep for it) —
   NOT into one caller of it
4. Add the settings key to `NexusSettings` (types.ts) **and**
   `UpdateSettingsSchema` (schemas.ts — `.strict()` silently strips unknown keys)
5. Add a row to `JOBS` in `src/renderer/components/settings/derived.ts` so the
   Settings tab renders it
