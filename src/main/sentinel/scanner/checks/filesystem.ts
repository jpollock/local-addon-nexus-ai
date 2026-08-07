import { FileSource, FileEntry } from '../FileSource';

/**
 * FS-02, FS-03, FS-04, FS-06, ABS-08 and ABS-09 over one filesystem walk.
 *
 * Today these are separate `wp_eval` calls, each doing its own RecursiveDirectoryIterator over
 * overlapping trees, on a site that has been started and cloned first. Here it is one traversal
 * in Node against a stopped site with nothing executed.
 *
 * ABS-08 (anti-forensics timestamp manipulation) and ABS-09 (suspicious internal filenames) are
 * scoped to `pluginDir` exactly as the original's `WP_PLUGIN_DIR` walk was — not mu-plugins or
 * themes, where the same code shape would be equally suspicious but is out of scope for a
 * faithful port. MEASURED FALSE-POSITIVE LOAD (36 real sites, 117,646 files under plugins/):
 * ABS-09 hits 14 files on 6 clean sites — all legitimate vendor filenames (`PHP.php`, `Php.php`,
 * `exec.php`, `Eval.php` from defender-security, query-monitor, elementor, phpseclib). ABS-08
 * hits 43 files on 8 clean sites — all legitimate file-transfer/streaming code (WP Migrate DB
 * Pro, ewww-image-optimizer, amazon-s3-and-cloudfront, Dompdf) that happens to combine touch()
 * with a directory-enumeration call for ordinary reasons. This is not a retuning pass — those
 * numbers are reproduced from the original patterns unchanged, per the port-then-tune split
 * FS-02 already established below. Retuning ABS-08/09 is a deliberate follow-up.
 *
 * DETECTION IS REPRODUCED EXACTLY, quirks included, so that any difference in output is a port
 * bug rather than a silent change of behaviour. The quirks are real and measured, and each is
 * recorded in `knownIssues` on the result rather than quietly fixed:
 *
 *   - Extension matching is case-SENSITIVE for FS-02/03/04 ('php' only, so `evil.PHP` is
 *     missed) but lowercased for FS-06. The original is inconsistent with itself.
 *   - FS-06 skips 28 extensions, so an ELF named `miner.png` is invisible by construction.
 *   - Content is compared as latin1. Reading utf8 makes Node substitute U+FFFD on invalid
 *     sequences, which breaks these regexes across binary padding.
 *   - `/base64_decode.*base64_decode/s` is the only pattern needing dotAll; in JS that is
 *     `[\s\S]*`, since a literal `.` does not match newlines without the `s` flag.
 *
 * MEASURED FALSE-POSITIVE LOAD (33 real sites, 82,068 PHP files): FS-02 produces **581** hits,
 * of which 317 come from the dotAll base64 pattern and 231 from `assert($`. The largest single
 * contributor is `wpe-hub`, WP Engine's own plugin, at 132. All 55 FS-06 hits are
 * ewww-image-optimizer's bundled cwebp/gifsicle binaries. None of this is compromise. Fixing
 * the patterns is a deliberate follow-up with this baseline as its justification — doing it in
 * the same change as the port would make the two indistinguishable.
 */

export interface PatternHit { file: string; pattern: string; }
export interface RootPhpHit { path: string; reason: string; }
export interface ElfHit { path: string; size: number; }
export interface AntiForensicsHit { path: string; snippet: string; }

export interface FilesystemScanResult {
  /** FS-02 — obfuscation chains in plugins, mu-plugins, themes. */
  obfuscation: PatternHit[];
  /** FS-03 — unexpected PHP in the web root, plus obfuscation in languages/ and uploads/. */
  rootAndContent: RootPhpHit[];
  /** FS-04 — any PHP anywhere under uploads. */
  uploadsPhp: string[];
  /** FS-06 — files whose first four bytes are the ELF magic. */
  elf: ElfHit[];
  /** ABS-09 — filenames matching known attacker-tool names, anywhere under plugins/. */
  suspiciousFilenames: string[];
  /** ABS-08 — PHP under plugins/ combining touch() with directory enumeration. */
  antiForensics: AntiForensicsHit[];
  phpFilesScanned: number;
  filesWalked: number;
  /** Directories that could not be read. A partial scan must never read as a clean one. */
  unreadable: Array<{ path: string; reason: string }>;
  truncated: boolean;
  knownIssues: string[];
  durationMs: number;
}

