import { FileSource, FileEntry } from '../FileSource';

/**
 * FS-02, FS-03, FS-04 and FS-06 over one filesystem walk.
 *
 * Today these are four separate `wp_eval` calls, each doing its own
 * RecursiveDirectoryIterator over overlapping trees, on a site that has been started and cloned
 * first. Here it is one traversal in Node against a stopped site with nothing executed.
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

export interface FilesystemScanResult {
  /** FS-02 — obfuscation chains in plugins, mu-plugins, themes. */
  obfuscation: PatternHit[];
  /** FS-03 — unexpected PHP in the web root, plus obfuscation in languages/ and uploads/. */
  rootAndContent: RootPhpHit[];
  /** FS-04 — any PHP anywhere under uploads. */
  uploadsPhp: string[];
  /** FS-06 — files whose first four bytes are the ELF magic. */
  elf: ElfHit[];
  phpFilesScanned: number;
  filesWalked: number;
  /** Directories that could not be read. A partial scan must never read as a clean one. */
  unreadable: Array<{ path: string; reason: string }>;
  truncated: boolean;
  knownIssues: string[];
  durationMs: number;
}

/** FS-02, verbatim from agent.js. `[\s\S]*` is PHP's `/s` on the one pattern that has it. */
const OBFUSCATION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /eval\s*\(\s*base64_decode/,                        label: 'eval(base64_decode' },
  { re: /eval\s*\(\s*gzinflate\s*\(\s*base64_decode/,       label: 'eval(gzinflate(base64_decode' },
  { re: /eval\s*\(\s*gzuncompress\s*\(\s*base64_decode/,    label: 'eval(gzuncompress(base64_decode' },
  { re: /eval\s*\(\s*str_rot13/,                            label: 'eval(str_rot13' },
  { re: /base64_decode[\s\S]*base64_decode/,                label: 'base64_decode..base64_decode' },
  { re: /eval\s*\(\s*\$/,                                   label: 'eval($' },
  { re: /assert\s*\(\s*\$/,                                 label: 'assert($' },
  { re: /create_function\s*\(/,                             label: 'create_function(' },
  { re: /preg_replace\s*\(\s*['"].*\/e/,                    label: 'preg_replace(/e' },
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

const KNOWN_ISSUES = [
  'FS-02/03/04 match the extension case-sensitively, so evil.PHP is not examined',
  'FS-06 skips 28 extensions, so an ELF named miner.png is not examined',
  'FS-02 skips files larger than 5 MB',
  'pattern set produces a high false-positive rate on legitimate vendor code (measured: 581 hits across 33 clean sites)',
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
  const { contentDir, knownRootPhp, limit = 400_000 } = opts;

  const obfuscation: PatternHit[] = [];
  const rootAndContent: RootPhpHit[] = [];
  const uploadsPhp: string[] = [];
  const elf: ElfHit[] = [];
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

    // FS-02 — obfuscation in plugins/mu-plugins/themes.
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
    phpFilesScanned,
    filesWalked: walked.entries.length,
    unreadable: walked.unreadable,
    truncated: walked.truncated,
    knownIssues: KNOWN_ISSUES,
    durationMs: Date.now() - started,
  };
}

export const _internals = { OBFUSCATION_PATTERNS, CONTENT_OBFUSCATION, ELF_SKIP_EXTENSIONS, extensionOf };
