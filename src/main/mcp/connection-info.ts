import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConnectionInfo } from './types';
import { MCP_CONNECTION_INFO_FILE } from '../../common/constants';

function getLocalDataDir(): string {
  const platform = os.platform();
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  }
  if (platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Local');
  }
  // Linux
  return path.join(os.homedir(), '.config', 'Local');
}

function getConnectionInfoPath(): string {
  return path.join(getLocalDataDir(), MCP_CONNECTION_INFO_FILE);
}

export function saveConnectionInfo(info: ConnectionInfo): void {
  const filePath = getConnectionInfoPath();
  fs.writeFileSync(filePath, JSON.stringify(info, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function loadConnectionInfo(): ConnectionInfo | null {
  const filePath = getConnectionInfoPath();
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as ConnectionInfo;
  } catch {
    return null;
  }
}

export function deleteConnectionInfo(): void {
  const filePath = getConnectionInfoPath();
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist
  }
}
