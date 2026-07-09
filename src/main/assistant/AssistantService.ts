import type { AssistantContext, AssistantFilter, QueryPlan, FleetInsight, AssistantResponse } from '../../common/types';
import { isPhpEol, getPhpEolDate, PLUGIN_CATEGORIES } from './wordpress-knowledge';

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

export function buildFleetContext(
  siteData: any,
  metadataCache: any,
  indexRegistry: any,
  graphService: any,
): AssistantContext {
  const allSites = Object.values(siteData.getSites()) as any[];
  const allEntries = (indexRegistry.listAll() as any[]);
  const indexedSet = new Set(allEntries.filter((e: any) => e.state === 'indexed' || e.state === 'stale').map((e: any) => e.siteId));

  // Count WPE installs from graph.db
  let wpeSiteCount = 0;
  try {
    const db = graphService?.getDb?.();
    if (db) {
      const row = db.prepare("SELECT COUNT(*) as count FROM sites WHERE source != 'local' AND is_active = 1").get() as any;
      wpeSiteCount = row?.count ?? 0;
    }
  } catch { /* graph.db unavailable */ }

  // Build proactive insights
  const fleetInsights: FleetInsight[] = [];

  // PHP EOL insight
  const eolSites = allSites.filter((s: any) => {
    const meta = metadataCache?.get?.(s.id);
    const php = s.phpVersion ?? meta?.phpVersion;
    return php && isPhpEol(php);
  });

  if (eolSites.length > 0) {
    const versions = [...new Set(
      eolSites.map((s: any) => {
        const meta = metadataCache?.get?.(s.id);
        return s.phpVersion ?? meta?.phpVersion ?? '?';
      })
    )].join(', ');
    fleetInsights.push({
      kind: 'warning',
      title: `${eolSites.length} site${eolSites.length > 1 ? 's' : ''} on end-of-life PHP (${versions})`,
      detail: `PHP ${versions} reached end-of-life and no longer receives security patches. Upgrading to PHP 8.2+ is recommended.`,
    });
  }

  return {
    mode: 'fleet',
    localSiteCount: allSites.length,
    wpeSiteCount,
    indexedCount: indexedSet.size,
    fleetInsights,
  };
}

