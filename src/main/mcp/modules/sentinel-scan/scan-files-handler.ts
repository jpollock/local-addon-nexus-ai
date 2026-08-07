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
      'Byte-level scan of a local WordPress site — reads files and its mysqldump directly, executes no PHP, and does NOT require the site to be running. ' +
      'Always detects unexpected PHP in mu-plugins. With deep=true, also covers obfuscation chains, unexpected web-root/uploads PHP, ELF binaries, ' +
      'suspicious plugin filenames, anti-forensics timestamp manipulation, .htaccess/.user.ini/php.ini directives, and — reading app/sql/local.sql when the site ' +
      'is halted and the dump is fresh — injected post content, suspicious autoloaded options, serialized objects in admin usermeta, and spam comments. ' +
      'Prefer this over wp_eval-based checks: WP-CLI --skip-plugins does not skip mu-plugins, so an eval-based check executes the very code it is looking for. ' +
      'Reports what it did NOT examine alongside what it did — a clean result is never evidence that a site is uncompromised.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        deep: {
          type: 'boolean',
          description:
            'Also walk wp-content for obfuscation chains, unexpected web-root PHP, PHP under uploads, and ELF binaries. '
            + 'Roughly 25x slower (~1.4s vs ~1.6ms per site), so it is off by default and belongs to an escalated or explicitly scoped scan, not a fleet sweep.',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.siteData,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const report = await scanLocalSite(site, { deep: args.deep === true });

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

    const fsr = report.checks.filesystem;
    if (fsr) {
      const section = (title: string, items: string[]) => {
        lines.push(`### ${title} (${items.length})`, '');
        if (items.length === 0) lines.push('None.', '');
        else { for (const i of items.slice(0, 100)) lines.push(`- ${i}`); 
               if (items.length > 100) lines.push(`- …and ${items.length - 100} more`);
               lines.push(''); }
      };
      section('Obfuscation chains (FS-02)', fsr.obfuscation.map((h) => `\`${h.file}\` — ${h.pattern}`));
      section('Unexpected web-root / content PHP (FS-03)', fsr.rootAndContent.map((h) => `\`${h.path}\` — ${h.reason}`));
      section('PHP under uploads (FS-04)', fsr.uploadsPhp.map((p) => `\`${p}\``));
      section('ELF binaries (FS-06)', fsr.elf.map((h) => `\`${h.path}\` — ${h.size} bytes`));
      section('Suspicious filenames in plugins (ABS-09)', fsr.suspiciousFilenames.map((p) => `\`${p}\``));
      section('Anti-forensics timestamp manipulation (ABS-08)', fsr.antiForensics.map((h) => `\`${h.path}\``));
    }

    // Findings computed in deep mode alongside filesystem, but never rendered — a caller
    // reading only the sections above would never see a directive-file compromise even though
    // it was already detected.
    const dir = report.checks.directives;
    if (dir) {
      const section = (title: string, items: string[]) => {
        lines.push(`### ${title} (${items.length})`, '');
        if (items.length === 0) lines.push('None.', '');
        else { for (const i of items.slice(0, 100)) lines.push(`- ${i}`);
               if (items.length > 100) lines.push(`- …and ${items.length - 100} more`);
               lines.push(''); }
      };
      // FS-05 covered only .htaccess originally; .user.ini and php.ini are new coverage this
      // scanner added, not a port of an existing signal ID — labelling the whole section FS-05
      // would misattribute that new detection to an old one.
      section(
        'Directive files — .htaccess (FS-05) / .user.ini / php.ini',
        dir.findings.map((f) => `\`${f.path}\` — ${f.reason}: ${f.snippet}`),
      );
    }

    const db = report.checks.database;
    if (db && !db.ok) {
      lines.push(`### Database — NOT EXAMINED`, `- ${db.reason}: ${db.detail}`, '');
    } else if (db) {
      // Same `### <title> (<ID>) (<count>)` shape as the filesystem sections above — runByteScan's
      // deep-mode parser bounds each section on a sibling `### ` heading, so these must stay flat
      // (no nested subheadings) for it to find them. The dump's `asOf`/lag already appear in the
      // "Examined" section below via report.coverage; not repeated here.
      const section = (title: string, items: string[]) => {
        lines.push(`### ${title} (${items.length})`, '');
        if (items.length === 0) lines.push('None.', '');
        else { for (const i of items) lines.push(`- ${i}`); lines.push(''); }
      };
      // Backtick-wrapped key + " — " + description, same shape the filesystem sections above
      // use — runByteScan's shared item parser requires it (`- \`key\` — detail`) and silently
      // finds zero items for a line that doesn't match, which a plain-text render did.
      // `ID:${id}` (no space before the digits) is a load-bearing format, not decoration:
      // buildRemediationChecklist's Step 5d extracts post IDs to delete via /ID:(\d+)/ against
      // this exact evidence string. An earlier render used `post ${id}` instead — Step 5d's
      // regex found nothing, so it silently dropped out of the checklist on every run, on a
      // verdict that still said READY TO PUSH (DB-01 is 'high', not 'critical', so its absence
      // never blocked the gate) while the 12 flagged spam posts were never actually deleted.
      section('Suspicious post content (DB-01)',
        db.posts.suspicious.map((p) => `\`ID:${p.id}\` — [${p.status}] "${p.title}" (${p.date}) — ${p.reasons.join(', ')}`));
      section('Suspicious autoloaded options (DB-02)',
        db.options.suspicious.map((o) => `\`${o.name}\` — ${o.snippet.slice(0, 80)}...`));
      section('Serialized objects in admin usermeta (DB-03)',
        db.usermeta.suspicious.map((m) => `\`user ${m.userId} / ${m.key}\` — ${m.snippet}`));
      section('Spam content in comments (DB-04)',
        db.comments.suspicious.map((c) => `\`comment ${c.id}\` — by "${c.author}" (${c.date}): ${c.snippet}`));
    }

    lines.push('### Examined', '');
    for (const c of report.coverage) lines.push(`- ${c}`);
    lines.push('');
    lines.push('### NOT examined', '');
    for (const n of report.notChecked) lines.push(`- ${n}`);

    return ok(lines.join('\n'));
  },
};
