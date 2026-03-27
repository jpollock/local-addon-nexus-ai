/**
 * GraphQL server readiness polling
 */

import * as fs from 'fs';
import { getLocalPaths } from './paths';

export interface ConnectionInfo {
  url: string;
  subscriptionUrl: string;
  port: number;
  authToken: string;
}

/**
 * Read GraphQL connection info from graphql-connection-info.json
 */
export function readConnectionInfo(): ConnectionInfo | null {
  const paths = getLocalPaths();

  try {
    if (!fs.existsSync(paths.graphqlConnectionInfoFile)) {
      return null;
    }

    const content = fs.readFileSync(paths.graphqlConnectionInfoFile, 'utf-8');
    const info = JSON.parse(content);

    return {
      url: info.url || `http://127.0.0.1:${info.port}/graphql`,
      subscriptionUrl: info.subscriptionUrl || `ws://127.0.0.1:${info.port}/graphql`,
      port: info.port,
      authToken: info.authToken || '',
    };
  } catch {
    return null;
  }
}

/**
 * Wait for GraphQL server to be ready
 */
export async function waitForGraphQL(
  timeoutMs: number = 30000,
  pollIntervalMs: number = 500
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const connectionInfo = readConnectionInfo();

    if (connectionInfo) {
      try {
        // Use AbortController for per-request timeout (2 seconds)
        const controller = new AbortController();
        const requestTimeout = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(connectionInfo.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${connectionInfo.authToken}`,
          },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: controller.signal,
        });

        clearTimeout(requestTimeout);

        if (response.ok) {
          return true;
        }
      } catch {
        // Server not ready yet - connection refused, timeout, etc.
      }
    }

    await delay(pollIntervalMs);
  }

  return false;
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
