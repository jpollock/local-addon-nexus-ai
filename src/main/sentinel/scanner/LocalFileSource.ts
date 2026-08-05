import * as fs from 'fs';
import * as path from 'path';
import { FileSource, FileEntry, FileStat, WalkOptions, WalkResult } from './FileSource';

/**
 * FileSource backed by the local filesystem.
 *
 * Two invariants, both load-bearing:
 *
 *   1. Nothing escapes the root. Every relative path is resolved and prefix-checked against the
 *      realpath'd root, and symlinks are reported but never traversed. The paths this scanner
 *      is handed come from a possibly-compromised site, so `../../` is an input to expect.
 *   2. Nothing executes. This reads bytes; it never spawns a process or loads PHP.
 */
export class LocalFileSource implements FileSource {
  readonly describe: string;
  private readonly root: string;

  /** @param root Absolute path to the install's web root. Must already exist. */
  constructor(root: string) {
    // realpath so the prefix check below compares resolved paths — otherwise a symlinked root
    // (common on macOS via /tmp -> /private/tmp) makes every containment check fail open.
    this.root = fs.realpathSync(root);
    this.describe = `local:${this.root}`;
  }

  /**
   * Resolve a root-relative path, refusing anything that escapes.
   * Returns null rather than throwing so callers can record it as unreadable and continue.
   */
  private resolve(relPath: string): string | null {
    if (relPath.includes('\0')) return null;
    const abs = path.resolve(this.root, relPath);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) return null;
    return abs;
  }

  private rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  private toEntry(abs: string, d: fs.Dirent): FileEntry {
    return {
      path: this.rel(path.join(abs, d.name)),
      name: d.name,
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
      isSymbolicLink: d.isSymbolicLink(),
    };
  }

  async readdir(relPath: string): Promise<FileEntry[]> {
    const abs = this.resolve(relPath);
    if (abs === null) throw new Error(`path escapes scan root: ${relPath}`);
    const dirents = await fs.promises.readdir(abs, { withFileTypes: true });
    return dirents.map((d) => this.toEntry(abs, d));
  }

  async lstat(relPath: string): Promise<FileStat | null> {
    const abs = this.resolve(relPath);
    if (abs === null) return null;
    try {
      // lstat, not stat — a symlink's own metadata is the interesting thing here.
      const s = await fs.promises.lstat(abs);
      return {
        size: s.size,
        mtimeMs: s.mtimeMs,
        ctimeMs: s.ctimeMs,
        mode: s.mode,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        isSymbolicLink: s.isSymbolicLink(),
      };
    } catch {
      return null;
    }
  }

  async readHead(relPath: string, bytes: number): Promise<Buffer | null> {
    const abs = this.resolve(relPath);
    if (abs === null) return null;
    let fh: fs.promises.FileHandle | undefined;
    try {
      fh = await fs.promises.open(abs, 'r');
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } catch {
      return null;
    } finally {
      await fh?.close().catch(() => {});
    }
  }

  async readFile(relPath: string): Promise<Buffer | null> {
    const abs = this.resolve(relPath);
    if (abs === null) return null;
    try {
      return await fs.promises.readFile(abs);
    } catch {
      return null;
    }
  }

  async exists(relPath: string): Promise<boolean> {
    const abs = this.resolve(relPath);
    if (abs === null) return false;
    try {
      await fs.promises.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  async walk(relPath: string, options: WalkOptions = {}): Promise<WalkResult> {
    const { skipDirs, limit = Infinity, maxDepth = Infinity } = options;
    const entries: FileEntry[] = [];
    const unreadable: Array<{ path: string; reason: string }> = [];
    let truncated = false;

    // Explicit stack rather than recursion: a hostile tree can be arbitrarily deep, and Node's
    // own recursive readdir silently truncates around depth 176 without raising anything.
    const stack: Array<{ rel: string; depth: number }> = [{ rel: relPath, depth: 0 }];

    while (stack.length > 0) {
      if (entries.length >= limit) { truncated = true; break; }
      const { rel, depth } = stack.pop()!;

      let dirents: FileEntry[];
      try {
        dirents = await this.readdir(rel);
      } catch (err) {
        unreadable.push({ path: rel, reason: (err as Error).message });
        continue;
      }

      for (const e of dirents) {
        if (entries.length >= limit) { truncated = true; break; }
        entries.push(e);
        // Symlinks are recorded but never descended into. Note what actually provides that:
        // `Dirent.isDirectory()` describes the LINK, not its target, so it is already false for
        // a symlinked directory and the branch below cannot be taken. The explicit
        // `!e.isSymbolicLink` is belt-and-braces for any future FileSource whose entries come
        // from `stat` rather than `readdir(withFileTypes)` — an SSH implementation parsing
        // `find -type d` would report a symlinked dir as a directory and would traverse without
        // it. Verified by mutation: removing the guard alone changes nothing today.
        if (e.isDirectory && !e.isSymbolicLink && depth < maxDepth && !skipDirs?.has(e.name)) {
          stack.push({ rel: e.path, depth: depth + 1 });
        }
      }
    }

    return { entries, truncated, unreadable };
  }
}
