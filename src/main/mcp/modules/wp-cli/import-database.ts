import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error as err } from './preflight';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function isValidSqlPath(sqlPath: string): boolean {
  if (!sqlPath.toLowerCase().endsWith('.sql')) {
    return false;
  }

  const resolvedPath = path.resolve(sqlPath);
  const homeDir = os.homedir();
  const tmpDir = os.tmpdir();

  // Only allow paths within home directory or temp directory
  return resolvedPath.startsWith(homeDir) || resolvedPath.startsWith(tmpDir);
}

export const importDatabaseHandler: McpToolHandler = {
  definition: {
    name: 'wp_import_database',
    description: 'Import a SQL file into a site database',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
        sqlPath: {
          type: 'string',
          description: 'Path to the SQL file to import',
        },
      },
      required: ['site', 'sqlPath'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return err(`Site "${args.site}" not found.`);

    const sqlPath = args.sqlPath as string;
    if (!sqlPath) {
      return err('sqlPath parameter is required');
    }

    // Security: Validate path is safe (no path traversal attacks)
    if (!isValidSqlPath(sqlPath)) {
      return err('Invalid SQL file path. Path must end in .sql and be within allowed directories (home, tmp).');
    }

    // Verify file exists
    if (!fs.existsSync(sqlPath)) {
      return err(`SQL file not found: ${sqlPath}`);
    }

    try {
      // Run WP-CLI db import
      const result = await services.localServices!.wpCliRun(site.id, ['db', 'import', sqlPath]);

      if (!result.stdout) {
        return err(`Failed to import database for "${site.name}"`);
      }

      return ok(`Successfully imported "${sqlPath}" into database for "${site.name}"`);
    } catch (error: any) {
      return err(`Failed to import database: ${error.message}`);
    }
  },
};
