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
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { environmentEntityId, siteEntityId } from '../../../intelligence-host/provisionalEntity';

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
      } else {
        siteLabel = (transport.siteRef as { alias?: string }).alias ?? 'external host';
        observationSystem = 'live-recheck:external-ssh';
      }
      entityKey = siteLabel;
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
    // Prefer an existing twin entity whose site.core name matches (covers the
    // case where graph row ids differ from transport labels); fall back to
    // deriving from the transport's own key.
    let entityId = environmentEntityId(core.entities, entityKey);
    if (!core.twins.get(entityId, 'site.core') && core.twins.search('site.').length > 0) {
      const byName = core.twins
        .search('site.')
        .find((f) => ((f.value as { name?: string }).name ?? '').toLowerCase() === siteLabel.toLowerCase());
      if (byName) entityId = byName.entityId;
    }

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
        entity: { site: siteEntityId(core.entities, entityKey), environment: entityId },
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
        entity: { site: siteEntityId(core.entities, entityKey), environment: entityId },
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