export function buildSiteContext(
  siteId: string,
  siteData: any,
  metadataCache: any,
  indexRegistry: any,
  siteStatus?: 'running' | 'halted' | 'unknown',
): AssistantContext {
  const allSites = siteData.getSites();
  const site = allSites[siteId] as any;
  const meta = metadataCache?.get?.(siteId) as any;
  const entries = indexRegistry.listAll() as any[];
  const indexEntry = entries.find((e: any) => e.siteId === siteId);

  const allPlugins: Array<{ name?: string; title?: string; status: string }> = meta?.plugins ?? [];
  const isFullScan = !meta?.scanDepth || meta.scanDepth === 'full';

  // For full scans: use active plugin titles + versions. For filesystem scans: use installed dir names.
  let activePlugins: string[] = [];
  if (isFullScan && allPlugins.length > 0) {
    activePlugins = allPlugins
      .filter((p) => p.status === 'active')
      .map((p) => {
        const title = p.title ?? p.name ?? '';
        const version = (p as any).version;
        return version ? `${title} (${version})` : title;
      })
      .filter(Boolean)
      .slice(0, 20);
  }
  const installedPluginCount = meta?.installedPlugins?.length ?? allPlugins.length;
  const inactivePluginCount = allPlugins.filter((p) => p.status === 'inactive').length;

  // Human-readable last-indexed age for freshness context
  let lastIndexedAgo: string | null = null;
  if (indexEntry?.lastIndexed) {
    const ageMs = Date.now() - indexEntry.lastIndexed;
    const mins = Math.round(ageMs / 60_000);
    lastIndexedAgo = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  }

  // Most recent post date from WordPress — collected via WP-CLI on site start
  let lastPostAt: string | null = null;
  if (meta?.lastPostAt) {
    lastPostAt = new Date(meta.lastPostAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  return {
    mode: 'site',
    siteId,
    siteName: site?.name ?? siteId,
    siteUrl: meta?.siteUrl ?? null,
    phpVersion: meta?.phpVersion ?? site?.phpVersion ?? null,
    wpVersion: meta?.wpVersion ?? null,
    pluginCount: activePlugins.length || installedPluginCount,
    activePlugins: activePlugins.length > 0 ? activePlugins : undefined,
    installedPluginCount,
    inactivePluginCount: inactivePluginCount > 0 ? inactivePluginCount : undefined,
    activeTheme: meta?.activeTheme ?? undefined,
    postCount: meta?.postCount ?? undefined,
    userCount: meta?.userCount ?? undefined,
    lastPostAt,
    wpSettings: meta?.wpSettings
      ? Object.fromEntries(
          Object.entries(meta.wpSettings).filter(([, v]) => v != null) as [string, string | number][],
        ) as Record<string, string | number>
      : undefined,
    scanDepth: meta?.scanDepth ?? (meta ? 'full' : undefined),
    indexState: indexEntry?.state ?? 'not_indexed',
    documentCount: indexEntry?.documentCount ?? 0,
    lastIndexedAgo,
    siteStatus: siteStatus ?? 'unknown',
  };
}

// ---------------------------------------------------------------------------
// Filter executor — runs AssistantFilter against real data sources
// ---------------------------------------------------------------------------

export function executeAssistantFilter(
  filter: AssistantFilter,
  siteData: any,
  metadataCache: any,
  graphService: any,
  limit = 15,
): NonNullable<QueryPlan['sites']> {
  const results: NonNullable<QueryPlan['sites']> = [];
  const db = graphService?.getDb?.() ?? null;
  const seen = new Set<string>(); // deduplicate by site name

  const addSite = (entry: NonNullable<QueryPlan['sites']>[0]) => {
    if (!seen.has(entry.name)) { seen.add(entry.name); results.push(entry); }
  };

  // ── Local site helper — reads phpVersion from all known paths ────────────
  // Local's site object stores phpVersion at site.phpVersion OR site.php.version
  const getLocalPhp = (s: any): string | null =>
    s.phpVersion ?? s.php?.version ?? metadataCache?.get?.(s.id)?.phpVersion ?? null;

  // ── PHP / WP version sort ───────────────────────────────────────────────
  if (filter.phpSort || filter.phpEolOnly || filter.wpSort) {
    // 1) Query graph.db for WPE installs (and any local sites stored there)
    if (db) {
      const col = filter.wpSort ? 'wp_version' : 'php_version';
      const order = (filter.phpSort === 'desc' || filter.wpSort === 'desc') ? 'DESC' : 'ASC';
      try {
        const rows = db.prepare(`
          SELECT id, name, source, php_version, wp_version
          FROM sites WHERE ${col} IS NOT NULL AND ${col} != '' AND is_active = 1
          ORDER BY ${col} ${order} LIMIT ?
        `).all(limit * 2) as any[];
        for (const row of rows) {
          const phpEol = row.php_version ? isPhpEol(row.php_version) : false;
          if (filter.phpEolOnly && !phpEol) continue;
          addSite({
            id: row.id, name: row.name,
            meta: [row.php_version ? `PHP ${row.php_version}` : null, row.wp_version ? `WP ${row.wp_version}` : null].filter(Boolean).join(' · '),
            tag: phpEol ? 'EOL' : undefined, tagKind: phpEol ? 'warn' : undefined,
            source: row.source === 'local' ? 'local' : 'wpe',
          });
        }
      } catch { /* db unavailable */ }
    }

    // 2) Always check local siteData — runs even when db is null.
    //    Reads phpVersion from site.phpVersion OR site.php.version (Local stores both paths).
    if (filter.phpSort || filter.phpEolOnly) {
      const allLocal = Object.values(siteData.getSites()) as any[];
      const withPhp = allLocal
        .map(s => ({ s, php: getLocalPhp(s) }))
        .filter(({ php }) => php && (!filter.phpEolOnly || isPhpEol(php as string)));
      withPhp.sort((a, b) => filter.phpSort === 'desc'
        ? (b.php ?? '').localeCompare(a.php ?? '')
        : (a.php ?? '').localeCompare(b.php ?? ''));
      for (const { s, php } of withPhp) {
        const meta = metadataCache?.get?.(s.id);
        const phpEol = isPhpEol(php as string);
        addSite({
          id: s.id, name: s.name,
          meta: [`PHP ${php}`, meta?.wpVersion ? `WP ${meta.wpVersion}` : null].filter(Boolean).join(' · '),
          tag: phpEol ? 'EOL' : undefined, tagKind: phpEol ? 'warn' : undefined,
          source: 'local',
        });
      }
    }
  }

  // ── PHP version range ────────────────────────────────────────────────────
  if (filter.phpVersion && db) {
    const { op, version } = filter.phpVersion;
    try {
      const rows = db.prepare(`
        SELECT id, name, source, php_version, wp_version
        FROM sites WHERE php_version IS NOT NULL AND is_active = 1 LIMIT ?
      `).all(limit * 2) as any[];
      for (const row of rows) {
        const cmp = (row.php_version ?? '').localeCompare(version);
        const matches = (op === '<' && cmp < 0) || (op === '>' && cmp > 0) ||
          (op === '<=' && cmp <= 0) || (op === '>=' && cmp >= 0);
        if (!matches) continue;
        const phpEol = isPhpEol(row.php_version);
        addSite({
          id: row.id, name: row.name,
          meta: `PHP ${row.php_version}${row.wp_version ? ` · WP ${row.wp_version}` : ''}`,
          tag: phpEol ? 'EOL' : undefined, tagKind: phpEol ? 'warn' : undefined,
          source: row.source === 'local' ? 'local' : 'wpe',
        });
      }
    } catch { /* db unavailable */ }
  }

  // ── Plugin slug ──────────────────────────────────────────────────────────
  if (filter.pluginSlug) {
    const q = filter.pluginSlug.toLowerCase();
    if (db) {
      try {
        const rows = db.prepare(`
          SELECT p.site_id, p.name, p.version, p.is_active, s.name AS site_name, s.source
          FROM plugins p JOIN sites s ON s.id = p.site_id
          WHERE LOWER(p.name) LIKE ? OR LOWER(p.slug) LIKE ?
          ORDER BY p.is_active DESC LIMIT ?
        `).all(`%${q}%`, `%${q}%`, limit) as any[];
        for (const row of rows) {
          addSite({
            id: row.site_id, name: row.site_name,
            meta: `${row.name} · v${row.version ?? '?'}`,
            tag: row.is_active ? 'active' : 'inactive',
            tagKind: row.is_active ? 'ok' : 'info',
            source: row.source === 'local' ? 'local' : 'wpe',
          });
        }
      } catch { /* db unavailable */ }
    }
    // Also search local SiteMetadataCache
    const allLocal = Object.values(siteData.getSites()) as any[];
    for (const s of allLocal) {
      const meta = metadataCache?.get?.(s.id);
      for (const p of meta?.plugins ?? []) {
        if (p.name.toLowerCase().includes(q) || p.title?.toLowerCase().includes(q)) {
          addSite({
            id: s.id, name: s.name,
            meta: `${p.title ?? p.name} · v${p.version ?? '?'}`,
            tag: p.status === 'active' ? 'active' : 'inactive',
            tagKind: p.status === 'active' ? 'ok' : 'info',
            source: 'local',
          });
          break;
        }
      }
    }
  }

  // ── Plugin category ──────────────────────────────────────────────────────
  if (filter.pluginCategory) {
    const slugs = PLUGIN_CATEGORIES[filter.pluginCategory] ?? [];
    if (slugs.length > 0 && db) {
      try {
        const placeholders = slugs.map(() => '?').join(', ');
        const rows = db.prepare(`
          SELECT p.site_id, p.slug, p.name, p.version, p.is_active, s.name AS site_name, s.source
          FROM plugins p JOIN sites s ON s.id = p.site_id
          WHERE p.slug IN (${placeholders})
          ORDER BY p.is_active DESC LIMIT ?
        `).all(...slugs, limit) as any[];
        for (const row of rows) {
          addSite({
            id: row.site_id, name: row.site_name,
            meta: `${row.name} · v${row.version ?? '?'}`,
            tag: row.is_active ? 'active' : 'inactive',
            tagKind: row.is_active ? 'ok' : 'info',
            source: row.source === 'local' ? 'local' : 'wpe',
          });
        }
      } catch { /* db unavailable */ }
    }
    // Local cache
    const slugSet = new Set(slugs);
    const allLocal = Object.values(siteData.getSites()) as any[];
    for (const s of allLocal) {
      const meta = metadataCache?.get?.(s.id);
      for (const p of meta?.plugins ?? []) {
        if (slugSet.has(p.name)) {
          addSite({
            id: s.id, name: s.name,
            meta: `${p.title ?? p.name} · v${p.version ?? '?'}`,
            tag: p.status === 'active' ? 'active' : 'inactive',
            tagKind: p.status === 'active' ? 'ok' : 'info',
            source: 'local',
          });
          break;
        }
      }
    }
  }

  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export function parseQueryPlan(rawText: string): QueryPlan {
  const trimmed = rawText.trim();

  // Extract JSON — handle plain JSON or markdown code blocks
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      intent: 'explanation',
      summary: trimmed.slice(0, 300) || 'I could not parse the response. Please try again.',
      needsClarification: false,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      intent: parsed.intent ?? 'explanation',
      summary: parsed.summary ?? '',
      filter: parsed.filter ?? undefined,
      sites: parsed.sites ?? undefined,
      contentResults: parsed.contentResults ?? undefined,
      actions: parsed.actions ?? undefined,
      needsClarification: parsed.needsClarification ?? false,
      clarificationQuestion: parsed.clarificationQuestion ?? undefined,
    };
  } catch {
    return {
      intent: 'explanation',
      summary: trimmed.slice(0, 300) || 'I encountered a parsing error. Please try again.',
      needsClarification: false,
    };
  }
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

export async function queryAssistant(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  settings: any,
  apiKeys: Record<string, string>,
): Promise<AssistantResponse> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getProvider } = require('../chat/providers/index');

  const aiProvider = settings?.aiProvider || 'anthropic';
  const apiKey = apiKeys[aiProvider] || '';
  const useLocalGateway = settings?.useLocalGateway ?? false;

  if (aiProvider !== 'ollama' && !useLocalGateway && !apiKey) {
    return {
      plan: {
        intent: 'explanation',
        summary: `No API key configured for ${aiProvider}. Set one in Preferences → AI Provider, or switch to Ollama for free local inference.`,
        needsClarification: false,
      },
      rawText: '',
    };
  }

  const provider = getProvider(aiProvider);
  if (!provider) {
    return {
      plan: { intent: 'explanation', summary: `Provider ${aiProvider} is not available.`, needsClarification: false },
      rawText: '',
    };
  }

  const defaultModels: Record<string, string> = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai:    'gpt-4o-mini',
    google:    'gemini-2.5-flash',
    ollama:    'llama3.2',
  };
  // Retired/removed models that should fall back to the provider default.
  const retiredModels = new Set([
    'gemini-3-pro-preview', 'gemini-3-flash-preview',
    'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b',
    'claude-sonnet-4-20250514', 'claude-opus-4-20250514',
    'o1', 'o1-mini', 'o3-mini',
    'dall-e-2', 'dall-e-3',
  ]);
  const storedModel = settings?.aiModel;
  const model = (storedModel && !retiredModels.has(storedModel))
    ? storedModel
    : defaultModels[aiProvider] || 'llama3.2';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let rawText = '';
  try {
    const fullMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages,
    ];
    const stream = provider.streamChat(fullMessages, [], { model, apiKey }, controller.signal);
    for await (const event of stream) {
      if ((event as any).type === 'token') rawText += (event as any).text;
      if ((event as any).type === 'done') break;
    }
  } finally {
    clearTimeout(timeout);
  }

  return { plan: parseQueryPlan(rawText), rawText };
}
