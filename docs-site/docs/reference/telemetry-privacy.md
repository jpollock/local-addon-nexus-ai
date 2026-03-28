# Telemetry & Privacy

Nexus AI collects anonymous usage data to understand which features are used, identify common errors, and guide product decisions. This page explains exactly what is and isn't collected, how to opt out, and how the data is protected.

---

## Opt-Out Model

Telemetry is **enabled by default** but you can opt out at any time. No account, login, or personal information is ever required or collected.

**Disable via CLI:**
```bash
nexus telemetry disable
```

**Disable via environment variable** (useful for CI/CD):
```bash
NEXUS_TELEMETRY=0 nexus ...
```

**Auto-disabled in CI environments** — Nexus AI detects `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `TRAVIS`, `CIRCLECI`, `BUILDKITE`, and `JENKINS_URL` and disables telemetry automatically.

**Re-enable:**
```bash
nexus telemetry enable
```

**Check current status:**
```bash
nexus telemetry status
```

---

## What Is Collected

### Tool Call Events
Recorded every time an MCP tool or CLI command is executed.

| Field | Example | Purpose |
|-------|---------|---------|
| `event_type` | `tool_call` | Event classification |
| `tool_name` | `wp_plugin_list` | Which feature is being used |
| `access_method` | `mcp` or `cli` | How it was invoked |
| `success` | `true` / `false` | Error rate tracking |
| `duration_ms` | `245` | Performance monitoring |
| `error_category` | `site_not_running` | Error pattern analysis |
| `timestamp` | ISO 8601 | Timing distribution |

### Health Check Events
Sent once per hour while Local is running.

| Field | Example | Purpose |
|-------|---------|---------|
| `event_type` | `health_check` | Event classification |
| `memory_mb` | `128.5` | Memory usage trends |
| `health_status` | `healthy` | System health signal |
| `active_sites` | `5` | Fleet size distribution |

### Identity Fields (on every event)
| Field | Example | Purpose |
|-------|---------|---------|
| `installation_id` | Random UUID | Group events per install |
| `session_id` | Random UUID | Group events per Local session |
| `addon_version` | `0.1.2` | Version adoption tracking |
| `os` | `darwin` | Platform breakdown |
| `node_version` | `v20.x` | Runtime compatibility |

---

## What Is Never Collected

- Site names, domains, or file paths
- WordPress content, posts, or page data
- Plugin names, theme names, or versions
- Arguments passed to tools
- Error messages or stack traces
- User identity, email, or account information
- API keys, tokens, or credentials
- WP Engine account details

### Permanently Excluded Tools
These tool categories are never transmitted, regardless of telemetry settings:

| Prefix | Reason |
|--------|--------|
| `wpe_*` | May reference WP Engine account identifiers |
| `wp_db_*` | Database operations may contain sensitive data |
| `wp_search_replace` | May contain site content |
| `wp_user_*` | User management operations |

---

## How It Works

### Installation Identity
On first run, Nexus AI generates two values and stores them in:
```
~/Library/Application Support/Local/nexus-ai/config.json
```

- **`installationId`** — a random UUID that identifies this installation. Never tied to you personally.
- **`secretKey`** — a random 32-byte value used to sign outgoing events (see Authentication below).

These are generated once and reused across sessions. They are not shared with any third party.

### Local Event Queue
Before transmitting, events are written to a local JSONL file:
```
~/Library/Application Support/Local/nexus-ai/telemetry/events.jsonl
```

This file is capped at 10,000 events (oldest are pruned when the limit is reached). You can inspect it, clear it with `nexus telemetry clear`, or delete it manually.

### Transmission
Events are sent individually to a Cloudflare Worker over HTTPS using fire-and-forget — transmission never blocks or delays addon operation. Failed transmissions are not retried.

**Endpoint:** `https://nexus-analytics.jeremy7746.workers.dev/v1/events`

### Request Authentication
Each request is signed with HMAC-SHA256 using the `secretKey` stored in `config.json`. This lets the server verify the event came from a legitimate Nexus AI installation without requiring any user account or login.

On first transmission, the secret key is sent to the server (via `X-Secret-Key` header) so it can be stored for future verification. Subsequent requests include only an `X-Signature` header — the key itself never travels over the wire again.

---

## Data Retention

Events are automatically deleted after **90 days**. The Cloudflare Worker runs a daily scheduled cleanup to enforce this.

Installations are retained as long as they have events within the 90-day window.

---

## What the Data Is Used For

- Identifying which tools are used most and least
- Measuring error rates and common failure patterns
- Tracking performance across platforms
- Understanding fleet size distribution
- Guiding feature prioritization

The data is never sold, shared with third parties, or used for advertising.

---

## Manage Your Data

```bash
# Check status
nexus telemetry status

# View queued events (local only)
# cat ~/Library/Application\ Support/Local/nexus-ai/telemetry/events.jsonl

# Clear local queue
nexus telemetry clear

# Disable permanently
nexus telemetry disable

# Full reset (new installation ID, disables telemetry)
nexus telemetry reset --confirm
```

To request deletion of server-side data associated with your `installationId`, open a GitHub issue at [github.com/jpollock/local-addon-nexus-ai](https://github.com/jpollock/local-addon-nexus-ai/issues) with the subject "Telemetry data deletion request" and include your `installationId` from `nexus telemetry status`.
