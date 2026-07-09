import type { McpToolHandler, McpToolResult } from '../../types';

const BLOCKED = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|MERGE)\b/i;

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export const fleetSqlHandler: McpToolHandler = {
  definition: {
    name: 'fleet_sql',
    description:
      'Execute a read-only SELECT query against the Nexus graph database (graph.db). ' +
      'Use for fleet-wide aggregations: post counts, user counts, plugin inventory, version distribution, ' +
      'and site activity that cannot be answered by other fleet tools.\n\n' +
'Schema:\n' +
      '  sites(id, name, source, environment, wp_version, php_version, post_count, post_count_by_type,\n' +
      '        user_count, user_count_by_role, last_post_at, last_active_session,\n' +
      '        site_url, admin_email, active_theme, is_active, ssh_last_sync_at,\n' +
      '        settings_json)\n' +
      '  sites.environment = "production" | "staging" | "development" — only set for WPE sites (source="wpe"), NULL for local sites\n' +
      '  plugins(id, site_id, slug, name, version, is_active)\n' +
      '  content(id, site_id, post_id, post_type, title, status, updated_at)\n' +
      '  users(id, site_id, user_id, username, email, roles, created_at, updated_at)\n\n' +
      'IMPORTANT column names — use exactly these, not alternatives:\n' +
      '  users.username  (NOT user_login)    users.email  (NOT user_email)\n' +
      '  users.roles     (NOT role) — JSON array stored as text: ["administrator"]\n' +
      '  sites.post_count = WordPress post objects (NOT vector index chunks)\n' +
      '  sites.post_count_by_type = JSON text: {"post":N,"page":N,...}\n' +
      '  sites.user_count_by_role = JSON text: {"administrator":N,"editor":N,...}\n' +
      '  sites.settings_json = JSON text with WordPress site settings — use json_extract() to query\n\n' +
      'WordPress settings queries — ALWAYS use fleet_sql for these, never wp_option_get in a loop:\n' +
      '  Sites blocking search engines:  SELECT name FROM sites WHERE json_extract(settings_json, \'$.blog_public\') = \'0\'\n' +
      '  Sites open to search engines:   SELECT name FROM sites WHERE json_extract(settings_json, \'$.blog_public\') = \'1\'\n' +
      '  Sites with comments disabled:   SELECT name FROM sites WHERE json_extract(settings_json, \'$.default_comment_status\') = \'closed\'\n' +
      '  Sites with open registration:   SELECT name FROM sites WHERE json_extract(settings_json, \'$.users_can_register\') = \'1\'\n' +
      '  Sites with static front page:   SELECT name FROM sites WHERE json_extract(settings_json, \'$.show_on_front\') = \'page\'\n' +
      '  Sites with plain permalinks:    SELECT name FROM sites WHERE json_extract(settings_json, \'$.permalink_structure\') = \'\'\n' +
      '  NOTE: sites with settings_json IS NULL have not been scanned — exclude from negative queries too.\n\n' +
      'Timestamp columns — last_post_at, ssh_last_sync_at, last_active_session, last_sync_at are Unix epoch integers (NOT date strings).\n' +
      '  CORRECT: WHERE last_post_at >= CAST(strftime(\'%s\', \'now\', \'-30 days\') AS INTEGER)\n' +
      '  WRONG:   WHERE last_post_at >= date(\'now\', \'-30 days\')  -- date() returns a string; comparison always fails\n' +
      '  Sites updated in last 30 days: SELECT name FROM sites WHERE last_post_at >= CAST(strftime(\'%s\', \'now\', \'-30 days\') AS INTEGER)\n' +
      '  Sites not updated in 90 days:  SELECT name FROM sites WHERE last_post_at < CAST(strftime(\'%s\', \'now\', \'-90 days\') AS INTEGER) OR last_post_at IS NULL\n\n' +
      'Role query patterns (roles is a JSON array, use LIKE for filtering):\n' +
      '  Admins on multiple sites: SELECT email, COUNT(DISTINCT site_id) as sites FROM users WHERE roles LIKE \'%administrator%\' GROUP BY email HAVING sites > 1 ORDER BY sites DESC\n' +
      '  Role counts: SELECT roles, COUNT(*) as n FROM users GROUP BY roles ORDER BY n DESC\n\n' +
      'Only SELECT statements are allowed. No semicolons, no CTEs (WITH ... SELECT).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A SELECT SQL statement. No semicolons. No DML or DDL.',
        },
      },
      required: ['query'],
    },
    annotations: { title: 'Fleet SQL Query', readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const db = (services as any).graphService?.getDb?.();
    if (!db) return error('Graph database not available. Ensure Local is running with Nexus AI active.');

    const query = (args.query as string ?? '').trim();

    if (!query) return error('Query is required. Pass a SELECT statement.');

    if (!query.toUpperCase().startsWith('SELECT')) {
      return error('Only SELECT statements are allowed. This tool is read-only.');
    }
    if (query.includes(';')) {
      return error('Semicolons are not allowed. Pass a single SELECT statement.');
    }
    if (BLOCKED.test(query)) {
      return error('Query contains disallowed keywords. Only SELECT statements are permitted.');
    }

    try {
      const rows = db.prepare(query).all() as Record<string, unknown>[];

      if (rows.length === 0) {
        return ok(`No rows returned.\n\nQuery: \`${query}\``);
      }

      const cols = Object.keys(rows[0]);
      const header = `| ${cols.join(' | ')} |`;
      const sep    = `| ${cols.map(() => '---').join(' | ')} |`;
      const body   = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? '')).join(' | ')} |`).join('\n');

      return ok(`${header}\n${sep}\n${body}\n\n_${rows.length} row${rows.length === 1 ? '' : 's'}_`);
    } catch (err) {
      return error(`SQL error: ${(err as Error).message}`);
    }
  },
};
