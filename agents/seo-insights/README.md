# seo-insights

> Content strategy agent — analyzes your WordPress site's content structure,
> topic clusters, traffic quality, and demand gaps to surface SEO opportunities.

## How It Works

Seo-insights runs weekly (Mondays at 7 AM) and on WPE sync events. Each run
produces a Site Content Report for the target site.

For WPE sites, the agent creates a temporary Local sandbox, pulls the site
from WPE (files + database), starts the sandbox, and triggers a reindex so
the Nexus content index is populated. Analysis runs against the sandbox;
the sandbox is cleaned up automatically.

**Content analysis** reads the Nexus content index (no PHP execution required
for indexed sites) and computes two signals: orphaned posts (posts with no
inbound internal links — invisible to crawlers following link graphs) and
stale posts (not updated in over a year).

**Topical map** calls `get_all_site_documents` with embeddings enabled and
runs k-means clustering (k=8) on the document vectors. Each cluster is labeled
by its centroid's nearest post title. This shows which semantic topic areas
the site's content concentrates in and reveals gaps.

**Traffic Intelligence** fetches 30 days of access log aggregates from
log-processor and computes: human traffic percentage, top AI crawlers by hit
count, 404 demand signals (content-like 404s = topics users want but the site
doesn't have), referral source mix, and failed auth probe count (flagged for
sentinel review above 100).

For local sites linked to a WPE install, the agent resolves the WPE install
name via `local_wpe_link` before fetching log data, so Traffic Intelligence
works whether you run against the WPE install directly or the linked local site.

The agent also exposes on-demand contributed tools for deeper analysis: Google
Search Console demand coverage, cannibalization detection, intent
classification, and decay detection — all requiring a GSC connection.

## Data Sources

| Source | Required | Notes |
|--------|----------|-------|
| Nexus content index | Yes | Site must be indexed (or indexable) |
| Log Processor aggregates | Optional | Enables Traffic Intelligence section |
| Google Search Console | Optional | Enables T1 demand analysis tools |
| WPE SSH (for WPE sites) | Yes | Used to pull sandbox |

## Output

- **Findings** — orphaned-content (HIGH if >30% of posts), stale-content (LOW), thin-corpus (LOW if <10 posts), stale-index (MEDIUM)
- **Report** — Site Content Report: post count, orphan/stale breakdowns, Topical Map (8 clusters), Traffic Intelligence (when log data available), next steps
- **Log** — site resolution, index status, content analysis count, log resolution, topic clustering progress
- **State** — last report text (for retrieval); per-site cooldown key

## Setup

1. For Traffic Intelligence: configure log-processor for each site you want
   to analyze (connect_log_source → set_log_processing → sync_access_logs).
2. For demand analysis (T1 tools): connect Google Search Console via
   `connect_gsc` and select your property.
3. For WPE sites: ensure the install is accessible via WPE SSH (SSH key
   registered in WPE portal).

## Tips & Tricks

Run on the local site (e.g. "NitroPack Production") rather than the WPE
install name when you want to avoid creating a sandbox — the local site
is already indexed and running. The agent resolves the linked WPE install
name automatically for log data.

The orphaned-content finding is often the highest-leverage SEO fix: posts
with no inbound links receive zero internal PageRank. Add internal links
from high-authority posts to your most important orphaned content.

The topical map uses k=8 clusters by default. If your site is large (500+
posts) or very specialized, run `build_topic_map` on-demand with a higher
cluster count (12–15) for finer granularity.

404 demand signals in the Traffic Intelligence section are the fastest content
gaps to act on — real users are already searching for this content and landing
on your site with a 404. Prioritize these over GSC-derived gaps.

## FAQ

**Q: Why does the report show 0 posts analyzed?**  
A: The sandbox was created but not yet indexed. This is now handled
automatically (the agent triggers a reindex after the pull), but if the
sandbox was created before this fix, delete it in Local and re-run.

**Q: Traffic Intelligence is missing from the report.**  
A: Log-processor is not configured for this site, or logs have not been
synced yet. Run `log_storage_status` to check, then `sync_access_logs`.

**Q: Topical map labels seem arbitrary.**  
A: The cluster label is the title of the post nearest the cluster centroid —
not a generated label. It is the most representative post in that topic area,
which gives you an anchor, not a summary. Read the sample posts to understand
what the cluster covers.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Site is not running" warning | Local site not started | Start the site in Local before running |
| Sandbox pull fails | WPE SSH not configured | Register SSH key in the WPE portal |
| No Traffic Intelligence section | Log-processor not set up | Configure log-processor for this site |
| GSC tools return "not connected" | OAuth not completed | Run connect_gsc |
| Topical map skipped | Embeddings unavailable | Check index health; reindex the site |
