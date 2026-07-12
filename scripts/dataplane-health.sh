#!/usr/bin/env bash
# Data plane health check — vectors.db (sqlite-vec) + graph.db (site metadata)

set -euo pipefail

NEXUS_DIR="${1:-$HOME/Library/Application Support/Local/nexus-ai}"
VDB="$NEXUS_DIR/vectors.db"
GDB="$NEXUS_DIR/graph.db"

BOLD=$(tput bold 2>/dev/null || echo '')
RESET=$(tput sgr0 2>/dev/null || echo '')
RED=$(tput setaf 1 2>/dev/null || echo '')
GREEN=$(tput setaf 2 2>/dev/null || echo '')
YELLOW=$(tput setaf 3 2>/dev/null || echo '')
CYAN=$(tput setaf 6 2>/dev/null || echo '')

header() { echo; echo "${BOLD}${CYAN}══ $1 ══${RESET}"; }
ok()     { echo "  ${GREEN}✓${RESET}  $*"; }
warn()   { echo "  ${YELLOW}⚠${RESET}  $*"; }
err()    { echo "  ${RED}✗${RESET}  $*"; }
row()    { printf "  %-40s %s\n" "$1" "$2"; }

# ── File sizes ────────────────────────────────────────────────────────────────
header "File Sizes"

for f in "$VDB" "$GDB"; do
  if [[ -f "$f" ]]; then
    size=$(du -sh "$f" | cut -f1)
    base=$(basename "$f")
    wal_size=""
    if [[ -f "${f}-wal" ]]; then
      wal_bytes=$(stat -f%z "${f}-wal" 2>/dev/null || stat -c%s "${f}-wal" 2>/dev/null || echo 0)
      if (( wal_bytes > 1048576 )); then
        wal_size=" ${YELLOW}(WAL: $(du -sh "${f}-wal" | cut -f1) — consider checkpointing)${RESET}"
      fi
    fi
    ok "$base  $size$wal_size"
  else
    err "$f  NOT FOUND"
  fi
done

# ── vectors.db ────────────────────────────────────────────────────────────────
header "vectors.db — Indexed Sites"

if [[ ! -f "$VDB" ]]; then
  err "vectors.db not found — no sites indexed yet"