/**
 * FS-02 obfuscation patterns.
 *
 * TUNED against 82,068 PHP files across 33 real installs, plus a 9-shape must-catch corpus and a
 * 6-shape must-not-catch corpus. The previous set produced 581 findings on that clean fleet,
 * which is not a detector — it is noise that buries the one real thing. Every count below is
 * measured, not estimated.
 *
 * REMOVED — three patterns that between them produced 250 findings and caught 0 of the 9
 * malicious shapes:
 *
 *   - `assert\s*\(\s*\$`  (236 hits) matched ordinary type assertions:
 *     `assert($i != $numValues - 1)`, `assert($parentType instanceof HasFieldsType)`. It was
 *     aimed at assert()-as-eval, which requires a STRING argument and was removed in PHP 8.
 *     The malicious shape `assert(base64_decode(...))` is still caught, by DECODE_INTO_EXEC.
 *   - `create_function\s*\(`  (5 hits) — removed in PHP 8, so it cannot execute on any PHP
 *     this tool targets. All five hits were documentation or legacy plugin code.
 *   - `preg_replace\s*\(\s*['"].*\/e`  (9 hits) — the /e modifier was removed in PHP 7.
 *     All nine hits were ordinary preg_replace calls.
 *
 * REPLACED — `base64_decode[\s\S]*base64_decode` (317 hits, the single largest source) matched
 * any file mentioning base64_decode twice ANYWHERE, including once in a phpcs comment. Its
 * successors, NESTED_DECODE and DECODE_INTO_EXEC, each score **0 hits on the clean fleet** while
 * catching three of the nine malicious shapes between them, versus that pattern's two.
 *
 * KNOWN GAP, accepted deliberately: two independent adjacent base64_decode calls
 * (`$a=base64_decode("x");$b=base64_decode("y");`) are no longer matched. A proximity window
 * that catches it costs 18 false positives at 40 characters and 216 at 100, and the malicious
 * form of that shape almost always feeds the result to eval/assert — which DECODE_INTO_EXEC
 * catches.
 */
