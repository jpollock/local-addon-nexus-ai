/**
 * rendererGql — lightweight GraphQL client for the renderer process.
 *
 * Reads graphql-connection-info.json from Local's data directory (the same
 * file the CLI uses) and performs a direct HTTP POST. This avoids the need
 * for a `nexus:graphql` IPC channel in the main process.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getConnectionInfo(): { url: string; authToken: string } | null {
  const dataDir =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || os.homedir(), 'Local')
      : path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const infoFile = path.join(dataDir, 'graphql-connection-info.json');
  try {
    return JSON.parse(fs.readFileSync(infoFile, 'utf-8'));
  } catch {
    return null;
  }
}

export async function rendererGql<T>(
  query: string,
  variables?: Record<string, unknown>,
  timeout = 10_000,
): Promise<T> {
  const info = getConnectionInfo();
  if (!info) throw new Error('Could not connect to Local. Is Local running?');
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(info.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${info.authToken}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  } finally {
    clearTimeout(id);
  }
}