else
  # collect table names
  doc_tables=$(sqlite3 "$VDB" "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_docs' AND name NOT LIKE '%shadow%' ORDER BY name;")
  site_count=$(echo "$doc_tables" | grep -c . || true)

  if [[ -z "$doc_tables" ]]; then
    warn "No site tables found — indexing has not run yet"
  else
    echo "  ${BOLD}$site_count sites indexed${RESET}"
    echo
    printf "  %-36s %8s  %s\n" "Site ID" "Docs" "Schema"

    while IFS= read -r tbl; do
      [[ -z "$tbl" ]] && continue
      prefix="${tbl%_docs}"
      site_id="${prefix#site_}"

      docs=$(sqlite3 "$VDB" "SELECT COUNT(*) FROM \"$tbl\";")

      has_vec=$(sqlite3 "$VDB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${prefix}_vec';")
      has_fts=$(sqlite3 "$VDB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${prefix}_fts';")

      if [[ "$has_vec" == "1" && "$has_fts" == "1" ]]; then
        schema_ok="${GREEN}docs+vec+fts${RESET}"
      elif [[ "$has_vec" == "1" ]]; then
        schema_ok="${YELLOW}docs+vec (no fts)${RESET}"
      elif [[ "$has_fts" == "1" ]]; then
        schema_ok="${YELLOW}docs+fts (no vec)${RESET}"
      else
        schema_ok="${RED}docs only — INCOMPLETE${RESET}"
      fi

      if (( docs == 0 )); then
        doc_col="${YELLOW}$docs${RESET}"
      else
        doc_col="$docs"
      fi

      printf "  %-36s %8s  %b\n" "$site_id" "$doc_col" "$schema_ok"
    done <<< "$doc_tables"

    total=$(sqlite3 "$VDB" "
      SELECT SUM(cnt) FROM (
        $(echo "$doc_tables" | while IFS= read -r t; do [[ -n "$t" ]] && echo "SELECT COUNT(*) AS cnt FROM \"$t\" UNION ALL"; done | sed '$ s/ UNION ALL//')
      );")
    echo
    printf "  %-36s %8s\n" "TOTAL DOCS" "$total"
  fi
fi

# ── graph.db ──────────────────────────────────────────────────────────────────
header "graph.db — Site Metadata"

if [[ ! -f "$GDB" ]]; then
  err "graph.db not found"
else
  local_rows=$(sqlite3 -separator $'\t' "$GDB" "
    SELECT
      name,
      COALESCE(wp_version, '?') AS wp,
      COALESCE(php_version, '?') AS php,
      CASE WHEN is_active=1 THEN 'running' ELSE 'halted' END AS status,
      COALESCE(post_count, 0) AS posts,
      COALESCE(user_count, 0) AS users
    FROM sites WHERE source='local' ORDER BY name;")

  wpe_counts=$(sqlite3 -separator $'\t' "$GDB" "
    SELECT COUNT(*),
      SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END)
    FROM sites WHERE source='wpe';")

  if [[ -z "$local_rows" ]]; then
    warn "No local sites in graph.db — try running 'nexus doctor'"
  else
    printf "  %-30s %-8s %-7s %-9s %-6s %s\n" "Local Site" "WP" "PHP" "Status" "Posts" "Users"
    printf "  %-30s %-8s %-7s %-9s %-6s %s\n" "----------" "--" "---" "------" "-----" "-----"
    while IFS=$'\t' read -r name wp php status posts users; do
      [[ -z "$name" ]] && continue
      if [[ "$status" == "running" ]]; then
        status_col="${GREEN}$status${RESET}"
      else
        status_col="$status"
      fi
      printf "  %-30s %-8s %-7s %-9b %-6s %s\n" "$name" "$wp" "$php" "$status_col" "$posts" "$users"
    done <<< "$local_rows"
  fi

  if [[ -n "$wpe_counts" ]]; then
    IFS=$'\t' read -r wpe_total wpe_active <<< "$wpe_counts"
    echo
    ok "WPE installs in graph.db: $wpe_total total  ($wpe_active active)"
  fi
fi

# ── graph.db — Plugin coverage ────────────────────────────────────────────────
header "graph.db — Plugin Coverage (local sites)"

if [[ -f "$GDB" ]]; then
  sqlite3 -separator $'\t' "$GDB" "
    SELECT s.name, COUNT(p.id) AS total, COALESCE(SUM(p.is_active), 0) AS active
    FROM sites s
    LEFT JOIN plugins p ON p.site_id = s.id
    WHERE s.source = 'local'
    GROUP BY s.id
    ORDER BY total DESC;" | while IFS=$'\t' read -r name total active; do
      [[ -z "$name" ]] && continue
      if [[ "$total" == "0" ]]; then
        printf "  %-30s ${YELLOW}0 plugins (no data — run nexus reindex or nexus doctor)${RESET}\n" "$name"
      else
        printf "  %-30s %s plugins  (%s active)\n" "$name" "$total" "$active"
      fi
  done

  wpe_plugin_summary=$(sqlite3 "$GDB" "
    SELECT COUNT(DISTINCT s.id) AS sites_with_plugins,
           COUNT(p.id) AS total_plugins
    FROM sites s
    JOIN plugins p ON p.site_id = s.id
    WHERE s.source = 'wpe';")
  IFS='|' read -r wpe_sites_p wpe_total_p <<< "$wpe_plugin_summary"
  echo
  ok "WPE plugin data: $wpe_total_p plugins across $wpe_sites_p installs (SSH-synced only)"
fi

# ── graph.db — User coverage ──────────────────────────────────────────────────
header "graph.db — User Coverage"

if [[ -f "$GDB" ]]; then
  has_users=$(sqlite3 "$GDB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users';")
  if [[ "$has_users" == "0" ]]; then
    warn "users table not found — older graph.db schema"
  else
    # Local site user counts come from sites.user_count (aggregate, shown in Site Metadata above)
    local_user_total=$(sqlite3 "$GDB" "SELECT COALESCE(SUM(user_count),0) FROM sites WHERE source='local';")
    local_sites_with_users=$(sqlite3 "$GDB" "SELECT COUNT(*) FROM sites WHERE source='local' AND user_count > 0;")
    ok "Local sites: $local_user_total users across $local_sites_with_users sites (counts shown in Site Metadata above)"

    # WPE: individual user records from SSH-synced installs
    wpe_stats=$(sqlite3 -separator $'\t' "$GDB" "
      SELECT COUNT(*),
             COUNT(DISTINCT u.site_id),
             SUM(CASE WHEN u.roles LIKE '%administrator%' THEN 1 ELSE 0 END)
      FROM users u
      JOIN sites s ON s.id = u.site_id WHERE s.source='wpe';")
    IFS=$'\t' read -r wpe_users wpe_sites wpe_admins <<< "$wpe_stats"
    ok "WPE installs: $wpe_users users across $wpe_sites SSH-synced installs  ($wpe_admins admins)"

    # Flag any WPE admin accounts shared across many installs
    shared_admins=$(sqlite3 "$GDB" "
      SELECT email, COUNT(DISTINCT site_id) AS cnt
      FROM users u
      JOIN sites s ON s.id = u.site_id
      WHERE s.source='wpe' AND u.roles LIKE '%administrator%'
      GROUP BY email HAVING cnt > 5
      ORDER BY cnt DESC LIMIT 5;")
    if [[ -n "$shared_admins" ]]; then
      echo
      echo "  Admins with access to 5+ WPE installs:"
      while IFS='|' read -r email cnt; do
        [[ -z "$email" ]] && continue
        printf "  %-40s %s installs\n" "$email" "$cnt"
      done <<< "$shared_admins"
    fi
  fi
fi

# ── Stale sites ───────────────────────────────────────────────────────────────
header "graph.db — Stale Local Sites (not synced in 7+ days)"

if [[ -f "$GDB" ]]; then
  stale=$(sqlite3 -separator $'\t' "$GDB" "
    SELECT name,
      CASE
        WHEN last_sync_at IS NULL THEN 'never synced'
        ELSE datetime(last_sync_at / 1000, 'unixepoch') || ' UTC'
      END AS last_seen
    FROM sites
    WHERE source = 'local'
      AND (last_sync_at IS NULL
           OR last_sync_at / 1000 < CAST(strftime('%s','now','-7 days') AS INTEGER))
    ORDER BY last_sync_at;")

  if [[ -z "$stale" ]]; then
    ok "All local sites synced within the last 7 days"
  else
    while IFS=$'\t' read -r name last_seen; do
      [[ -z "$name" ]] && continue
      warn "$name — last synced: $last_seen"
    done <<< "$stale"
  fi
fi

# ── Cross-check: graph vs vectors ─────────────────────────────────────────────
header "Cross-check: graph.db sites vs vectors.db"

if [[ -f "$GDB" && -f "$VDB" ]]; then
  # For "missing" check: only local sites are expected in vectors.db
  local_ids=$(sqlite3 "$GDB" "SELECT id FROM sites WHERE source='local' ORDER BY id;")
  # For orphan check: any site in graph.db (local OR wpe) is a valid owner
  all_graph_ids=$(sqlite3 "$GDB" "SELECT id FROM sites ORDER BY id;")
  vec_ids=$(sqlite3 "$VDB" "
    SELECT replace(replace(name,'site_',''),'_docs','')
    FROM sqlite_master WHERE type='table' AND name LIKE 'site_%_docs'
    ORDER BY name;" | sed 's/_docs$//')

  # Local sites in graph but not indexed in vectors
  missing_in_vec=$(comm -23 <(echo "$local_ids" | sort) <(echo "$vec_ids" | sort))
  if [[ -n "$missing_in_vec" ]]; then
    echo "  Local sites not yet indexed in vectors.db:"
    while IFS= read -r id; do
      [[ -z "$id" ]] && continue
      name=$(sqlite3 "$GDB" "SELECT name FROM sites WHERE id='$id';")
      warn "$name ($id)"
    done <<< "$missing_in_vec"
  else
    ok "All local sites have vector indexes"
  fi

  # Sites in vectors but not in graph at all (truly orphaned)
  orphan_in_vec=$(comm -13 <(echo "$all_graph_ids" | sort) <(echo "$vec_ids" | sort))
  if [[ -n "$orphan_in_vec" ]]; then
    echo "  In vectors.db but not in graph.db (orphaned indexes):"
    while IFS= read -r id; do
      [[ -z "$id" ]] && continue
      warn "site_${id} — orphaned vector tables"
    done <<< "$orphan_in_vec"
  else
    ok "No orphaned vector indexes"
  fi

  # Count WPE sites indexed
  wpe_indexed=$(comm -12 \
    <(sqlite3 "$GDB" "SELECT id FROM sites WHERE source='wpe' ORDER BY id;") \
    <(echo "$vec_ids" | sort) | wc -l | tr -d ' ')
  ok "WPE installs indexed in vectors.db: $wpe_indexed"
fi

echo
echo "${BOLD}Done.${RESET}"
