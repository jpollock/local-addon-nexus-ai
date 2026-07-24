# seo-insights

> Content strategy agent — analyzes your WordPress site's content structure,
> topic clusters, traffic quality, and demand gaps to surface SEO opportunities.

## How It Works

Seo-insights runs weekly (Mondays at 7 AM) and on WPE sync events. Each run
produces a Site Content Report for the target site.

**Target selection.** An event-driven run (UI site selector, or
`nexus agent run seo-insights --install <site>`) analyzes that one site. A
scheduled run with no site attached analyzes a watchlist if you set one — a
JSON array of site names in the `watchlist` state key — otherwise the five
largest Local sites by post count. WPE installs are skipped on the scheduled
path because each needs a sandbox pull, and several of those will not fit in
one run's time budget; analyze those via the site selector or a sync event.

A six-hour per-site cooldown prevents background WPE sync events from
re-analyzing the same site repeatedly.

For WPE sites, the agent creates a Local sandbox, pulls the site from WPE
(files + database), starts the sandbox, and triggers a reindex so the Nexus
content index is populated. Analysis runs against the sandbox.

**Content analysis** reads the Nexus content index (no PHP execution required
for indexed sites). The index stores content in ≤500-word chunks, so the agent
first groups chunks back into documents by post ID — mean-pooling their
embeddings and concatenating their text — before computing anything. Every
count in the report is per post, not per chunk.

It then computes two signals: orphaned posts (no inbound internal links —
invisible to crawlers following link graphs) and stale posts (not updated in
over a year, where the index carries a usable date).

**Topical map** calls `get_all_site_documents` with embeddings enabled, groups
chunks into documents, and runs k-means clustering on the pooled document
vectors. Each cluster is labeled with its distinguishing TF-IDF terms — terms
that are common inside the cluster and rare across the rest of the site.
Cluster cohesion (mean member-to-centroid similarity) is written to the run
log for tuning.

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
| Google Search Console | Optional | Enables demand analysis tools |
| WPE SSH (for WPE sites) | Yes | Used to pull sandbox |

## Output

- **Findings** — orphaned-content (HIGH if >30% of posts), stale-content (LOW),
  degraded-index-entries (LOW), thin-corpus (LOW if <10 posts), stale-index (MEDIUM)
- **Report** — Site Content Report: post count, orphan/stale breakdowns, Topical
  Map, Traffic Intelligence (when log data is available), Search Console status
- **Log** — site resolution, index status, content analysis counts, cluster
  cohesion, log resolution
- **State** — last report text; per-site cooldown timestamps; per-site GSC
  property bindings; per-property intent cache

## Setup

1. For Traffic Intelligence: configure log-processor for each site you want to
   analyze (`connect_log_source` → `sync_access_logs`).
2. For demand analysis: run `connect_gsc siteId="<site>"` to list your Search
   Console properties, then run it again with `propertyUrl` to bind one.
   **Bindings are per-site** — each site needs its own, so one site's property
   can never redirect another site's analysis.
3. For WPE sites: ensure the install is accessible via WPE SSH (SSH key
   registered in the WPE portal).

## Sandbox management

WPE analysis uses a sandbox named `seo-<install>`, reused across runs. The
agent does **not** delete sandboxes — `local_delete_site` is a tier-3
destructive operation and this agent runs at tier 2. Each sandbox holds a full
copy of that install's database, so remove any you no longer need from Local
directly. Reusing a stable name means repeat runs refresh one sandbox per
install rather than accumulating a new copy each time.

## Tips & Tricks

Run on the local site (e.g. "NitroPack Production") rather than the WPE install
name when you want to avoid creating a sandbox — the local site is already
indexed and running. The agent resolves the linked WPE install name
automatically for log data.

The orphaned-content finding is often the highest-leverage SEO fix: posts with
no inbound links receive zero internal PageRank. Add internal links from
high-authority posts to your most important orphaned content.

The topical map uses k=10 by default in the report. For a large site (500+
posts) or a very specialized one, run `build_topic_map` on demand with a higher
cluster count (12–15) for finer granularity, and check the cohesion values in
the log — consistently low cohesion means k is too small for the corpus.

404 demand signals in the Traffic Intelligence section are the fastest content
gaps to act on — real users are already asking for this content and hitting a
404. Prioritize these over Search Console–derived gaps.

## FAQ

**Q: Why does the report show 0 posts analyzed?**
A: The sandbox was created but not yet indexed. The agent triggers a reindex
after the pull and waits up to 90 seconds; a very large site may need longer.
Re-run once indexing has finished.

**Q: Traffic Intelligence is missing from the report.**
A: Log-processor is not configured for this site, or logs have not been synced
yet. Run `log_storage_status` to check, then `sync_access_logs`.

**Q: What is the difference between "striking distance" and "weak coverage" in
find_demand_gaps?**
A: Striking distance is queries where a page of yours already ranks 8–20 — the
fix is to improve that page. Weak coverage is queries ranking past page 1 where
semantic search finds no strong match on your site, meaning whatever ranks is
probably tangential — the fix is to write or substantially expand. Note that
every query Search Console reports has *some* ranking page, so neither category
means "no content at all."

**Q: Some intent classifications are marked (h). What does that mean?**
A: The model was unavailable for that batch and the query was classified by
keyword heuristics instead. The header reports how many rows this affected.
Re-run with `refresh=true` to reclassify.

**Q: Topical map labels seem off.**
A: Labels are the top TF-IDF terms for each cluster — terms common within the
cluster and rare elsewhere on the site. On a highly specialized site where
every post shares vocabulary, labels get less distinctive; raising the cluster
count usually helps.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Site is not running" warning | Local site not started | Start the site in Local before running |
| Sandbox pull fails | WPE SSH not configured | Register SSH key in the WPE portal |
| No Traffic Intelligence section | Log-processor not set up | Configure log-processor for this site |
| GSC tools say no property bound | Property not bound for that site | Run `connect_gsc siteId="<site>" propertyUrl="<url>"` |
| Topical map skipped | Embeddings unavailable | Check index health; reindex the site |
| Log warns "decoded to N dims" | Index embedding model changed | Reindex the site; report if it persists |
| Scheduled run does nothing | No watchlist and no Local sites with content | Set the `watchlist` state key, or run against a site directly |
