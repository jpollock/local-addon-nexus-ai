/**
 * Byte-level access to a WordPress install, with no PHP anywhere in the path.
 *
 * Why this exists at all: every Tier 2 filesystem check currently runs as `wp_eval`, which is a
 * question posed to code the attacker already controls. A harness proved the consequence —
 * payload loaded at mu-plugin time installed an `ob_start()` rewriter and turned a *correct*
 * "BACKDOOR-PRESENT" result into "clean" before it reached stdout. `--skip-plugins` does not
 * help: WP-CLI implements it as four filters on `active_plugins`, while mu-plugins and the
 * drop-ins (`db.php`, `object-cache.php`) are included by `wp-settings.php` from the filesystem
 * with no gate at all. A byte read cannot be lied to.
 *
 * Why it is an interface rather than direct `fs` calls: the same checks must run against a WP
 * Engine install over read-only SSH, where the root is `/nas/content/live/<install>/` and there
 * is no local copy. Writing `fs.readdirSync` inside a check body means rewriting every check
 * when that lands. Checks depend on this interface only.
 *
 * Everything is async because the SSH implementation cannot be synchronous.
 */

export interface FileEntry {
  /** Path relative to the scan root, using forward slashes on every platform. */
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  /** True for a symlink itself — never followed, because following one leaves the root. */
  isSymbolicLink: boolean;
}

export interface FileStat {
  size: number;
  /** Epoch millis. Attacker-controllable via touch(); treat as a hint, never as proof. */
  mtimeMs: number;
  /** Epoch millis. Not settable from userland, which is why it is worth carrying separately. */
  ctimeMs: number;
  mode: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface WalkOptions {
  /** Directory names to skip entirely, matched on the segment (e.g. 'node_modules'). */
  skipDirs?: Set<string>;
  /** Stop after this many entries. The caller MUST report truncation — see WalkResult. */
  limit?: number;
  maxDepth?: number;
}

export interface WalkResult {
  entries: FileEntry[];
  /**
   * True when a limit or depth cap stopped the walk early.
   *
   * This is the field that keeps "we looked everywhere and found nothing" distinct from "we
   * stopped looking". A scanner that cannot tell those apart reports a truncated scan as clean,
   * which is the single most dangerous failure mode this design has.
   */
  truncated: boolean;
  /** Directories that could not be read, with the reason. Never silently dropped. */
  unreadable: Array<{ path: string; reason: string }>;
}

/**
 * A source of bytes for one install.
 *
 * Implementations MUST NOT follow symlinks out of the root, and MUST NOT execute anything on the
 * target. Paths are always relative to the root and always forward-slashed.
 */
export interface FileSource {
  /** Human-readable description of where this is reading from, for logs and reports. */
  readonly describe: string;

  /** Immediate children. Rejects if the directory cannot be read. */
  readdir(relPath: string): Promise<FileEntry[]>;

  /** Stat without following symlinks. Resolves null when the path does not exist. */
  lstat(relPath: string): Promise<FileStat | null>;

  /**
   * First N bytes. For magic-number checks (ELF, Mach-O) and cheap content sniffs, so a 4 GB
   * uploads tree is not read into memory to test four bytes.
   */
  readHead(relPath: string, bytes: number): Promise<Buffer | null>;

  /** Whole file. Resolves null when absent or unreadable. */
  readFile(relPath: string): Promise<Buffer | null>;

  /** Recursive listing. Symlinks are reported, never traversed. */
  walk(relPath: string, options?: WalkOptions): Promise<WalkResult>;

  /** Cheap existence check that does not read or stat the whole path. */
  exists(relPath: string): Promise<boolean>;
}
