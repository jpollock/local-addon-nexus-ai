/**
 * verify_site_live — the live re-check path (Milestone 1, pull-live gate).
 *
 * The twin-backed readers disclose staleness and offer "I can run a live
 * check." This tool IS that check: re-observe a site's plugins live through
 * the real transport (Local bridge, WPE SSH, external SSH — same permission
 * gates as every WP-CLI tool), compare against the ledger's cached
 * observations, emit fresh envelopes, update the twins, and report the delta.
 *
 * Model mapping: twins are for browsing; acting requires live pull (B-01).
 * Every stale flag now has a one-call remedy, and the remedy itself feeds
 * the ledger — checking freshness makes the system fresher.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveTransport } from '../../../transport';
import type { SiteRef } from '../../../transport/types';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import {
  environmentEntityId,
  provisionalEnvironmentId,
  siteEntityId,
} from '../../../intelligence-host/provisionalEntity';

interface LivePlugin {
  slug: string;
  version: string;
  active: boolean;
}

interface Delta {
  slug: string;
  kind: 'changed' | 'new' | 'missing-live';
  cached?: { version?: string; active?: boolean; age?: string };
  live?: { version: string; active: boolean };
}

export const verifySiteLiveHandler: McpToolHandler = {
  definition: {
    name: 'verify_site_live',
    namespace: 'fleet',
    description:
      'Re-observe a site live and reconcile the intelligence ledger: fetches the current plugin state ' +
      'through the real transport (local site, WPE install via SSH, or external SSH host), compares it ' +
      'against the cached twin observations, records fresh provenance-stamped observations, and reports ' +
      'exactly what changed. Use when other tools flag cached data as stale, or before acting on any ' +
      'cached fact (e.g. before bulk updates). This is the "run a live check" every stale flag refers to.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote verification via SSH' },
        ssh_target: {
          type: 'string',
          description: "External SSH host, as ssh:<alias>@<production|staging|development>.",
        },
        wp_path: { type: 'string', description: 'Absolute WordPress root on an external host (usually unnecessary).' },
      },
    },
    isAvailable: (services) => !!services.localServices,
    annotations: { readOnlyHint: true }, // observes and records; never mutates the site
  },

  async execute(args, services): Promise<McpToolResult> {
    const core = getIntelligenceCore();
    if (!core) {
      return error('Intelligence ledger unavailable — live verification has nowhere to record. Legacy tools still work.');
    }

    const transport = await resolveTransport(args, services, 'wpcli_read');
    if ('content' in transport) return transport;

    // ── 1. Fetch live plugin state through the real transport ─────────────
    let live: LivePlugin[];
    let siteLabel: string;
    let observationSystem: string;
    let entityKey: string; // the id the producers derive entities from

    if (transport.kind === 'wpe-ssh' || transport.kind === 'external-ssh') {
      const result = await transport.runWpCli(['plugin', 'list', '--format=json']);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      let rows: Array<{ name: string; version?: string; status?: string }>;
      try {
        rows = JSON.parse(result.stdout || '[]');
      } catch {
        return error('Could not parse remote plugin list output.');
      }
      // WP-CLI's `name` column is the plugin slug.
      live = rows.map((r) => ({
        slug: String(r.name),
        version: String(r.version ?? ''),
        active: r.status === 'active' || r.status === 'active-network',
      }));
      if (transport.siteRef.kind === 'wpe') {
        siteLabel = transport.siteRef.installName;
        observationSystem = 'live-recheck:wpe-ssh';
        entityKey = siteLabel;
      } else {
        siteLabel = (transport.siteRef as { alias?: string }).alias ?? 'external host';
        observationSystem = 'live-recheck:external-ssh';
        // An external row's graph id IS `ssh:<alias>/<site>`
        // (externalSiteStore.externalSiteId) — the key every producer derives
        // its entity from. The bare `ssh:<alias>@<env>` form names a connection
        // rather than a site, so there is no row id to recover; the alias then
        // stands in, exactly as it did before WP-16.
        entityKey = externalRowId(args) ?? siteLabel;
      }
    } else {
      const siteId = transport.siteRef.kind === 'local' ? transport.siteRef.siteId : '';
      const status = services.localServices!.getSiteStatus(siteId);
      if (status !== 'running') {
        return error(
          `Site is ${status ?? 'not running'} — a live check needs the site running. ` +
          `Cached twin data remains available (with its staleness disclosed) through the fleet tools.`
        );
      }
      const plugins = await services.localServices!.getPlugins(siteId);
      live = plugins.map((p: { slug?: string; name: string; version?: string; status?: string }) => ({
        slug: String(p.slug ?? p.name).toLowerCase().replace(/\s+/g, '-'),
        version: String(p.version ?? ''),
        active: p.status === 'active',
      }));
      siteLabel = transport.siteRef.kind === 'local' ? transport.siteRef.siteName : siteId;
      observationSystem = 'live-recheck:local';
      entityKey = siteId;
    }

    // ── 2. Resolve the entity the twins are keyed by ──────────────────────
    // Identity first, derivation last (WP-16, audit A7). A remote target
    // arrives as a NAME; the ledger keys that site's history by the id the
    // producers derive, which is the graph row id. Deriving an entity from the
    // name is a WRITE that registers a second, divergent entity for a site the
    // layer already knows — splitting its history silently.
    const identity = resolveIdentity(core, transport.siteRef, entityKey, siteLabel);
    const entityId = identity.envId;
    // The logical Site is stamped only when the producers' own key is in hand
    // (audit A7: a name-derived `site` splits history exactly as a name-derived
    // environment does). A WPE install resolved through its alias does not
    // yield the graph row id, and there is no env→Site traversal in the entity
    // service yet, so the role is OMITTED rather than fabricated — absent is
    // honest, wrong is not. The env→Site reverse lookup is WP-14/WP-15 work.
    const siteRole = identity.siteKey ? siteEntityId(core.entities, identity.siteKey) : undefined;
    const entityBlock: Record<string, string> = {
      ...(siteRole ? { site: siteRole } : {}),
      environment: entityId,
    };

    // ── 3. Diff live state against cached twins (BEFORE recording) ────────
    const now = Date.now();
    const cachedFacts = core.twins.forEntity(entityId).filter((f) => f.fact.startsWith('plugin:'));
    const cachedBySlug = new Map(cachedFacts.map((f) => [f.fact.slice('plugin:'.length), f]));
    const deltas: Delta[] = [];
    let unchanged = 0;

    for (const p of live) {
      const cached = cachedBySlug.get(p.slug);
      const liveValue = { version: p.version, active: p.active };
      if (!cached) {
        deltas.push({ slug: p.slug, kind: 'new', live: liveValue });
      } else {
        const cachedValue = cached.value as { version?: string; active?: boolean };
        if (cachedValue.version !== p.version || cachedValue.active !== p.active) {
          deltas.push({
            slug: p.slug,
            kind: 'changed',
            cached: { ...cachedValue, age: fmtAge(now - Date.parse(cached.observedAt)) },
            live: liveValue,
          });
        } else {
          unchanged++;
        }
        cachedBySlug.delete(p.slug);
      }
    }
    for (const [slug, fact] of cachedBySlug) {
      const cachedValue = fact.value as { version?: string; active?: boolean; removed?: boolean };
      if (cachedValue.removed) continue;
      deltas.push({
        slug,
        kind: 'missing-live',
        cached: { ...cachedValue, age: fmtAge(now - Date.parse(fact.observedAt)) },
      });
    }

    // ── 4. Record: every live fact becomes a fresh observation ────────────
    const observedAt = new Date().toISOString();
    for (const p of live) {
      core.emitter.emit({
        observed_at: observedAt,
        topic: 'state.plugin.observed',
        schema: 'plugin.observed/1',
        entity: entityBlock,
        actor: { id: 'act_live_recheck', kind: 'system' },
        source: { class: 'platform', system: observationSystem, trust: 'observed' },
        payload: { slug: p.slug, version: p.version, active: p.active },
      });
    }
    for (const d of deltas) {
      if (d.kind !== 'missing-live') continue;
      core.emitter.emit({
        observed_at: observedAt,
        topic: 'state.plugin.removed',
        schema: 'plugin.observed/1',
        entity: entityBlock,
        actor: { id: 'act_live_recheck', kind: 'system' },
        source: { class: 'platform', system: observationSystem, trust: 'observed' },
        payload: { slug: d.slug, version: d.cached?.version ?? '', active: false },
      });
    }
    core.scheduleFolds();

    // ── 5. Report the reconciliation ──────────────────────────────────────
    const lines: string[] = [`## Live verification — ${siteLabel}`, ''];
    lines.push(
      `Observed ${live.length} plugins live (${observationSystem.split(':')[1]}). ` +
      `${unchanged} matched the cached twins exactly.`
    );
    lines.push('');

    if (deltas.length === 0) {
      lines.push('✓ No drift: the ledger\'s picture of this site was accurate. All observations re-stamped as of now.');
    } else {
      lines.push(`### ${deltas.length} difference(s) vs cached observations`);
      lines.push('');
      lines.push('| Plugin | Cached | Live | Note |');
      lines.push('|--------|--------|------|------|');
      for (const d of deltas) {
        const cachedCol = d.cached
          ? `v${d.cached.version ?? '?'} ${d.cached.active ? 'active' : 'inactive'} (${d.cached.age})`
          : '— not in ledger —';
        const liveCol = d.live ? `v${d.live.version} ${d.live.active ? 'active' : 'inactive'}` : '— not installed —';
        const note = d.kind === 'new' ? 'first observation' : d.kind === 'missing-live' ? 'recorded as removed' : 'twin updated';
        lines.push(`| ${d.slug} | ${cachedCol} | ${liveCol} | ${note} |`);
      }
    }
    lines.push('');
    lines.push(
      `Recorded ${live.length + deltas.filter((d) => d.kind === 'missing-live').length} fresh observations ` +
      `(trust: observed, via ${observationSystem}). Twins are current as of this check.`
    );

    return ok(lines.join('\n'));
  },
};

/**
 * The graph row id behind an `ssh:<alias>/<site>[@<env>]` target, or undefined
 * for the bare connection form. Parsing only — nothing is registered here.
 */
