import { McpToolHandler, McpToolResult } from '../../types';
import { resolveAnySite } from '../../site-resolver';
import type { ExtractionCoverage } from '../../../../common/types';

/**
 * The re-index a reader can actually run, per source.
 *
 * `reindex_site` resolves through `resolveLocalSite` and CANNOT serve a WP
 * Engine or external id; `bulk_reindex` routes remote ids through
 * `BulkOperationManager.executeRemote`, where `reindex` is on
 * `REMOTE_SUPPORTED`. Naming the wrong one would be the WP-61 defect exactly:
 * a message whose named tool resolves, runs, and leaves the reader stuck.
 */
const REINDEX_REMEDY: Record<'local' | 'wpe' | 'external', string> = {
  local: 'reindex_site',
  wpe: 'bulk_reindex',
  external: 'bulk_reindex',
};

/**
 * Say how the count was bounded, in the same breath as the count.
 *
 * Three states, and the middle one is the one that used to be invisible:
 *  - recorded + complete — the extractor read past the end and saw it.
 *  - recorded + incomplete — it stopped, and why.
 *  - NOT RECORDED — the entry predates coverage tracking. That is not the
 *    same as complete: every WP Engine install indexed before WP-62 holds at
 *    most 200 posts and has no way to say so. The honest form of its number
 *    is "at least this many".
 */
function coverageLines(
  coverage: ExtractionCoverage | undefined,
  source: 'local' | 'wpe' | 'external',
): string[] {
  const remedy = REINDEX_REMEDY[source];

  if (!coverage) {
    return [
      '**Coverage:** not recorded — this index predates coverage tracking, so the '
      + 'counts above are a FLOOR, not a total. Re-index it (`' + remedy + '`) to establish coverage.',
    ];
  }

  const lines: string[] = [];

  if (coverage.complete) {
    lines.push(
      `**Coverage:** complete — ${coverage.rowsReturned >= 0 ? `${coverage.rowsReturned} rows read` : 'whole population read'}`
      + `${coverage.pagesFetched > 1 ? ` over ${coverage.pagesFetched} pages` : ''}, and the end of the population was observed.`
    );
  } else {
    lines.push(
      `**Coverage:** PARTIAL — ${coverage.truncatedDetail ?? coverage.truncatedReason ?? 'extraction stopped early'}. `
      + 'The counts above are a FLOOR, not a total.'
    );
    if (coverage.truncatedReason === 'page-failed') {
      lines.push(`**Fix:** re-run the index (\`${remedy}\`); the page that failed may succeed on a retry.`);
    }
    // A 'max-posts' stop has no remedy the reader can run — the ceiling is a
    // memory constraint in this process, not a setting. Per WP-61, offering a
    // fix that cannot work is worse than offering none.
  }

  if (coverage.customFields === 'collected') {
    lines.push('**Custom fields:** collected — public post meta is part of the searchable text.');
  } else if (coverage.customFields === 'unavailable') {
    lines.push(
      `**Custom fields:** NOT collected — ${coverage.customFieldsDetail ?? 'the bulk meta read failed'}. `
      + 'Searches will not match text held only in custom fields.'
    );
  } else {
    lines.push('**Custom fields:** not attempted — there were no posts to read meta for.');
  }

  return lines;
}

export const getIndexStatusHandler: McpToolHandler = {
  definition: {
    name: 'get_index_status',
    description:
      'Get the content index status for a specific site — document count, chunk count, last indexed timestamp, and index freshness indicator. Use to confirm a site has been indexed before running search_site_content or fleet searches. If the index is stale, trigger a fresh index with reindex_site.' +
      'last indexed time, indexing duration, and current state.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
      },
      required: ['site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    // WP-58: this was local-then-graph, with its own copy of the collision
    // policy. Under the decline that is no longer safe as written — a name in
    // BOTH stores makes the local half return nothing, and the graph half
    // would then answer about the install as if the caller had asked for it.
    // `resolveAnySite` consults both before answering and owns the one policy.
    const resolved = resolveAnySite(args.site as string, services.siteData, (services as any).graphService);
    if (resolved.kind === 'none') {
      return error(`Site "${args.site}" not found`);
    }
    if (resolved.kind === 'ambiguous') {
      return error(
        `"${args.site}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`
      );
    }
    const siteId = resolved.id;
    const siteName = resolved.name;

    const entry = services.indexRegistry.get(siteId);
    if (!entry) {
      return ok(`Site "${siteName}" has not been indexed yet. Start the site to trigger indexing.`);
    }

    // `documentCount` is distinct posts and `chunkCount` is embedded chunks —
    // on every path now, local and remote alike. They were equal on the
    // remote paths only because one post produced one document.
    const lines = [
      `## Index Status: ${siteName}`,
      `**State:** ${entry.state}`,
      `**Documents:** ${entry.documentCount}${entry.coverage?.complete ? '' : ' (at least)'}`,
      `**Chunks:** ${entry.chunkCount}${entry.coverage?.complete ? '' : ' (at least)'}`,
      ...coverageLines(entry.coverage, resolved.source),
      `**Last indexed:** ${entry.lastIndexed ? new Date(entry.lastIndexed).toISOString() : 'never'}`,
      `**Duration:** ${entry.durationMs}ms`,
    ];

    if (entry.error) {
      lines.push(`**Error:** ${entry.error}`);
    }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
