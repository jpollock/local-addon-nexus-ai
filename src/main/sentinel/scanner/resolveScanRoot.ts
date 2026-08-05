import * as fs from 'fs';
import * as path from 'path';

/**
 * Work out where an install actually lives, and where its WordPress directories are.
 *
 * Getting this wrong FAILS OPEN, which is why it returns a typed outcome rather than a string.
 * A scan pointed at a directory that does not exist finds nothing and — without this — reports
 * clean. Every "not found" case below must surface as a finding, never as silence.
 *
 * Two derivations that look obvious and are wrong:
 *
 *   1. `~/Local Sites/<name>/app/public`. On the machine this was written against, 20 of 35
 *      sites live under `~/PW-Local-Functional-Sites` instead. Local records the real location
 *      in sites.json; use it.
 *   2. `site.paths.webRoot`. The field is populated on 0 of 35 records, and LocalSiteInfo does
 *      not even declare it. `site.path` + `app/public` is the derivation that holds.
 *
 * WP_CONTENT_DIR and WPMU_PLUGIN_DIR are read from wp-config.php bytes rather than assumed: a
 * site can relocate wp-content, and `sunrise.php` loads before the constants block in
 * wp-settings.php, so a drop-in can move the mu-plugin directory out from under a hardcoded path.
 */

export type ScanRoot =
  | {
      ok: true;
      /** Absolute path to the web root (contains wp-includes/, wp-admin/). */
      webRoot: string;
      /** Root-relative, forward-slashed. Usually 'wp-content'. */
      contentDir: string;
      /** Root-relative, forward-slashed. Usually 'wp-content/mu-plugins'. */
      muPluginDir: string;
      /** Root-relative. Usually 'wp-content/plugins'. */
      pluginDir: string;
      tablePrefix: string;
      wpVersion: string | null;
    }
  | {
      ok: false;
      /** Machine-readable so callers can distinguish "no such site" from "not WordPress". */
      reason: 'no-such-site' | 'no-web-root' | 'not-wordpress';
      detail: string;
    };

/** Minimal shape needed from Local's site record — matches LocalSiteInfo. */
export interface SiteLike {
  id?: string;
  name?: string;
  path?: string;
}

function readDefine(source: string, constant: string): string | null {
  const re = new RegExp(`define\\s*\\(\\s*['"]${constant}['"]\\s*,\\s*['"](.*?)['"]\\s*\\)`, 'i');
  return source.match(re)?.[1] ?? null;
}

function readTablePrefix(source: string): string {
  return source.match(/\$table_prefix\s*=\s*['"](.*?)['"]/)?.[1] ?? 'wp_';
}

function readWpVersion(webRoot: string): string | null {
  try {
    const src = fs.readFileSync(path.join(webRoot, 'wp-includes', 'version.php'), 'utf8');
    return src.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Turn an absolute directory into a root-relative, forward-slashed path — or null when it sits
 * outside the web root, which a relocated wp-content legitimately can. A caller receiving null
 * must report the directory as unscannable rather than substituting a default.
 */
function toRelative(webRoot: string, abs: string): string | null {
  const rel = path.relative(webRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export function resolveScanRoot(site: SiteLike | null | undefined): ScanRoot {
  if (!site?.path) {
    return { ok: false, reason: 'no-such-site', detail: 'site record has no path' };
  }

  const webRoot = path.join(site.path, 'app', 'public');
  if (!fs.existsSync(webRoot) || !fs.statSync(webRoot).isDirectory()) {
    return { ok: false, reason: 'no-web-root', detail: `${webRoot} does not exist` };
  }

  // The gate. Two of 35 sites on the reference machine are empty shells with an app/public but
  // no WordPress in it; scanning them would produce a confident clean result about nothing.
  if (!fs.existsSync(path.join(webRoot, 'wp-includes', 'version.php'))) {
    return {
      ok: false,
      reason: 'not-wordpress',
      detail: `${webRoot} has no wp-includes/version.php`,
    };
  }

  let config = '';
  for (const candidate of [
    path.join(webRoot, 'wp-config.php'),
    // WordPress falls back to one directory above ABSPATH (wp-load.php), and a wp-config there
    // is a perfectly ordinary layout — missing it means scanning with the wrong constants.
    path.join(path.dirname(webRoot), 'wp-config.php'),
  ]) {
    try { config = fs.readFileSync(candidate, 'utf8'); break; } catch { /* try next */ }
  }

  const contentAbs = readDefine(config, 'WP_CONTENT_DIR') ?? path.join(webRoot, 'wp-content');
  const contentDir = toRelative(webRoot, contentAbs) ?? 'wp-content';

  const muAbs = readDefine(config, 'WPMU_PLUGIN_DIR');
  const muPluginDir = muAbs
    ? (toRelative(webRoot, muAbs) ?? `${contentDir}/mu-plugins`)
    : `${contentDir}/mu-plugins`;

  const pluginAbs = readDefine(config, 'WP_PLUGIN_DIR');
  const pluginDir = pluginAbs
    ? (toRelative(webRoot, pluginAbs) ?? `${contentDir}/plugins`)
    : `${contentDir}/plugins`;

  return {
    ok: true,
    webRoot,
    contentDir,
    muPluginDir,
    pluginDir,
    tablePrefix: readTablePrefix(config),
    wpVersion: readWpVersion(webRoot),
  };
}
