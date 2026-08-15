/**
 * Ledger schema migrations. Append new statements; never edit shipped ones.
 * Version = index + 1, tracked in _meta.schema_version.
 */
export const MIGRATIONS: string[] = [
  // v1 — events spine, fold cursors, twin facts
  `
  CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    recorded_at  TEXT NOT NULL,
    observed_at  TEXT NOT NULL,
    topic        TEXT NOT NULL,
    schema       TEXT NOT NULL,
    entity       TEXT NOT NULL,  -- JSON: role -> entity id
    actor        TEXT NOT NULL,  -- JSON: { id, kind, via }
    source       TEXT NOT NULL,  -- JSON: { class, system, trust }
    access       TEXT NOT NULL,  -- JSON: { tenant, client?, sensitivity? }  (ADR-11)
    correlation  TEXT,
    causation    TEXT,
    payload      TEXT NOT NULL   -- JSON, validated against \`schema\` upstream
  );
  CREATE INDEX IF NOT EXISTS idx_events_topic       ON events (topic, id);
  CREATE INDEX IF NOT EXISTS idx_events_correlation ON events (correlation) WHERE correlation IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_events_recorded    ON events (recorded_at);

  CREATE TABLE IF NOT EXISTS fold_cursors (
    fold          TEXT PRIMARY KEY,
    last_event_id TEXT NOT NULL
  );

  -- Twins are materialized views over state.* events — rebuildable, a cache by
  -- construction (architecture doc §4.3).
  CREATE TABLE IF NOT EXISTS twin_facts (
    entity_id    TEXT NOT NULL,
    fact         TEXT NOT NULL,   -- 'wp.version' | 'php.version' | 'plugin:woocommerce' | ...
    value        TEXT NOT NULL,   -- JSON
    observed_at  TEXT NOT NULL,
    source_trust TEXT NOT NULL,
    event_id     TEXT NOT NULL,   -- provenance pointer back into the ledger
    PRIMARY KEY (entity_id, fact)
  );
  `,
  // v2 — entity service v0 (architecture doc §5): entities + aliases.
  // Identity is an assertion with provenance, never a silent inference.
  `
  CREATE TABLE IF NOT EXISTS entities (
    id         TEXT PRIMARY KEY,      -- ent_<type>_<ULID-charset>
    type       TEXT NOT NULL,         -- 'site' | 'env' | 'client' | 'domain' | ...
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entity_aliases (
    entity_id      TEXT NOT NULL,
    namespace      TEXT NOT NULL,     -- 'local.site_id' | 'wpe.install_name' | 'domain' | 'user.label'
    value          TEXT NOT NULL,
    confidence     REAL NOT NULL,     -- 1.0 explicit; <1.0 heuristic
    established_by TEXT NOT NULL,     -- 'user_link' | 'pull_lineage' | 'domain_match' | 'name_heuristic' | 'derivation'
    created_at     TEXT NOT NULL,
    UNIQUE (namespace, value)
  );
  CREATE INDEX IF NOT EXISTS idx_aliases_entity ON entity_aliases (entity_id);
  CREATE TABLE IF NOT EXISTS entity_links (
    from_entity    TEXT NOT NULL,     -- e.g. the logical site
    to_entity      TEXT NOT NULL,     -- e.g. an environment of it
    kind           TEXT NOT NULL,     -- 'has_environment' | 'belongs_to_client' | ...
    confidence     REAL NOT NULL,
    established_by TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    PRIMARY KEY (from_entity, to_entity, kind)
  );
  `,
];
