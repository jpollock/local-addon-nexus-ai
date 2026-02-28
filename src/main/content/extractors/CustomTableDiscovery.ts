import * as mysql from 'mysql2/promise';
import { CustomTableInfo } from '../../../common/types';

/** WordPress core tables (without prefix) */
const WP_CORE_TABLES = new Set([
  'posts',
  'postmeta',
  'comments',
  'commentmeta',
  'options',
  'terms',
  'termmeta',
  'term_taxonomy',
  'term_relationships',
  'users',
  'usermeta',
  'links',
]);

/** Known plugin table prefix → plugin name mapping */
const PLUGIN_TABLE_PREFIXES: Array<[RegExp, string]> = [
  [/^wc_/, 'WooCommerce'],
  [/^woocommerce_/, 'WooCommerce'],
  [/^actionscheduler_/, 'Action Scheduler'],
  [/^yoast_/, 'Yoast SEO'],
  [/^wpseo_/, 'Yoast SEO'],
  [/^redirection_/, 'Redirection'],
  [/^wp_mail_smtp/, 'WP Mail SMTP'],
  [/^mailpoet_/, 'MailPoet'],
  [/^wpmailsmtp_/, 'WP Mail SMTP'],
  [/^ewwwio_/, 'EWWW Image Optimizer'],
  [/^gf_/, 'Gravity Forms'],
  [/^wpforms_/, 'WPForms'],
  [/^cf7/, 'Contact Form 7'],
  [/^smush_/, 'Smush'],
  [/^rank_math_/, 'Rank Math'],
  [/^aioseo_/, 'All in One SEO'],
  [/^elementor/, 'Elementor'],
  [/^litespeed/, 'LiteSpeed Cache'],
  [/^w3tc_/, 'W3 Total Cache'],
  [/^jetpack_/, 'Jetpack'],
  [/^icl_/, 'WPML'],
  [/^edd_/, 'Easy Digital Downloads'],
  [/^lp_/, 'LearnPress'],
  [/^learndash_/, 'LearnDash'],
  [/^bp_/, 'BuddyPress'],
  [/^bbp_/, 'bbPress'],
  [/^wfls_/, 'Wordfence'],
  [/^wf_/, 'Wordfence'],
];

function guessPlugin(tableName: string): string {
  for (const [pattern, name] of PLUGIN_TABLE_PREFIXES) {
    if (pattern.test(tableName)) return name;
  }
  return 'Unknown';
}

/**
 * Discover non-core database tables and attribute them to known plugins.
 * Structure-only — results are stored as metadata, not vector-indexed.
 */
export async function discoverCustomTables(
  conn: mysql.Connection,
  prefix: string,
): Promise<CustomTableInfo[]> {
  // Get all tables
  const [tableRows] = await conn.query<mysql.RowDataPacket[]>('SHOW TABLE STATUS');

  const customTables: CustomTableInfo[] = [];

  for (const row of tableRows) {
    const fullName = row.Name as string;

    // Only consider tables with the site's prefix
    if (!fullName.startsWith(prefix)) continue;

    const unprefixed = fullName.slice(prefix.length);

    // Skip WordPress core tables
    if (WP_CORE_TABLES.has(unprefixed)) continue;

    const rowCount = typeof row.Rows === 'number' ? row.Rows : parseInt(String(row.Rows ?? '0'), 10);

    customTables.push({
      name: fullName,
      prefix: unprefixed,
      rowCount: isNaN(rowCount) ? 0 : rowCount,
      pluginGuess: guessPlugin(unprefixed),
    });
  }

  return customTables;
}
