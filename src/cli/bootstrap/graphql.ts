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

    // Local's connection file sometimes has stale ports - default to port 4000
    const defaultUrl = 'http://127.0.0.1:4000/graphql';
    const defaultPort = 4000;

    return {
      url: info.url || defaultUrl,
      subscriptionUrl: info.subscriptionUrl || `ws://127.0.0.1:${info.port || defaultPort}/graphql`,
      port: info.port || defaultPort,
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
      // Try both the URL from the connection file AND port 4000 as fallback
      // (Local's connection file sometimes has stale ports)
      const urlsToTry = [
        connectionInfo.url,
        'http://127.0.0.1:4000/graphql',
      ];

      for (const url of urlsToTry) {
        try {
          // Use AbortController for per-request timeout (2 seconds)
          const controller = new AbortController();
          const requestTimeout = setTimeout(() => controller.abort(), 2000);

          const response = await fetch(url, {
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
            // Update connection info to use the working URL
            if (url !== connectionInfo.url) {
              connectionInfo.url = url;
            }
            return true;
          }
        } catch {
          // Server not ready yet - connection refused, timeout, etc.
        }
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
