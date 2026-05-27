import type { MetadataSearchResult } from '../../common/types';

// ---------------------------------------------------------------------------
// Plugin category taxonomy — maps concept names to known plugin slugs.
// Add slugs here when users report missing plugins in category searches.
// ---------------------------------------------------------------------------

const PLUGIN_CATEGORIES: Record<string, string[]> = {
  'form-builder': [
    'contact-form-7', 'gravityforms', 'wpforms-lite', 'wpforms',
    'ninja-forms', 'formidable', 'fluentform', 'happyforms',
    'ws-form', 'caldera-forms', 'forminator',
  ],
  'page-builder': [
    'elementor', 'elementor-pro', 'beaver-builder-lite-version', 'bb-plugin',
    'js_composer', 'divi-builder', 'fusion-builder', 'brizy', 'oxygen',
    'kadence-blocks', 'generateblocks', 'stackable-ultimate-gutenberg-blocks',
  ],
  'seo': [
    'wordpress-seo', 'rank-math', 'all-in-one-seo-pack', 'seo-by-rank-math',
    'squirrly-seo', 'the-seo-framework', 'slim-seo',
  ],
  'ecommerce': [
    'woocommerce', 'easy-digital-downloads', 'wc-vendors',
    'lifterlms', 'learndash', 'memberpress', 'restrict-content-pro',
  ],
  'caching': [
    'w3-total-cache', 'wp-super-cache', 'wp-fastest-cache',
    'litespeed-cache', 'sg-cachepress', 'swift-performance-lite',
    'hummingbird-performance', 'autoptimize',
  ],
  'security': [
    'wordfence', 'sucuri-scanner', 'better-wp-security',
    'all-in-one-wp-security-and-firewall', 'shield-security',
    'bulletproof-security', 'anti-malware',
  ],
  'backup': [
    'updraftplus', 'backwpup', 'duplicator', 'duplicator-pro',
    'all-in-one-wp-migration', 'backupbuddy', 'wp-backitup',
  ],
  'performance': [
    'litespeed-cache', 'w3-total-cache', 'autoptimize', 'imagify',
    'smush', 'ewww-image-optimizer', 'wp-smushit', 'jetpack-boost',
  ],
  'analytics': [
    'google-analytics-for-wordpress', 'googleanalytics', 'wp-statistics',
    'independent-analytics', 'site-kit-by-google',
  ],
  'multilingual': [
    'sitepress-multilingual-cms', 'polylang', 'weglot', 'translatepress-multilingual',
    'loco-translate',
  ],
};

// Category concept → category key mappings
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\bform\s*build(er|ers|ing)\b/i,              'form-builder'],
  [/\bcontact\s+form\b/i,                         'form-builder'],
  [/\bpage\s*build(er|ers|ing)\b/i,               'page-builder'],
  [/\bvisual\s*compos(er|ition)\b/i,              'page-builder'],
  [/\bseo\b/i,                                    'seo'],
  [/\bsearch\s+engine\s+optim/i,                  'seo'],
  [/\be[\-\s]?commerce\b/i,                       'ecommerce'],
  [/\bonline\s+store\b|\bweb\s+shop\b/i,           'ecommerce'],
  [/\bcach(e|ing)\b/i,                            'caching'],
  [/\bperformance\b|\bspeed\b/i,                  'performance'],
  [/\bbackup\b/i,                                 'backup'],
  [/\bsecur(ity|e|ity\s*plugin)/i,                'security'],
  [/\banalytics\b|\btracking\b/i,                 'analytics'],
  [/\bmultilingual\b|\btranslat(ion|e)\b/i,        'multilingual'],
];

// ---------------------------------------------------------------------------
// Query type detection — runs before SQL to choose the right branch.
// ---------------------------------------------------------------------------

type MetadataQueryIntent =
  | { kind: 'php-sort'; order: 'asc' | 'desc' }
  | { kind: 'wp-sort';  order: 'asc' | 'desc' }
  | { kind: 'php-range'; below: string }      // e.g. below = '8.0'
  | { kind: 'plugin-category'; category: string; slugs: string[] }
  | { kind: 'substring' };                    // existing LIKE behaviour

const PHP_NEEDS_UPGRADE = /\bold(er|est)?\s+php|\boutdat\w*\s+php|old.*\bphp\b|php.*(old|outdated|upgrad|below|lower|slow|eol|end.of.life)|needs?\s+(php|upgrade)|upgrad.*php|php\s+[57]\b/i;
const PHP_LATEST         = /\bnew(est)?\s+php|latest\s+php|highest\s+php|php\s+8\b/i;
const WP_NEEDS_UPGRADE   = /\bold(er|est)?\s+(wp|wordpress)|wordpress.*(old|outdated|upgrad)|upgrad.*wordpress|needs?\s+wordpress/i;
const WP_LATEST          = /\bnew(est)?\s+(wp|wordpress)|latest\s+(wp|wordpress)/i;