function externalRowId(args: Record<string, unknown>): string | undefined {
  const target = typeof args.ssh_target === 'string' ? args.ssh_target.trim() : '';
  if (!target.startsWith('ssh:')) return undefined;
  const withoutEnv = target.split('@')[0];
  return withoutEnv.includes('/') ? withoutEnv : undefined;
}

/**
 * The handles a target may legitimately be known by, in evidence order.
 *
 * These are the namespaces the reconciliation's identity table sanctions:
 * `wpe.install_name` / `wpe.install_id` for WP Engine installs (written by
 * `siteLinkMirror`), and `graph.site_row` / `local.site_id` for a graph row —
 * the latter meaning "graph sites.id", NOT "a Local site" (audit A1 declared
 * the namespace opaque legacy). An install NAME is not a `local.site_id`, and
 * writing it as one is the defect this ordering removes.
 */
function sanctionedHandles(siteRef: SiteRef, entityKey: string): Array<[string, string]> {
  if (siteRef.kind === 'wpe') {
    // The same value is tried as a name and as an id: callers address installs
    // both ways (see the WPE install-pattern pitfall — `remote_install_id`
    // holds a name OR a UUID).
    return [
      ['wpe.install_name', siteRef.installName],
      ['wpe.install_id', siteRef.installName],
    ];
  }
  if (siteRef.kind === 'external') {
    return entityKey.startsWith('ssh:') && entityKey.includes('/')
      ? [['graph.site_row', entityKey], ['local.site_id', entityKey]]
      : [];
  }
  return [['local.site_id', entityKey]];
}

