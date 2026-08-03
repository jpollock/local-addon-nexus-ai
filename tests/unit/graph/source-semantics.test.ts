/**
 * Guards a semantic invariant the type system cannot express.
 *
 * `source != 'local'` means "is a WP Engine install" ONLY while source has
 * exactly two values. Plan B adds a third ('external'), at which point every
 * such query silently reclassifies external sites as WP Engine. The failure is
 * invisible: no exception, just wrong fleet intelligence.
 *
 * Use `source = 'wpe'` when you mean WP Engine.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..', '..', 'src');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkTsFiles(full, out);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('sites.source semantics', () => {
  it("no query uses source != 'local' as a synonym for WP Engine", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/source\s*!=\s*'local'/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
