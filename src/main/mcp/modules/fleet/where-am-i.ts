/**
 * nexus_where_am_i — WP-21's first consumer of the task frame.
 *
 * "Where am I?" was unanswerable until this packet: the copy's identity, the Site
 * it belongs to, what it follows and how old its content is were spread across
 * the entity links, the sync events and the twins, with nothing composing them.
 * The frame plus WP-15's comparator is all four lines of surface contract S3, so
 * this tool is a rendering, not a computation (`intelligence-host/siteStatus.ts`).
 *
 * **The name is `nexus_where_am_i`, not `nexus_site_status`.** The packet named
 * the latter; that tool already exists (`modules/site-context/site-status.ts`) and
 * answers a different question — what cached data the twin holds and how fresh it
 * is — with two GraphQL resolvers and the CLI calling it by name. Registering a
 * second handler under that name would have replaced a live tool. The user-facing
 * vocabulary for this concept is "site status" *or* "where am I?"; the second is
 * the half that was still free, and it is also what a model matches on when a user
 * types the question.
 *
 * Read-only and Tier 1: an absent tier entry defaults to Tier 2, which would write
 * a durable audit line every time somebody asked where they were standing.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveLocalSite } from '../../site-resolver';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { siteStatus } from '../../../intelligence-host/siteStatus';
import { describeEnvironmentsFor } from '../../../intelligence-host/taskFrame';

/**
 * What the answer says when the record-keeping layer is not running.
 *
 * Deliberately NOT the "no recorded sync" sentence: that one claims the records
 * were consulted and held nothing, which is a fact about the copy. This is a fact
 * about Nexus AI, it has a different remedy, and conflating the two would put a
 * false all-clear in front of a user about to trust their content's age.
 */
const NOT_RECORDING =
  'Nexus AI is not recording right now, so where this copy\'s content came from and how old ' +
  'it is cannot be answered. Run nexus_intelligence_health to see why.';

export const whereAmIHandler: McpToolHandler = {
  definition: {
    name: 'nexus_where_am_i',
    description:
      'Answer "where am I?" for a Local site: that it is a safe copy, which branch its code is ' +
      'on when that is on record, where its content was pulled from and how long ago, and the ' +
      'guarantee that nothing done here touches the live site. Call it when someone asks where ' +
      'they are, what they are working on, whether it is safe to change something, how old this ' +
      "site's content is, or what this copy is connected to. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    annotations: { readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveLocalSite(args.site as string, services.siteData, services.graphService);
    if (!site) return error(`Site "${args.site}" not found`);

    const core = getIntelligenceCore();
    if (!core) {
      return ok(
        [
          `You're in a safe copy of ${site.name}.`,
          'Nothing you do here touches the live site.',
          '',
          NOT_RECORDING,
        ].join('\n')
      );
    }

    try {
      const status = siteStatus({
        core,
        localSiteId: site.id,
        siteName: site.name,
        describeEnvironment: await describeEnvironmentsFor(services),
      });
      return ok(status.lines.join('\n'));
    } catch (err) {
      // Non-fatal by construction: the two structural truths still hold, and the
      // reason the rest is missing is named rather than left as silence.
      return ok(
        [
          `You're in a safe copy of ${site.name}.`,
          'Nothing you do here touches the live site.',
          '',
          `The rest of this site's status could not be worked out: ${
            (err as Error)?.message ?? String(err)
          }`,
        ].join('\n')
      );
    }
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