export function detectMetadataQueryIntent(query: string): MetadataQueryIntent {
  if (PHP_NEEDS_UPGRADE.test(query)) return { kind: 'php-sort', order: 'asc' };
  if (PHP_LATEST.test(query))        return { kind: 'php-sort', order: 'desc' };
  if (WP_NEEDS_UPGRADE.test(query))  return { kind: 'wp-sort',  order: 'asc' };
  if (WP_LATEST.test(query))         return { kind: 'wp-sort',  order: 'desc' };

  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(query)) {
      return { kind: 'plugin-category', category, slugs: PLUGIN_CATEGORIES[category] ?? [] };
    }
  }

  return { kind: 'substring' };
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface CachePluginEntry {
  name: string;
  title: string;
  version?: string;
  status: string;
}

interface CacheSiteMeta {
  plugins?: CachePluginEntry[];
  themes?: CachePluginEntry[];
}

interface MetadataCacheAccessor {
  getAll(): Record<string, CacheSiteMeta | null>;
  getSiteNames(): Record<string, string>;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search plugins, themes, and version data across graph.db (WPE) and
 * SiteMetadataCache (local sites). Returns typed MetadataSearchResult[].
 *
 * Supports:
 *   - Exact plugin/theme name substring matching
 *   - Exact PHP/WP version matching ("PHP 7.4")
 *   - Version sorting ("oldest PHP", "latest WP")
 *   - Plugin category matching ("form builder", "page builder")
 */
export function searchMetadata(
  query: string,
  db: any | null,
  cache: MetadataCacheAccessor | null,
  limit: number,
): MetadataSearchResult[] {
  const q = query.toLowerCase().trim();
  if (q.length < 3) return [];

  const intent = detectMetadataQueryIntent(query);
  const results: MetadataSearchResult[] = [];

  if (db) {
    try {
      // ── PHP version sorting ──────────────────────────────────────────────
      if (intent.kind === 'php-sort') {
        const rows = db.prepare(`
          SELECT id, name, source, php_version
          FROM sites
          WHERE php_version IS NOT NULL AND php_version != '' AND is_active = 1
          ORDER BY php_version ${intent.order === 'asc' ? 'ASC' : 'DESC'}
          LIMIT ?
        `).all(limit) as Array<{ id: string; name: string; source: string; php_version: string }>;

        rows.forEach((row, i) => {
          results.push({
            type: 'site-metadata',
            matchKind: 'php-version',
            siteId: row.id,
            siteName: row.name,
            siteSource: row.source === 'local' ? 'local' : 'wpe',
            field: 'php_version',
            value: `PHP ${row.php_version}`,
            score: 1 - i * 0.05, // rank by position
          });
        });

      // ── WP version sorting ───────────────────────────────────────────────
      } else if (intent.kind === 'wp-sort') {
        const rows = db.prepare(`
          SELECT id, name, source, wp_version
          FROM sites
          WHERE wp_version IS NOT NULL AND wp_version != '' AND is_active = 1
          ORDER BY wp_version ${intent.order === 'asc' ? 'ASC' : 'DESC'}
          LIMIT ?
        `).all(limit) as Array<{ id: string; name: string; source: string; wp_version: string }>;

        rows.forEach((row, i) => {
          results.push({
            type: 'site-metadata',
            matchKind: 'wp-version',
            siteId: row.id,
            siteName: row.name,
            siteSource: row.source === 'local' ? 'local' : 'wpe',
            field: 'wp_version',
            value: `WP ${row.wp_version}`,
            score: 1 - i * 0.05,
          });
        });

      // ── Plugin category ──────────────────────────────────────────────────
      } else if (intent.kind === 'plugin-category' && intent.slugs.length > 0) {
        const placeholders = intent.slugs.map(() => '?').join(', ');
        const rows = db.prepare(`
          SELECT p.site_id, p.slug, p.name, p.version, p.is_active,
                 s.name AS site_name, s.source
          FROM plugins p
          JOIN sites s ON s.id = p.site_id
          WHERE p.slug IN (${placeholders})
          ORDER BY p.is_active DESC, s.name ASC
          LIMIT ?
        `).all(...intent.slugs, limit) as Array<{
          site_id: string; slug: string; name: string;
          version: string | null; is_active: number;
          site_name: string; source: string;
        }>;

        for (const row of rows) {
          results.push({
            type: 'site-metadata',
            matchKind: 'plugin',
            siteId: row.site_id,
            siteName: row.site_name,
            siteSource: row.source === 'local' ? 'local' : 'wpe',
            field: row.slug,
            value: `${row.is_active ? 'active' : 'inactive'} · v${row.version ?? '?'}`,
            score: row.is_active ? 1.0 : 0.7,
          });
        }

        // Also search local cache for category slugs
        if (cache) {
          const slugSet = new Set(intent.slugs);
          const allMeta = cache.getAll();
          const siteNames = cache.getSiteNames();
          for (const [siteId, meta] of Object.entries(allMeta)) {
            if (!meta) continue;
            for (const plugin of meta.plugins ?? []) {
              if (slugSet.has(plugin.name)) {
                results.push({
                  type: 'site-metadata', matchKind: 'plugin',
                  siteId, siteName: siteNames[siteId] ?? siteId,
                  siteSource: 'local',
                  field: plugin.name,
                  value: `${plugin.status} · v${plugin.version ?? '?'}`,
                  score: plugin.status === 'active' ? 1.0 : 0.7,
                });
              }
            }
          }
        }

      // ── Substring fallback (original behaviour) ──────────────────────────
      } else {
        const pluginRows = db.prepare(`
          SELECT p.site_id, p.slug, p.name, p.version, p.is_active,
                 s.name AS site_name, s.source
          FROM plugins p
          JOIN sites s ON s.id = p.site_id
          WHERE (LOWER(p.name) LIKE ? OR LOWER(p.slug) LIKE ?)
          LIMIT ?
        `).all(`%${q}%`, `%${q}%`, limit) as Array<{
          site_id: string; slug: string; name: string;
          version: string | null; is_active: number;
          site_name: string; source: string;
        }>;

        for (const row of pluginRows) {
          results.push({
            type: 'site-metadata', matchKind: 'plugin',
            siteId: row.site_id, siteName: row.site_name,
            siteSource: row.source === 'local' ? 'local' : 'wpe',
            field: row.slug,
            value: `${row.is_active ? 'active' : 'inactive'} · v${row.version ?? '?'}`,
            score: row.is_active ? 1.0 : 0.7,
          });
        }

        // Version number extraction (existing behaviour)
        const vMatch = /(\d+\.\d[\d.]*)/.exec(q);
        if (vMatch) {
          const ver = vMatch[1];
          const col = q.includes('php') ? 'php_version' : 'wp_version';
          const kind = q.includes('php') ? 'php-version' : 'wp-version';
          const label = q.includes('php') ? `PHP ${ver}` : `WP ${ver}`;
          const rows = db.prepare(
            `SELECT id, name, source FROM sites WHERE LOWER(${col}) LIKE ? AND is_active = 1 LIMIT ?`
          ).all(`${ver}%`, limit) as Array<{ id: string; name: string; source: string }>;
          for (const row of rows) {
            results.push({
              type: 'site-metadata', matchKind: kind as any,
              siteId: row.id, siteName: row.name,
              siteSource: row.source === 'local' ? 'local' : 'wpe',
              field: col, value: label, score: 0.9,
            });
          }
        }
      }
    } catch { /* graph.db unavailable */ }
  }

  // ── SiteMetadataCache: local plugins + themes (substring mode only) ─────
  if (cache && intent.kind === 'substring') {
    const allMeta = cache.getAll();
    const siteNames = cache.getSiteNames();

    for (const [siteId, meta] of Object.entries(allMeta)) {
      if (!meta) continue;
      for (const plugin of meta.plugins ?? []) {
        if (plugin.name.toLowerCase().includes(q) || plugin.title.toLowerCase().includes(q)) {
          results.push({
            type: 'site-metadata', matchKind: 'plugin',
            siteId, siteName: siteNames[siteId] ?? siteId, siteSource: 'local',
            field: plugin.name,
            value: `${plugin.status} · v${plugin.version ?? '?'}`,
            score: plugin.status === 'active' ? 1.0 : 0.7,
          });
        }
      }
      for (const theme of meta.themes ?? []) {
        if (theme.name.toLowerCase().includes(q) || theme.title.toLowerCase().includes(q)) {
          results.push({
            type: 'site-metadata', matchKind: 'theme',
            siteId, siteName: siteNames[siteId] ?? siteId, siteSource: 'local',
            field: theme.name,
            value: `${theme.status} · v${theme.version ?? '?'}`,
            score: theme.status === 'active' ? 1.0 : 0.6,
          });
        }
      }
    }
  }

  // Deduplicate by siteId+field then sort
  const seen = new Set<string>();
  const deduped = results.filter(r => {
    const key = `${r.siteId}::${r.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.sort((a, b) => b.score - a.score).slice(0, limit);
}
