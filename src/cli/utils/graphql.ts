/**
 * GraphQL Client for Nexus CLI
 *
 * Connects to Local's GraphQL server and executes queries/mutations.
 */

import { readConnectionInfo } from '../bootstrap/graphql';
import type { ConnectionInfo } from '../bootstrap/graphql';

export { ConnectionInfo } from '../bootstrap/graphql';

export class GraphQLClientError extends Error {
  constructor(
    message: string,
    public errors?: Array<{ message: string; path?: string[] }>
  ) {
    super(message);
    this.name = 'GraphQLClientError';
  }
}

export class GraphQLClient {
  private connectionInfo: ConnectionInfo;
  private timeout: number;

  constructor(connectionInfo?: ConnectionInfo, options?: { timeout?: number }) {
    this.connectionInfo = connectionInfo || this.loadConnectionInfo();
    this.timeout = options?.timeout || 30000;
  }

  /**
   * Load connection info from Local's userData
   */
  private loadConnectionInfo(): ConnectionInfo {
    const info = readConnectionInfo();
    if (!info) {
      throw new Error(
        'Local is not running or GraphQL server is not ready.\n\n' +
          'Please start Local first, or run with DEBUG=true for more info.'
      );
    }
    return info;
  }

  /**
   * Execute a GraphQL query or mutation
   */
  async query<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    // Try the URL from connection file first, then fallback to port 4000
    // (Local's connection file sometimes has stale ports)
    const urlsToTry = [
      this.connectionInfo.url,
      'http://127.0.0.1:4000/graphql',
    ];

    let lastError: any;

    for (const url of urlsToTry) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      console.error('[GraphQL Client] Attempting fetch to:', url);
      console.error('[GraphQL Client] Has auth token:', !!this.connectionInfo.authToken);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.connectionInfo.authToken}`,
          },
          body: JSON.stringify({
            query,
            variables: variables || {},
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new GraphQLClientError(
            `HTTP ${response.status}: ${response.statusText}`
          );
        }

        const result = await response.json();

        // Check for GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const error = result.errors[0];
          throw new GraphQLClientError(error.message, result.errors);
        }

        // Check for missing data
        if (result.data === null || result.data === undefined) {
          throw new GraphQLClientError('No data in response');
        }

        // Success - update connection info to use working URL
        if (url !== this.connectionInfo.url) {
          console.error('[GraphQL Client] Using fallback URL:', url);
          this.connectionInfo.url = url;
        }

        return result.data as T;
      } catch (error: any) {
        lastError = error;
        clearTimeout(timeoutId);

        // If this was an abort (timeout), don't try other URLs
        if (error.name === 'AbortError') {
          throw new GraphQLClientError(
            `Request timed out after ${this.timeout / 1000}s`
          );
        }

        // If GraphQL error (server responded but query failed), don't try other URLs
        if (error instanceof GraphQLClientError && !error.message.includes('Network')) {
          throw error;
        }

        // Network error - try next URL
        console.error('[GraphQL Client] Failed, trying next URL...');
      }
    }

    // All URLs failed - throw last error
    console.error('[GraphQL Client] All URLs failed. Last error:', {
      name: lastError?.name,
      message: lastError?.message,
      code: lastError?.code,
    });

    if (lastError instanceof GraphQLClientError) {
      throw lastError;
    }
    throw new GraphQLClientError(`Network error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Execute a GraphQL mutation (alias for query)
   */
  async mutate<T = any>(mutation: string, variables?: Record<string, any>): Promise<T> {
    return this.query<T>(mutation, variables);
  }
}

/**
 * Get a GraphQL client instance
 */
export function getClient(options?: { timeout?: number }): GraphQLClient {
  // Try to use connection info from bootstrap context if available
  try {
    const { getConnectionInfo } = require('./context');
    const connectionInfo = getConnectionInfo();
    return new GraphQLClient(connectionInfo, options);
  } catch {
    // Fallback to loading from file system (for commands that skip bootstrap)
    return new GraphQLClient(undefined, options);
  }
}
