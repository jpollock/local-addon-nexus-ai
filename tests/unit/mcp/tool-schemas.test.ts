import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(__dirname, '../../../src/main/mcp/modules/wp-cli');

/** Tools that route through resolveTransport must advertise ssh_target. */
function transportBackedFiles(): string[] {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !['index.ts', 'preflight.ts', 'remote-exec.ts', 'twin-fallback.ts'].includes(f))
    .filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').includes('resolveTransport'));
}

describe('transport-backed tool schemas', () => {
  const files = transportBackedFiles();

  // Deliberately a floor, not an equality. Tasks 6-8 port four more tools onto
  // resolveTransport, which would break `toBe(15)` — and the rule this test
  // encodes is "every transport-backed tool advertises ssh_target", which must
  // keep holding as tools are added, not stop at a snapshot.
  it('finds at least the 15 transport-backed tools known today', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)('%s declares ssh_target and wp_path', (f) => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    expect(src).toContain('ssh_target:');
    expect(src).toContain('wp_path:');
  });
});
