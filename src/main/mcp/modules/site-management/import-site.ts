import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error as err, requireLocalServices } from './helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function isValidFilePath(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const homeDir = os.homedir();
  const tmpDir = os.tmpdir();

  // Only allow paths within home directory or temp directory
  return resolvedPath.startsWith(homeDir) || resolvedPath.startsWith(tmpDir);
}

export const importSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_import_site',
    description: 'Import a WordPress site from a zip file (Local export, generic archive, or backup)',
    inputSchema: {
      type: 'object',
      properties: {
        zipPath: {
          type: 'string',
          description: 'Path to the zip file to import',
        },
        siteName: {
          type: 'string',
          description: 'Name for the imported site (optional, derived from zip if not provided)',
        },
      },
      required: ['zipPath'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const zipPath = args.zipPath as string;
    const siteName = args.siteName as string | undefined;

    if (!zipPath) {
      return err('zipPath parameter is required');
    }

    // Security: Validate path is safe (no path traversal attacks)
    if (!isValidFilePath(zipPath)) {
      return err('Invalid zip file path. Path must be within allowed directories (home, tmp).');
    }

    // Verify file exists
    if (!fs.existsSync(zipPath)) {
      return err(`Zip file not found: ${zipPath}`);
    }

    // Verify it's a zip file
    if (!zipPath.toLowerCase().endsWith('.zip')) {
      return err('File must be a .zip archive');
    }

    try {
      const result = await services.localServices!.importSite(zipPath, siteName);

      return ok(`Successfully imported site "${result.name}" from ${path.basename(zipPath)}. Site ID: ${result.id}`);
    } catch (error: any) {
      // Provide helpful error messages
      if (error.message?.includes('not a valid')) {
        return err(`The zip file does not appear to be a valid Local export or WordPress backup. Error: ${error.message}`);
      }
      return err(`Failed to import site: ${error.message}`);
    }
  },
};
