# Scheduler Design

Four schedulers run concurrently in the main process. All are started inside the `readyPromise` IIFE in `src/main/index.ts`.

## Schedulers

| Scheduler | Class | Interval | Controlled by |
|---|---|---|---|
| Content index | `OpportunisticScheduler` | User setting | `localContentIndexAutoEnabled` + `localContentIndexIntervalHours` |
| Halted site scan | `HaltedSiteRefreshScheduler` | User setting | `haltedSiteRefreshIntervalHours` (always runs) |
| WPE SSH refresh | `WpeRefreshScheduler` | User setting | `wpeRefreshAutoEnabled` + `wpeRefreshIntervalHours` |
| WPE CAPI sync | Inline `setInterval` in index.ts | 1 hour (fixed) | `wpeSyncAutoEnabled` + `wpeSyncIntervalHours` (staleness threshold) |

## Reactivity

Settings changes propagate via `onSettingsUpdated` callback in `src/main/ipc-handlers.ts:946`. When `UPDATE_SETTINGS` is called:

1. `opportunisticScheduler.restart(...)` — restarts with new settings
2. `haltedRefreshScheduler.restart(newIntervalMs)` — restarts if interval changed
3. `wpeRefreshScheduler.restart(newIntervalMs)` or `.stop()` — based on `wpeRefreshAutoEnabled`

The WPE CAPI `setInterval` (hardcoded 1h) reads settings dynamically each tick — no restart needed.

## Defaults

- `localContentIndexAutoEnabled`: false (opt-in)
- `wpeSyncAutoEnabled`: false (opt-in) — SSH plugin sync
- `wpeRefreshAutoEnabled`: false (opt-in) — SSH site-info refresh
- `haltedSiteRefreshIntervalHours`: 24h — always runs, no toggle

## Adding a new scheduler

1. Create scheduler class with `start()`, `stop()`, and `restart(intervalMs)` methods
2. Add it to the `readyPromise` IIFE block in `index.ts`
3. Wire `restart` / `stop` into the `onSettingsUpdated` callback at `index.ts:~660`
4. Add the settings key to `NexusSettings` (types.ts) and `UpdateSettingsSchema` (schemas.ts)
