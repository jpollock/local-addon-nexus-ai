import * as fs from 'fs';
import * as path from 'path';

const FLEET_DIRS = [
  path.join(__dirname, '..', '..', '..', 'src', 'main', 'mcp', 'modules', 'fleet'),
  path.join(__dirname, '..', '..', '..', 'src', 'main', 'mcp', 'modules', 'fleet-intelligence'),
];

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f));
}

describe('generic fleet queries include external sites', () => {
  it("no generic fleet query filters on source = 'wpe' alone", () => {
    // These tools answer "what is in my fleet". Restricting them to WP Engine
    // makes an external site invisible in exactly the views that exist to give
    // a complete picture. WPE-specific tools live in modules/wpe/ and are
    // deliberately not covered by this scan.
    // CASE expressions that compute WPE-only aggregates within a broadened query are allowed.
    const offenders: string[] = [];
    for (const dir of FLEET_DIRS) {
      for (const file of tsFiles(dir)) {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (/source\s*=\s*'wpe'/.test(line) && !/CASE\s+WHEN/i.test(line)) {
            offenders.push(`${path.basename(dir)}/${path.basename(file)}:${i + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
