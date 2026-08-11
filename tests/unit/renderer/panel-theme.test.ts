import * as fs from 'fs';
import * as path from 'path';

const PANEL_DIR = path.join(__dirname, '../../../src/renderer/components/DockedPanel');
const THEME_FILE = path.join(__dirname, '../../../src/renderer/utils/theme.ts');
const AGENT_CONSOLE_CSS = path.join(__dirname, '../../../src/renderer/styles/agent-console.css');

function panelSources(): Array<[string, string]> {
  return fs.readdirSync(PANEL_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => [f, fs.readFileSync(path.join(PANEL_DIR, f), 'utf8')] as [string, string]);
}

function panelSourcesWithCss(): Array<[string, string]> {
  return [
    ...panelSources(),
    ['agent-console.css', fs.readFileSync(AGENT_CONSOLE_CSS, 'utf8')],
  ];
}

describe('panel theming', () => {
  test('no raw hex literal survives in any panel file', () => {
    const offenders: string[] = [];
    for (const [file, src] of panelSourcesWithCss()) {
      let content = src;

      // For CSS: exempt variable definitions inside :root and :root[data-ag-theme='light']
      // Palette definitions necessarily contain hex literals; rule bodies must not.
      if (file === 'agent-console.css') {
        // Strip :root { ... } and :root[data-ag-theme='light'] { ... } blocks
        content = content.replace(/:root\s*\{[^}]*\}/gs, '');
        content = content.replace(/:root\[data-ag-theme=['"]light['"]\]\s*\{[^}]*\}/gs, '');
        // Strip CSS comments (/* ... */) which may reference hex values for documentation
        content = content.replace(/\/\*[\s\S]*?\*\//g, '');
      }

      for (const hex of content.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
        offenders.push(`${file}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every --nxai- and --ag-* variable the panel references exists', () => {
    const theme = fs.readFileSync(THEME_FILE, 'utf8');
    const agentConsoleCss = fs.readFileSync(AGENT_CONSOLE_CSS, 'utf8');
    const missing: string[] = [];

    for (const [file, rawSrc] of panelSourcesWithCss()) {
      // Strip comments before scanning. A docblock describing a namespace — "gets its own
      // `--ag-picker-*` prefix" — is prose, not a reference, and the trailing `*` made it
      // scan as a variable called `--ag-picker-` that no stylesheet will ever define.
      const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

      // TSX files reference --nxai-* from theme.ts
      for (const ref of src.match(/--nxai-[a-z-]+/g) ?? []) {
        // A typo compiles and renders transparent — this is the only thing that catches it.
        if (!theme.includes(`${ref}:`)) missing.push(`${file}: ${ref}`);
      }

      // All panel files (TSX and CSS) can reference --ag-* from agent-console.css
      for (const ref of src.match(/--ag-[a-z-]+/g) ?? []) {
        // Skip variable definitions (left side of colon) — only check references
        if (!agentConsoleCss.includes(`${ref}:`)) missing.push(`${file}: ${ref}`);
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
