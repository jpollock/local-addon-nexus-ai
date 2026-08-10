import * as fs from 'fs';
import * as path from 'path';

const PANEL_DIR = path.join(__dirname, '../../../src/renderer/components/DockedPanel');
const THEME_FILE = path.join(__dirname, '../../../src/renderer/utils/theme.ts');

function panelSources(): Array<[string, string]> {
  return fs.readdirSync(PANEL_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => [f, fs.readFileSync(path.join(PANEL_DIR, f), 'utf8')] as [string, string]);
}

describe('panel theming', () => {
  test('no raw hex literal survives in any panel file', () => {
    const offenders: string[] = [];
    for (const [file, src] of panelSources()) {
      for (const hex of src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
        offenders.push(`${file}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every --nxai- variable the panel references exists in theme.ts', () => {
    const theme = fs.readFileSync(THEME_FILE, 'utf8');
    const missing: string[] = [];
    for (const [file, src] of panelSources()) {
      for (const ref of src.match(/--nxai-[a-z-]+/g) ?? []) {
        // A typo compiles and renders transparent — this is the only thing that catches it.
        if (!theme.includes(`${ref}:`)) missing.push(`${file}: ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the container injects the theme variables itself', () => {
    const src = fs.readFileSync(path.join(PANEL_DIR, 'DockedPanelContainer.tsx'), 'utf8');
    // The panel renders on Local screens where no other Nexus component is mounted,
    // so it cannot rely on someone else having injected them.
    expect(src).toMatch(/injectThemeVars\s*\(/);
  });
});