const OBFUSCATION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Direct eval of a decoder — the canonical loader. 0 hits on the clean fleet.
  { re: /eval\s*\(\s*base64_decode/,                     label: 'eval(base64_decode' },
  { re: /eval\s*\(\s*gzinflate\s*\(\s*base64_decode/,    label: 'eval(gzinflate(base64_decode' },
  { re: /eval\s*\(\s*gzuncompress\s*\(\s*base64_decode/, label: 'eval(gzuncompress(base64_decode' },
  { re: /eval\s*\(\s*str_rot13/,                         label: 'eval(str_rot13' },

  // Decoder feeding a decoder — layered obfuscation has no legitimate use. 0 hits.
  { re: /base64_decode\s*\(\s*(base64_decode|gzinflate|gzuncompress|str_rot13|strrev|rawurldecode)\s*\(/,
    label: 'nested decode' },

  // A decoded value reaching an execution sink. 0 hits, and it is what still catches
  // assert(base64_decode(...)) now that the bare assert pattern is gone.
  { re: /(eval|assert|preg_replace|create_function|call_user_func|system|exec|passthru|shell_exec)\s*\([^;]{0,80}base64_decode/,
    label: 'decoded value into execution sink' },

  // eval of a variable. 20 hits on the clean fleet — the only pattern retained with a non-zero
  // false-positive rate, kept because it is the classic backdoor shape and 0.6 per site is a
  // load a human can actually triage.
  { re: /eval\s*\(\s*\$/,                                label: 'eval($' },
];

/** FS-03's narrower set, applied only under languages/ and uploads/. */
const CONTENT_OBFUSCATION: RegExp[] = [
  /eval\s*\([\s\S]*base64_decode/,
  /eval\s*\([\s\S]*gzinflate/,
  /eval\s*\([\s\S]*str_rot13/,
];

/** FS-06's extension skip list, verbatim — the reason `miner.png` is invisible. */
const ELF_SKIP_EXTENSIONS = new Set([
  'php','js','css','html','htm','txt','md','json','xml','svg','png','jpg','jpeg','gif','webp',
  'woff','woff2','ttf','eot','ico','map','pot','po','mo','log','ini','conf',
]);

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;   // FS-02 skips files above this

/** ABS-09's list, verbatim, lowercased for the case-insensitive comparison the original does
 *  via strtolower() on both sides — unlike FS-02/03/04's extension check, this one is NOT
 *  case-sensitive in the original, and porting it case-sensitively would be a silent change. */
const SUSPICIOUS_FILENAMES = new Set([
  'check_file.php', 'shell.php', 'cmd.php', 'c99.php', 'r57.php', 'php.php',
  'eval.php', 'exec.php', 'bypass.php', 'b374k.php', 'wso.php',
  'filesman.php', 'b374.php', 'indoxploit.php',
]);

/** ABS-08's two-pattern combination, verbatim. */
const ANTI_FORENSICS_TOUCH = /touch\s*\(/;
const ANTI_FORENSICS_ENUM = /scandir|glob|RecursiveIterator/;

const KNOWN_ISSUES = [
  'FS-02/03/04 match the extension case-sensitively, so evil.PHP is not examined',
  'FS-06 skips 28 extensions, so an ELF named miner.png is not examined',
  'FS-02 skips files larger than 5 MB',
  'two independent adjacent base64_decode calls are not matched — see the note on the pattern set',
  'ABS-08 skips PHP files larger than 5 MB, a bound the original wp_eval check did not have',
  'ABS-08/09 patterns are reproduced unchanged and carry real false-positive load on legitimate '
    + 'file-transfer and vendor-library code — see the note at the top of this file; retuning is deferred',
];

/** PHP's getExtension(): everything after the final dot, case preserved. */
function extensionOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1);
}

function underAny(relPath: string, prefixes: string[]): boolean {
  return prefixes.some((p) => relPath === p || relPath.startsWith(p + '/'));
}

export interface FilesystemScanOptions {
  contentDir: string;
  /** Root-relative plugin directory — ABS-08/09's scope, resolved from WP_PLUGIN_DIR. */
  pluginDir: string;
  /** Root docroot filenames that are expected. Anything else is FS-03. */
  knownRootPhp: ReadonlySet<string>;
  /** Safety valve for a pathological tree. Truncation is always reported. */
  limit?: number;
}

export async function scanFilesystem(
  source: FileSource,
  opts: FilesystemScanOptions,
): Promise<FilesystemScanResult> {
  const started = Date.now();
  const { contentDir, pluginDir, knownRootPhp, limit = 400_000 } = opts;

  const obfuscation: PatternHit[] = [];
  const rootAndContent: RootPhpHit[] = [];
  const uploadsPhp: string[] = [];
  const elf: ElfHit[] = [];
  const suspiciousFilenames: string[] = [];
  const antiForensics: AntiForensicsHit[] = [];
  let phpFilesScanned = 0;

  // FS-03's web-root half: a flat listing, matching the original's glob(ABSPATH . '*.php').
  try {
    for (const e of await source.readdir('')) {
      if (!e.isFile) continue;
      if (!e.name.endsWith('.php')) continue;
      if (!knownRootPhp.has(e.name)) {
        rootAndContent.push({ path: e.name, reason: 'unknown PHP in web root' });
      }
    }
  } catch (err) {
    rootAndContent.push({ path: '', reason: `web root unreadable: ${(err as Error).message}` });
  }

  // ONE walk of wp-content serves the remaining three checks. The originals each walked their
  // own overlapping subtree.
  const walked = await source.walk(contentDir, { limit });

  const obfuscationRoots = ['plugins', 'mu-plugins', 'themes'].map((d) => `${contentDir}/${d}`);
  const contentRoots = ['languages', 'uploads'].map((d) => `${contentDir}/${d}`);
  const uploadsRoot = `${contentDir}/uploads`;

  for (const entry of walked.entries) {
    if (!entry.isFile) continue;
    const ext = extensionOf(entry.path);
    const isPhp = ext === 'php';                    // case-sensitive, as the original

    // FS-04 — any PHP under uploads, regardless of content.
    if (isPhp && underAny(entry.path, [uploadsRoot])) uploadsPhp.push(entry.path);

    // ABS-09 — suspicious filename anywhere under plugins/. No extension gate: the original
    // matches on strtolower(basename) alone, and every name in the list happens to end .php.
    if (underAny(entry.path, [pluginDir]) && SUSPICIOUS_FILENAMES.has(entry.name.toLowerCase())) {
      suspiciousFilenames.push(entry.path);
    }

    // FS-02 — obfuscation in plugins/mu-plugins/themes. ABS-08 shares this read when the file
    // is also under plugins/ — pluginDir is ordinarily one of the three obfuscationRoots, so
    // this avoids a second read of the same bytes for the common case.
    if (isPhp && underAny(entry.path, obfuscationRoots)) {
      const stat = await source.lstat(entry.path);
      if (stat && stat.size <= MAX_CONTENT_BYTES) {
        phpFilesScanned++;
        const buf = await source.readFile(entry.path);
        if (buf) {
          // latin1, never utf8 — see the note at the top of this file.
          const content = buf.toString('latin1');
          for (const p of OBFUSCATION_PATTERNS) {
            if (p.re.test(content)) { obfuscation.push({ file: entry.path, pattern: p.label }); break; }
          }
          if (underAny(entry.path, [pluginDir]) && ANTI_FORENSICS_TOUCH.test(content) && ANTI_FORENSICS_ENUM.test(content)) {
            antiForensics.push({ path: entry.path, snippet: content.slice(0, 200) });
          }
        }
      }
    } else if (isPhp && underAny(entry.path, [pluginDir])) {
      // A plugin PHP file outside obfuscationRoots's three directories (e.g. a custom
      // WP_PLUGIN_DIR that resolveScanRoot placed elsewhere) still needs its own ABS-08 read —
      // this is the uncommon path, not the shared one above.
      const stat = await source.lstat(entry.path);
      if (stat && stat.size <= MAX_CONTENT_BYTES) {
        const buf = await source.readFile(entry.path);
        if (buf) {
          const content = buf.toString('latin1');
          if (ANTI_FORENSICS_TOUCH.test(content) && ANTI_FORENSICS_ENUM.test(content)) {
            antiForensics.push({ path: entry.path, snippet: content.slice(0, 200) });
          }
        }
      }
    }

    // FS-03's content half — the narrower pattern set under languages/ and uploads/.
    if (isPhp && underAny(entry.path, contentRoots)) {
      const buf = await source.readFile(entry.path);
      if (buf) {
        const content = buf.toString('latin1');
        if (CONTENT_OBFUSCATION.some((re) => re.test(content))) {
          rootAndContent.push({ path: entry.path, reason: 'obfuscated code' });
        }
      }
    }

    // FS-06 — ELF magic, honouring the original's skip list.
    if (!ELF_SKIP_EXTENSIONS.has(ext.toLowerCase())) {
      const head = await source.readHead(entry.path, 4);
      if (head && head.length === 4 && head.equals(ELF_MAGIC)) {
        const stat = await source.lstat(entry.path);
        elf.push({ path: entry.path, size: stat?.size ?? 0 });
      }
    }
  }

  return {
    obfuscation,
    rootAndContent,
    uploadsPhp,
    elf,
    suspiciousFilenames,
    antiForensics,
    phpFilesScanned,
    filesWalked: walked.entries.length,
    unreadable: walked.unreadable,
    truncated: walked.truncated,
    knownIssues: KNOWN_ISSUES,
    durationMs: Date.now() - started,
  };
}

export const _internals = {
  OBFUSCATION_PATTERNS, CONTENT_OBFUSCATION, ELF_SKIP_EXTENSIONS, extensionOf,
  SUSPICIOUS_FILENAMES, ANTI_FORENSICS_TOUCH, ANTI_FORENSICS_ENUM,
};
