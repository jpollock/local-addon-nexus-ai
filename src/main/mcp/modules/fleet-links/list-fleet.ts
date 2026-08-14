import type { FleetInstall, FleetSiteGroup } from '../../../fleet/types';
import type { McpToolHandler } from '../../types';

/**
 * Installs rendered when the caller gives no limit. Measured against a real
 * account: 340 active installs pretty-printed as JSON was ~132 KB (~33k
 * tokens) in a single tool result. This tool is meant to be called before
 * acting on any site, so its default has to be cheap.
 */
const DEFAULT_LIMIT = 50;

/** Unresolved sites listed inline before we stop and give a count instead. */
const MAX_UNRESOLVED_SHOWN = 10;

function formatAge(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

function formatInstall(install: FleetInstall): string {
  const env = install.environment ?? 'unknown';
  const provenance = `${install.provenance.level} ${formatAge(install.provenance.ageSeconds)}`;
  const sandbox = install.sandbox
    ? `sandbox: ${install.sandbox.localSiteName} (${install.sandbox.linkSource})`
    : 'no sandbox';
  return `- **${install.installName}** (${env}, id: ${install.installId}) — ${install.domain ?? 'no domain'} · ${provenance} · ${sandbox}`;
}

/** Case-insensitive match against the group label, its site id, or any install name. */
function matchesSite(group: FleetSiteGroup, needle: string): boolean {
  const q = needle.toLowerCase();
  if (group.name.toLowerCase().includes(q)) return true;
  if (group.wpeSiteId?.toLowerCase() === q) return true;
  return group.installs.some((i) => i.installName.toLowerCase().includes(q));
}

export const listFleetHandler: McpToolHandler = {
  definition: {
    name: 'nexus_fleet_list',
    description:
      'List WP Engine installs grouped by site, each with its environment, any attached local ' +
      'sandbox, and the provenance (level and age) of the data behind it. Install-grain and ' +
      'WPE-only — use it before acting on a specific install so you know how current the ' +
      'information is. For an open-ended "tell me about my fleet" question use fleet_overview ' +
      'instead. Output is capped; narrow it with site, environment, or limit.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Only show sites matching this name, domain, WPE site id, or install name.',
        },
        environment: {
          type: 'string',
          enum: ['production', 'staging', 'development'],
          description: 'Only show installs in this environment.',
        },
        limit: {
          type: 'number',
          description: `Maximum installs to render (default ${DEFAULT_LIMIT}).`,
        },
      },
    },
    // Hide the tool rather than answer a call with a runtime "not available"
    // string, the way the wpe module hides its tools when CAPI is absent.
    isAvailable: (services) => !!services.fleetAssembler,
    annotations: { readOnlyHint: true },
  },
  async execute(args, services) {
    const assembler = services.fleetAssembler;
    if (!assembler) {
      return {
        content: [{ type: 'text', text: 'Fleet assembler is not available — the graph database may still be initializing.' }],
        isError: true,
      };
    }

    const siteFilter = typeof args.site === 'string' ? args.site : undefined;
    const envFilter = typeof args.environment === 'string' ? args.environment : undefined;
    const rawLimit = typeof args.limit === 'number' ? args.limit : DEFAULT_LIMIT;
    const limit = Math.max(1, Math.floor(rawLimit));

    let groups = await assembler.listFleet();

    if (envFilter) {
      groups = groups
        .map((g) => ({ ...g, installs: g.installs.filter((i) => i.environment === envFilter) }))
        .filter((g) => g.installs.length > 0);
    }
    if (siteFilter) {
      groups = groups.filter((g) => matchesSite(g, siteFilter));
    }

    const totalInstalls = groups.reduce((n, g) => n + g.installs.length, 0);
    const lines: string[] = [];

    if (totalInstalls === 0) {
      lines.push('No WP Engine installs match.');
    } else {
      lines.push(`## Fleet — ${totalInstalls} install(s) across ${groups.length} site(s)`);

      let rendered = 0;
      for (const group of groups) {
        if (rendered >= limit) break;
        lines.push('', `### ${group.name}`);
        for (const install of group.installs) {
          if (rendered >= limit) break;
          lines.push(formatInstall(install));
          rendered++;
        }
      }

      if (rendered < totalInstalls) {
        lines.push(
          '',
          `_Showing ${rendered} of ${totalInstalls} installs. Narrow with \`site\` or \`environment\`, or raise \`limit\`._`,
        );
      }
    }

    // Reconciliation's whole point is telling a human which local sites it
    // could not attach. Counting them into a log line is not a surface anyone
    // can act on, and nexus_link_site is unusable without knowing the site id.
    const unresolved = services.siteLinkResolver?.getLastReport()?.unresolved ?? [];
    if (unresolved.length > 0) {
      lines.push('', `### Unresolved local sites (${unresolved.length})`);
      lines.push('Not matched to any install. Attach one with `nexus_link_site`.');
      for (const site of unresolved.slice(0, MAX_UNRESOLVED_SHOWN)) {
        lines.push(`- ${site.localSiteName} (site: ${site.localSiteId})`);
      }
      if (unresolved.length > MAX_UNRESOLVED_SHOWN) {
        lines.push(`- …and ${unresolved.length - MAX_UNRESOLVED_SHOWN} more`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
