/**
 * Logging Configuration
 *
 * Environment variables:
 * - NEXUS_LOG_LEVEL: ERROR | WARN | INFO | DEBUG (default: production=WARN, dev=DEBUG)
 * - NEXUS_LOG_FILE: true/false (default: false)
 * - NEXUS_LOG_FILE_PATH: path to log file (default: ~/Library/Logs/nexus-ai/addon.log)
 */

import * as os from 'os';
import * as path from 'path';

export interface LogConfig {
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  toFile: boolean;
  filePath?: string;
}

export function getLogConfig(): LogConfig {
  const level = (process.env.NEXUS_LOG_LEVEL?.toUpperCase() as LogConfig['level']) ||
    (process.env.NODE_ENV === 'production' ? 'WARN' : 'DEBUG');

  const toFile = process.env.NEXUS_LOG_FILE === 'true';

  let filePath: string | undefined;
  if (toFile) {
    if (process.env.NEXUS_LOG_FILE_PATH) {
      filePath = process.env.NEXUS_LOG_FILE_PATH;
    } else {
      const platform = os.platform();
      if (platform === 'darwin') {
        filePath = path.join(os.homedir(), 'Library', 'Logs', 'nexus-ai', 'addon.log');
      } else if (platform === 'win32') {
        filePath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Nexus AI', 'addon.log');
      } else {
        filePath = path.join(os.homedir(), '.config', 'nexus-ai', 'addon.log');
      }
    }
  }

  return { level, toFile, filePath };
}
