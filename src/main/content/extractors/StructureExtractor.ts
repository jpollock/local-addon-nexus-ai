import * as mysql from 'mysql2/promise';
import { UserSummary, PermalinkInfo, SiteHealthInfo } from '../../../common/types';
import { phpUnserialize } from './php-unserialize';

const DEFAULT_WP_ROLES = new Set([
  'administrator', 'editor', 'author', 'contributor', 'subscriber',
  'shop_manager', 'customer',
]);

export interface StructureData {
  activeThemeSlug: string;
  parentThemeSlug: string;
  activePluginSlugs: string[];
  users: UserSummary;
  permalinks: PermalinkInfo;
  health: SiteHealthInfo;
}

/**
 * Extract site structure data from the database: active theme/plugins,
 * user role breakdown, permalink structure, and site health indicators.
 */
export async function extractSiteStructureData(
  conn: mysql.Connection,
  prefix: string,
): Promise<StructureData> {
  // 1. Fetch all needed options in a single query
  const [optionRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT option_name, option_value FROM ${prefix}options
     WHERE option_name IN (
       'template', 'stylesheet', 'active_plugins',
       'blog_public', 'WPLANG', 'timezone_string', 'gmt_offset',
       'default_role', 'permalink_structure', 'rewrite_rules'
     )`,
  );

  const options: Record<string, string> = {};
  for (const row of optionRows) {
    options[row.option_name as string] = (row.option_value as string) ?? '';
  }

  // Active theme
  const activeThemeSlug = options.stylesheet || '';
  const parentThemeSlug = options.template || '';

  // Active plugins — PHP serialized array of "folder/file.php" strings
  const activePluginSlugs = parseActivePlugins(options.active_plugins || '');

  // Permalink structure
  const permalinkStructure = options.permalink_structure || '/?p=%post_id%';
  const rewriteRulesCount = countRewriteRules(options.rewrite_rules || '');

  // Site health
  const health: SiteHealthInfo = {
    searchEngineVisibility: options.blog_public !== '0',
    language: options.WPLANG || 'en_US',
    timezone: options.timezone_string || (options.gmt_offset ? `UTC${options.gmt_offset}` : 'UTC'),
    defaultRole: options.default_role || 'subscriber',
  };

  // 2. User role breakdown
  const capabilitiesKey = `${prefix}capabilities`;
  const [roleRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT meta_value, COUNT(*) as cnt
     FROM ${prefix}usermeta
     WHERE meta_key = ?
     GROUP BY meta_value`,
    [capabilitiesKey],
  );

  const roleBreakdown: Record<string, number> = {};
  let totalUsers = 0;

  for (const row of roleRows) {
    const count = Number(row.cnt);
    totalUsers += count;

    const caps = phpUnserialize(String(row.meta_value ?? ''));
    if (caps && typeof caps === 'object' && !Array.isArray(caps)) {
      // Capabilities is a PHP associative array: { "administrator": true, ... }
      // The role is the first key with a truthy value
      for (const [role, enabled] of Object.entries(caps)) {
        if (enabled) {
          roleBreakdown[role] = (roleBreakdown[role] || 0) + count;
        }
      }
    }
  }

  const customRoles = Object.keys(roleBreakdown).filter(
    (role) => !DEFAULT_WP_ROLES.has(role),
  );

  return {
    activeThemeSlug,
    parentThemeSlug,
    activePluginSlugs,
    users: { totalUsers, roleBreakdown, customRoles },
    permalinks: { structure: permalinkStructure, totalRewriteRules: rewriteRulesCount },
    health,
  };
}

/**
 * Parse the active_plugins option (PHP serialized array of "folder/file.php" strings)
 * into an array of plugin slugs (folder names).
 */
function parseActivePlugins(serialized: string): string[] {
  const parsed = phpUnserialize(serialized);
  if (!parsed || typeof parsed !== 'object') return [];

  // WordPress may store active_plugins with non-sequential keys (e.g. after
  // deactivating a plugin), so phpUnserialize returns an object instead of
  // an array. Handle both cases.
  const values: unknown[] = Array.isArray(parsed)
    ? parsed
    : Object.values(parsed);

  return values
    .filter((v): v is string => typeof v === 'string')
    .map((pluginPath) => {
      // "woocommerce/woocommerce.php" → "woocommerce"
      // "hello.php" → "hello"
      const slashIndex = pluginPath.indexOf('/');
      if (slashIndex > 0) return pluginPath.slice(0, slashIndex);
      return pluginPath.replace(/\.php$/, '');
    });
}

/**
 * Count the number of rewrite rules from the serialized rewrite_rules option.
 */
function countRewriteRules(serialized: string): number {
  if (!serialized) return 0;
  const parsed = phpUnserialize(serialized);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.keys(parsed).length;
  }
  return 0;
}
