# log-processor

> Streams WP Engine Apache-style access logs from S3, classifies every
> request, and folds the results into compact daily aggregates that
> security-sentinel and seo-insights consume.

## How It Works

Log-processor is a pure data pipeline — no LLM is involved at any stage.
On each nightly run (3 AM UTC) it loops through every enabled site, fetches
the access log files from S3 for any dates not yet processed, and streams
them line-by-line through a deterministic classifier. Raw bytes are never
written to disk; only the summarised aggregate for each site-day is stored.

The classifier assigns every request to one of nine traffic classes
(human_plausible, search_bot, ai_training, ai_retrieval, seo_tool,
monitoring, platform, attack, other_bot) using a priority-ordered set of
UA regex patterns and behavioral signals. Auth attacks, probe paths, and
enumeration attempts are detected by URL pattern and HTTP method alone —
UA spoofing does not affect these signals. The status code of every auth
attempt is recorded, allowing consumers (sentinel) to separate successful
logins (302) from failed attempts (200) and blocked requests (403/429).

The daily aggregate (`DayAggregate`) is the durable output: roughly 5–10 KB
per site-day, retained for 180 days by default. It powers the Traffic
Intelligence section in seo-insights reports and the log-backed checks in
security-sentinel sweeps.

## Data Sources

| Source | Required | Notes |
|--------|----------|-------|
| WP Engine S3 access logs | Yes | Configure via connect_log_source |
| AWS credentials | Yes | IAM key with s3:GetObject + s3:ListBucket on log bucket |

## Output

- **Findings** — none; log-processor produces no Approvals findings
- **Report** — none; it is a data infrastructure agent, not an analysis agent
- **Log** — per-site sync progress: date range, file count, request count, lines skipped
- **State** — `logs.sqlite` in the agent directory: sources table, ledger (processed dates), aggregates

## Setup

1. Obtain your WP Engine S3 log bucket name and prefix from the WPE portal
   (Account → Log Forwarding or contact WPE support).
2. Add your AWS IAM credentials in Nexus Preferences → Connected Accounts → AWS S3.
3. For each WPE install you want to monitor, run:
   `connect_log_source` → `set_log_processing enabled=true` → `sync_access_logs`
4. The nightly cron will keep new dates ingested automatically.

## Tips & Tricks

Use `log_storage_status` to confirm which sites are connected and how many
aggregate days are stored before running seo-insights or sentinel.

Sync a backfill with a generous `budgetMB` (512 is the default) on the first
run. If the date range is large, re-run `sync_access_logs` multiple times —
the ledger prevents duplicate processing.

`fetch_log_window` is a two-phase forensic tool: call it without `confirm`
first to see the cost estimate, then with `confirm: true` to stream filtered
raw lines. Use it when sentinel flags a specific IP or path and you need the
actual log evidence.

The taxonomy version is embedded in every aggregate (`taxonomyVersion`).
If the classifier is updated in a future release, older aggregates are still
readable but may not include new fields.

## FAQ

**Q: sync_access_logs succeeded but log_storage_status shows 0 days. Why?**  
A: Run `connect_log_source` first — `sync_access_logs` requires a source binding.
If you see "⚠ No log source bound", that is the issue.

**Q: Why does the nightly cron skip some days?**  
A: Days already in the ledger are skipped (idempotent). Missing days appear
in `get_log_aggregates` output as `missingDays` with the exact sync command
to fill them.

**Q: The S3 prefix looks right but no apachestyle files are found.**  
A: WPE log file names include the string "apachestyle". Check that log
forwarding is enabled for the install in the WPE portal and that the prefix
includes the trailing slash if logs are in a subfolder.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "⚠ No log source bound" | connect_log_source not run | Run connect_log_source with bucket and prefix |
| "AWS credentials are no longer valid" | IAM key rotated or revoked | Re-enter credentials in Preferences → AWS S3 |
| sync_access_logs succeeds but 0 requests found | Wrong S3 prefix | Verify prefix in WPE portal; check for trailing slash |
| Large sync budget exhausted, dates deferred | Log volume exceeds budget | Re-run with higher budgetMB, or sync date-by-date |
| Traffic Intelligence missing in seo-insights | Site not connected or no days synced | Run log_storage_status, then connect and sync |
