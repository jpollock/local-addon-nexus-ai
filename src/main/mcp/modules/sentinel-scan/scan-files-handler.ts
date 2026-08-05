import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { scanLocalSite } from '../../../sentinel/scanner';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Byte-level filesystem scan of a local WordPress install.
 *
 * Deliberately does NOT use withSiteRunning, unlike every other site tool. The site must stay
 * stopped: this reads bytes, and starting a possibly-compromised site to inspect it is the
 * problem this check exists to avoid. Tier 2's current path starts the site, clones it (four
 * `wp search-replace` runs) and only then inspects — so it inspects a mutated copy, having
 * already executed whatever was in it.
 *
 * Tier 1 in TIER_OVERRIDES. `getToolSafety` falls back to 2 for anything absent, and a fleet
 * sweep at Tier 2 would write a line per site per run to operation-audit.log for a read-only
 * check — swamping the compliance record with no compliance value.
 */
export const scanSiteFilesHandler: McpToolHandler = {
  definition: {
    name: 'scan_site_files',
    description:
      'Byte-level filesystem scan of a local WordPress site — reads files directly, executes no PHP, and does NOT require the site to be running. ' +
      'Currently detects unexpected PHP in mu-plugins (files that load on every request and cannot be deactivated). ' +
      'Prefer this over wp_eval-based checks: WP-CLI --skip-plugins does not skip mu-plugins, so an eval-based check executes the very code it is looking for. ' +
      'Reports what it did NOT examine alongside what it did — a clean result is never evidence that a site is uncompromised.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.siteData,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const report = await scanLocalSite(site);

    if (report.unscannable) {
      // An unscannable install is reported as an error, not as an empty clean result. This is
      // the failure mode the whole scanner is built around: "did not look" must never render
      // the same as "looked and found nothing".
      return error(
        `NOT SCANNED — ${report.site}: ${report.unscannable.reason} (${report.unscannable.detail}). ` +
        `This is not evidence the site is clean; nothing was examined.`,
      );
    }

    const lines: string[] = [`## Byte scan — ${report.site}`, ''];
    lines.push(`Web root: ${report.webRoot}`);
    lines.push(`Duration: ${report.durationMs} ms (site not started, no PHP executed)`);
    lines.push('');

    const mu = report.checks.muPlugins;
    if (mu && !mu.ok) {
      lines.push(`### mu-plugins — UNREADABLE`, `- ${mu.error}`, '');
    } else if (mu?.unexpected.length) {
      lines.push(`### Unexpected mu-plugins (${mu.unexpected.length})`, '');
      lines.push('These load on every request and cannot be deactivated from wp-admin.', '');
      for (const f of mu.unexpected) {
        const when = f.mtimeMs ? new Date(f.mtimeMs).toISOString().slice(0, 19).replace('T', ' ') : 'unknown';
        lines.push(`- \`${f.path}\` — ${f.sizeBytes} bytes, modified ${when}${f.isSymbolicLink ? ' (SYMLINK)' : ''}`);
      }
      lines.push('');
    } else {
      lines.push('### mu-plugins', '', 'No unexpected files.', '');
    }

    lines.push('### Examined', '');
    for (const c of report.coverage) lines.push(`- ${c}`);
    lines.push('');
    lines.push('### NOT examined', '');
    for (const n of report.notChecked) lines.push(`- ${n}`);

    return ok(lines.join('\n'));
  },
};