interface ResolvedIdentity {
  /** The environment entity this check's observations belong to. */
  envId: string;
  /**
   * The producers' own key for this site (graph `sites.id`), when it is in
   * hand — the value `site`/`environment` ids are derived from. Absent means
   * the logical Site could not be established without inventing one.
   */
  siteKey?: string;
}

/**
 * Resolve first, name-match second, derive last (audit A7).
 *
 * Resolution is a READ: it registers nothing, so a target the ledger already
 * knows can never gain a second entity. Only the terminal derivation writes,
 * and it runs only when no sanctioned handle and no twin name matches — i.e.
 * for a site the layer has genuinely never seen, where the pre-WP-16 id is
 * still the right one to keep using.
 */
function resolveIdentity(
  core: NonNullable<ReturnType<typeof getIntelligenceCore>>,
  siteRef: SiteRef,
  entityKey: string,
  siteLabel: string
): ResolvedIdentity {
  for (const [namespace, value] of sanctionedHandles(siteRef, entityKey)) {
    const envId = resolveEnvEntity(core.entities, namespace, value);
    // `local.site_id` IS the producers' derivation key, so resolving through
    // it also yields the Site key; an install alias does not.
    if (envId) return { envId, ...(namespace === 'local.site_id' ? { siteKey: value } : {}) };
  }

  // Nothing sanctioned matched. From here the pre-WP-16 preference is kept
  // verbatim — a twin whose site.core name matches the transport's label, but
  // only when the derived entity has no site.core of its own. It is computed
  // through the PURE derivation, so the losing branch never registers an
  // entity: `provisionalEnvironmentId` and `environmentEntityId` produce the
  // same id by construction, one writing and one not.
  const derivedId = provisionalEnvironmentId(entityKey);
  if (!core.twins.get(derivedId, 'site.core') && core.twins.search('site.').length > 0) {
    const byName = core.twins
      .search('site.')
      .find((f) => ((f.value as { name?: string }).name ?? '').toLowerCase() === siteLabel.toLowerCase());
    if (byName) return { envId: byName.entityId };
  }

  return { envId: environmentEntityId(core.entities, entityKey), siteKey: entityKey };
}

/** Highest-confidence ENV entity carrying this alias, or nothing. */
function resolveEnvEntity(
  entities: NonNullable<ReturnType<typeof getIntelligenceCore>>['entities'],
  namespace: string,
  value: string
): string | undefined {
  if (!entities || !value) return undefined;
  try {
    return entities
      .resolve(value, namespace)
      .filter((c) => c.type === 'env')
      .sort((a, b) => b.matchedAlias.confidence - a.matchedAlias.confidence)[0]?.entityId;
  } catch {
    return undefined; // a faulty entity service must never break a live check
  }
}

function fmtAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < 3600_000) return `${Math.max(1, Math.round(ms / 60000))}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
