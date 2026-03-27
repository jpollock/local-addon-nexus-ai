import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error as err, requireLocalServices } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

function readLastLines(filePath: string, numLines: number): string {
  try {
    if (!fs.existsSync(filePath)) {
      return `[Log file not found: ${path.basename(filePath)}]`;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const lastLines = lines.slice(-numLines).join('\n');
    return lastLines || '[Log file is empty]';
  } catch (error: any) {
    return `[Error reading log: ${error.message}]`;
  }
}

function findLogFiles(logsDir: string, serviceType: string): string[] {
  const servicePath = path.join(logsDir, serviceType);
  const logFiles: string[] = [];

  try {
    if (fs.existsSync(servicePath) && fs.statSync(servicePath).isDirectory()) {
      const files = fs.readdirSync(servicePath);
      for (const file of files) {
        if (file.endsWith('.log')) {
          logFiles.push(path.join(servicePath, file));
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return logFiles;
}

export const getSiteLogsHandler: McpToolHandler = {
  definition: {
    name: 'local_get_site_logs',
    description: 'Get log file contents for a site (PHP errors, access logs, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
        logType: {
          type: 'string',
          enum: ['php', 'nginx', 'mysql', 'all'],
          description: 'Type of logs to retrieve (default: php)',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to return from end of log (default: 100)',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return err(`Site "${args.site}" not found.`);

    const logType = (args.logType as string) || 'php';
    const lines = (args.lines as number) || 100;

    try {
      // Get logs directory from site paths
      const logsDir = (site as any).paths?.logs || path.join(site.path, 'logs');

      if (!fs.existsSync(logsDir)) {
        return err(`Logs directory not found: ${logsDir}`);
      }

      const results: string[] = [];
      const numLines = Math.min(Math.max(lines, 10), 1000); // Clamp between 10 and 1000

      const serviceTypes = logType === 'all' ? ['php', 'nginx', 'mysql'] : [logType];

      for (const serviceType of serviceTypes) {
        const logFiles = findLogFiles(logsDir, serviceType);

        if (logFiles.length === 0) {
          results.push(`=== ${serviceType.toUpperCase()} ===\n[No log files found]`);
          continue;
        }

        for (const logFile of logFiles) {
          const fileName = path.basename(logFile);
          const content = readLastLines(logFile, numLines);
          results.push(`=== ${serviceType.toUpperCase()}: ${fileName} ===\n${content}`);
        }
      }

      return ok(`Logs for "${site.name}" (last ${numLines} lines):\n\n${results.join('\n\n')}`);
    } catch (error: any) {
      return err(`Failed to get site logs: ${error.message}`);
    }
  },
};
