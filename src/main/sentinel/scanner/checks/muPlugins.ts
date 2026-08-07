import { FileSource } from '../FileSource';

/**
 * FS-01 — unexpected PHP in mu-plugins/, read as bytes.
 *
 * This is the check the whole byte-scanner argument rests on. Today it runs as `wp_eval` with
 * `skip_plugins: true`, and that flag does not do what the call site assumes: WP-CLI implements
 * `--skip-plugins` as four filters on `active_plugins`, while `wp-settings.php` includes every
 * mu-plugin from the filesystem with no gate at all. So FS-01 currently *executes the mu-plugin
 * webshell it is looking for*, and anything that ran at mu-plugin time can rewrite the answer on
 * its way out — demonstrated with an `ob_start()` rewriter turning BACKDOOR-PRESENT into clean.
 *
 * `SentinelExecutor` already says this in a comment and routes *deletion* through raw SSH for
 * exactly this reason. Detection never got the same treatment. This is that treatment.
 *
 * Deliberately reproduces the existing detection semantics — non-recursive, `*.php` only — so
 * that any behaviour difference in this port is a bug rather than a feature. The known gaps are
 * recorded on the result as `knownGaps` and widened in a separate, labelled change:
 *
 *   - non-recursive: `mu-plugins/<dir>/payload.php` is invisible. WordPress's own
 *     `wp_get_mu_plugins()` is also non-recursive, but a top-level stub that `include`s a
 *     subdirectory file executes fine, so the gap is real.
 *   - `.php` only: a payload in `z.ico` pulled in by a 21-byte `index.php` stub is missed.
 */

export interface MuPluginFinding {
  path: string;
  name: string;
  sizeBytes: number;
  mtimeMs: number | null;
  isSymbolicLink: boolean;
}

export interface MuPluginResult {
  /** Files present that are not on the allowlist. */
  unexpected: MuPluginFinding[];
  /** Every .php file seen, for coverage reporting. */
  examined: number;
  /**
   * False when the directory could not be read at all. A missing mu-plugins directory is normal
   * and yields ok:true with zero findings; an *unreadable* one must not.
   */
  ok: boolean;
  /** Present when ok is false — the reason, for the report. */
  error?: string;
  /** True when mu-plugins does not exist. Normal, and distinct from "could not read it". */
  absent: boolean;
  knownGaps: string[];
}

const KNOWN_GAPS = [
  'non-recursive: a payload in a mu-plugins subdirectory is not examined',
  'extension-scoped: only *.php is examined, so an included non-PHP payload is not seen',
];

/**
 * @param allowlist Filenames the host and this addon install. Case-sensitive, matching the PHP
 *   original's `in_array` semantics — see the note in agent.js about `getExtension()` preserving
 *   case, which the current implementation is inconsistent about.
 */
export async function checkMuPlugins(
  source: FileSource,
  muPluginDir: string,
  allowlist: ReadonlySet<string>,
): Promise<MuPluginResult> {
  const base = {
    unexpected: [] as MuPluginFinding[],
    examined: 0,
    knownGaps: KNOWN_GAPS,
  };

  if (!(await source.exists(muPluginDir))) {
    // A site with no mu-plugins directory is ordinary. Say so explicitly rather than returning
    // an empty result that reads identically to "scanned and found nothing".
    return { ...base, ok: true, absent: true };
  }

  let entries;
  try {
    entries = await source.readdir(muPluginDir);
  } catch (err) {
    return { ...base, ok: false, absent: false, error: (err as Error).message };
  }

  const unexpected: MuPluginFinding[] = [];
  let examined = 0;

  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.php')) continue;
    // Match the original's glob, which lists files only.
    if (!entry.isFile && !entry.isSymbolicLink) continue;
    examined++;
    if (allowlist.has(entry.name)) continue;

    const stat = await source.lstat(entry.path);
    unexpected.push({
      path: entry.path,
      name: entry.name,
      sizeBytes: stat?.size ?? 0,
      mtimeMs: stat?.mtimeMs ?? null,
      isSymbolicLink: entry.isSymbolicLink,
    });
  }

  return { ...base, unexpected, examined, ok: true, absent: false };
}
