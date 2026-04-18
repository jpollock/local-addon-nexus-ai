/**
 * REST API route: search
 *
 * GET /api/v1/search?q=...&limit=...  — semantic search results
 */

import type { NexusServices } from '../../types/nexus-services';

export async function handleSearch(
  query: string,
  limit: number,
  services: NexusServices,
): Promise<unknown[]> {
  const { registry } = services;

  if (!registry) {
    return [];
  }

  const result = await registry.call(
    'search_sites',
    { query, limit },
    services as any,
    'cli',
  );

  // The MCP tool returns markdown text — extract any structured data if present.
  // For REST purposes, return the raw text content as a single result item.
  if (result.isError) {
    return [];
  }

  const text = result.content?.[0]?.text ?? '';

  // Return structured form: one item per non-empty line that looks like a result
  return [{ text, query, limit }];
}
