---
title: Error Handling
description: Exit codes, error output formats, common failure patterns, and retry guidance for the Nexus CLI
keywords: [errors, exit codes, debug, troubleshooting, retry, json, stderr]
---

# Error Handling

The Nexus CLI uses standard Unix exit codes, writes errors to stderr, and supports structured JSON output for scripted error handling.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Any failure — command error, site not found, Local not running, unexpected exception |

The CLI uses only `0` and `1`. Every `process.exit(1)` in the source corresponds to a printed error message. A cancelled interactive prompt (for example, answering "N" to a delete confirmation) exits with `0`.

`nexus doctor` exits `1` if any check has status `error`. Checks with status `warn` or `skip` do not affect the exit code.

---

## Error Output Format

Errors are printed to **stderr** using the prefix `❌`:

```
❌ Site not found: mysite
```

Bootstrap failures (Local not running, GraphQL unreachable) use a slightly different format:

```
❌ Timed out waiting for Local. Is Local running?
```

Unhandled exceptions surface as:

```
❌ Unexpected error: <message>
```

Success messages go to **stdout** and use the prefix `✅`:

```
✅ Site started: mysite
   Status: running
```

---

## JSON Error Format

When you pass `--json`, successful output is a JSON object or array on stdout. Errors still print to stderr as plain text and exit `1` — they are not wrapped in JSON. Check the exit code in scripts, not the output text:

```bash
result=$(nexus sites list --json 2>/dev/null)
if [ $? -ne 0 ]; then
  echo "Command failed"
  exit 1
fi
echo "$result" | jq '.local[].name'
```

For `nexus doctor --json`, the output is always a JSON object regardless of health status:

```json
{
  "version": "0.2.0",
  "healthy": false,
  "checks": [
    { "label": "Local running", "status": "warn", "detail": "Not running", "action": "Open the Local app" },
    { "label": "GraphQL server", "status": "warn", "detail": "No connection info — Local may not be running", "action": null }
  ]
}
```

The `healthy` field is `true` only when all checks are `ok`, `disabled`, or `skip`. Use this as the machine-readable pass/fail signal.

---

## Common Error Patterns

### Not authenticated to WP Engine

```
❌ Not authenticated with WP Engine
```

**Fix:** Run `nexus wpe login` and complete the browser flow. Then retry the original command.

```bash
nexus wpe login
nexus wpe list-installs
```

### Site not found

```
❌ Site not found: mysite
```

This happens when the site name does not match any site in Local, or when the `@local` suffix is missing where required.

**Fix:** List available sites first, then use the exact name:

```bash
nexus sites list --local-only
nexus sites get mysite@local
```

For commands that require `@local`, the error will say so:

```
❌ Target site must be local.
   Use: nexus sites start mysite@local
```

### Local not running

Bootstrap runs before most commands. If Local is not open, the CLI prints:

```
❌ Timed out waiting for Local. Is Local running?
```

**Fix:** Open the Local app, wait for it to finish loading, then retry. To diagnose what is wrong:

```bash
nexus doctor
```

### Network or timeout errors

Long operations (site creation, export, reindex, bulk updates) have per-command timeouts:

| Operation | Timeout |
|-----------|---------|
| Site create / start / stop / restart | 2 minutes |
| Site clone / export / import | 5–10 minutes |
| Content reindex | 10 minutes |
| Bulk operations | 10 minutes |
| Database export / import | 5 minutes |
| Pull / push to WP Engine | 10 minutes |

If a command exceeds its timeout, you will see:

```
Error: socket hang up
```

or

```
Error: connect ECONNREFUSED 127.0.0.1:4000
```

**Fix:** Check that Local is still running and the site is in the expected state. For large exports, use the Local app directly if the CLI timeout is insufficient.

### Native module version mismatch (NODE_MODULE_VERSION)

If the addon uses `better-sqlite3` compiled for the wrong Node version, you will see Local crash or the addon fail to load. This is a developer issue, not a runtime error for end users.

**Fix (developers only):**

```bash
npm run rebuild
# Then restart Local and reload the addon
```

---

## The `--debug` Flag

The Nexus CLI uses the `DEBUG` environment variable (not a `--debug` flag) to enable verbose output:

```bash
DEBUG=true nexus sites list
```

With `DEBUG=true`:
- Bootstrap actions are printed to stdout as they execute
- Unhandled exceptions include a full stack trace instead of just the message

Without `DEBUG`:
- Bootstrap actions are hidden (spinner is shown in TTY, nothing in non-TTY)
- Exceptions show only the message

---

## Retry Guidance for AI Agents

When scripting with the CLI or calling it from an AI agent, apply the following patterns:

**1. Check exit code before processing output.**

```bash
nexus sites get mysite@local --json
echo "Exit: $?"
```

**2. Use `nexus doctor --json` as a preflight check.**

Before running a sequence of commands, verify the system is healthy:

```bash
health=$(nexus doctor --json)
if ! echo "$health" | jq -e '.healthy' > /dev/null 2>&1; then
  echo "System not healthy — check nexus doctor output"
  exit 1
fi
```

**3. Treat exit `1` as non-retryable unless the error is transient.**

Retryable errors (transient):
- `socket hang up` — retry once after a 5-second delay
- `connect ECONNREFUSED` — wait for Local to start, then retry

Non-retryable errors (do not retry):
- `Site not found` — fix the site name
- `Not authenticated` — run `nexus wpe login`
- `Must specify` or `Target site must be local` — fix the command syntax

**4. For destructive operations, check `--dry-run` output first.**

```bash
# Preview what clean would remove
nexus wp db clean mysite@local

# Apply only after confirming dry-run output
nexus wp db clean mysite@local --no-dry-run
```

**5. Prefer `--json` in all scripted contexts.**

JSON output is stable across versions. Human-readable output formatting may change between releases.

---

## Troubleshooting

**"Could not read GraphQL connection info"** — Local is running but the addon has not written its connection file yet. Wait a few seconds for the addon to finish loading, then retry.

**Commands hang indefinitely** — The CLI connects to Local's internal GraphQL server. If Local is unresponsive (spinning beachball, stuck on a site operation), the CLI will block until its timeout expires. Force-quit Local and reopen it.

**`nexus doctor` shows all checks as "skip"** — Local is not running. Open the Local app first.

---

## Next Steps

- [Command Reference](./commands.md) — full command tree
- [Local Site Management](./local-sites.md) — common site operations
- [WP-CLI Commands](./wp-cli.md) — run WordPress commands on sites
