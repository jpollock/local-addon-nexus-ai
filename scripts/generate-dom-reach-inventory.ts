/**
 * WP-47 · THE DOM-REACH INVENTORY — phase 0's checklist, derived from the code.
 *
 * The designer's plan of record (`from-designer-10-shell-inversion-plan.dc.html`, phase 0)
 * requires that "the addon's existing DOM reaches are inventoried — each one recorded with
 * the Local selector it depends on. That inventory is the migration checklist for every
 * later phase, and it is also the honest measure of today's exposure." Its phase-6 gate is
 * the only gate in that plan that cannot be declared done by narrative: "the inventory is
 * empty, and a Local release with renamed CSS modules breaks nothing."
 *
 * A number that can only be reached by counting has to be counted BY something. This is it.
 *
 * ## What is derived and what is not
 *
 * DERIVED: which files reach, how many times, and whether any reach is unrecorded. That
 * comes from scanning `src/renderer/` for `NEXUS-DOM-REACH: <id>` markers, and from a
 * second scan for Local-owned selector tokens in NON-COMMENT lines that no marker covers.
 *
 * NOT DERIVED, and the output says so in its own header: every judgement — the Local
 * dependency each reach rests on, the recon's stability assessment, the contract item that
 * replaces it, and the trigger that deletes it. Those come from the Local architect's
 * reconnaissance (`from-local-architect/local-recon-01.txt`) and from host contract v2
 * (`SHELL_INVERSION_PLAN.md` Amendment 2), and they are declared below, in this file,
 * beside the scan that keeps them honest about WHERE the code actually reaches.
 *
 * ## Two directions, both enforced
 *
 *   1. A marker whose id has no declaration here → the inventory is incomplete → FAIL.
 *   2. A Local-selector token in code that no marker covers → an UNRECORDED reach → FAIL.
 *
 * Direction 2 is the one that makes this a build gate rather than a document. A new reach
 * added by a later packet fails the build until it is declared, which is the property the
 * designer's phase-6 number needs in order to mean anything.
 *
 * ## Known limit, stated rather than discovered later
 *
 * The token scan skips COMMENT lines, because this codebase's comments discuss `.Window`
 * and `Theme__Dark` at length and a guard that fires on prose would be turned off within a
 * week. So the guard covers code, not documentation: a reach hidden in a string built by
 * concatenation, or performed through a variable assembled elsewhere, is not caught. The
 * markers are the primary record; the token scan is the net under it.
 *
 *   npx ts-node scripts/generate-dom-reach-inventory.ts              # write the tracked file
 *   npx ts-node scripts/generate-dom-reach-inventory.ts --check      # CI/no-write
 *   npx ts-node scripts/generate-dom-reach-inventory.ts --out <path> # write elsewhere
 *
 * `--out` exists so a determinism or battery run never writes the tracked artifact —
 * PARALLEL_PROTOCOL's poisoned-fixture rule (WP-32).
 */
import * as fs from 'fs';
import * as path from 'path';

export const REPO_ROOT = path.resolve(__dirname, '..');
export const SCAN_ROOT = path.join(REPO_ROOT, 'src', 'renderer');
const OUT_FILE = path.join(REPO_ROOT, 'docs', 'intelligence', 'dom-reach-inventory.json');

/** Bumped when the SHAPE changes, so a consumer can tell that from a content change. */
const SHAPE_VERSION = 1;

export const MARKER_PREFIX = 'NEXUS-DOM-REACH';
const MARKER_RE = new RegExp(`${MARKER_PREFIX}:\\s*([a-z0-9][a-z0-9-]*)`);

/**
 * A reach's disposition, per the designer's phase-0 gate: "every reach either mapped to a
 * contract item or explicitly accepted as permanent guest behaviour."
 *
 * `open` reaches are the ones phase 6 drives to zero. `accepted` ones are disclosed and
 * counted separately — folding them into the same number would make the gate unreachable
 * and therefore meaningless.
 */
export type ReachStatus = 'open' | 'accepted';

export interface ReachDeclaration {
  id: string;
  title: string;
  /** What we do to Local's DOM: read it, write to it, insert into it, or watch it. */
  kind: 'read' | 'write' | 'inject' | 'observe';
  /** The exact Local-owned thing this rests on. */
  localDependency: string;
  status: ReachStatus;
  /** The recon's assessment, in its own terms. Never our inference. */
  reconStability: string;
  /** Where in the recon that assessment is, with the recon's own citation into Local's source. */
  reconCitation: string;
  /** The `context.capabilities` member that retires this reach, or null when none does. */
  contractItem: string | null;
  plannedReplacement: string;
  deletionTrigger: string;
  notes?: string;
}

/**
 * THE DECLARATIONS. Hand-authored, and the only hand-authored part of the output.
 *
 * Ordered by contract item, then by exposure. Every `reconStability` below is the Local
 * architect's judgement, not ours; where the recon did not assess a dependency, the field
 * says exactly that rather than substituting a guess of our own.
 */
export const REACHES: readonly ReachDeclaration[] = [
  {
    id: 'theme-class-read',
    title: 'Resolved theme read from the class Local applies to <html>',
    kind: 'read',
    localDependency: '`Theme__Dark` / `Theme__Light` on `document.documentElement`',
    status: 'open',
    reconStability:
      'Very likely to survive two releases — "explicitly pinned by comment". The theme keys ' +
      'carry "The theme keys need to remain the same for Local 2.4.x backwards compatibility", ' +
      'which the recon calls "your best available durability guarantee anywhere in this codebase".',
    reconCitation: 'recon-01 §4 and §7 table (their citation: ThemeCop.ts:55, themecop-init.tsx:19-39)',
    contractItem: 'themeTokens',
    plannedReplacement:
      '`theme: { name, tokens }` on the addon renderer context, with `osThemeChange` as the ' +
      'change signal. Already demoted from source to FALLBACK in WP-47: `resolveHostTheme` ' +
      'reads `localPreferences.currentThemeName` first (recon §4, themecop-init.tsx:13-17).',
    deletionTrigger: 'capabilities.themeTokens >= 1 — the class read is deleted, not merely bypassed.',
  },
  {
    id: 'theme-class-css-scope',
    title: "This addon's CSS custom properties scoped under Local's dark-theme class",
    kind: 'write',
    localDependency: '`.Theme__Dark` as a CSS selector on `<html>`',
    status: 'open',
    reconStability: 'Same dependency as `theme-class-read`: very likely, explicitly pinned by comment.',
    reconCitation: 'recon-01 §7 table (their citation: ThemeCop.ts:55)',
    contractItem: 'themeTokens',
    plannedReplacement:
      "Local's own ramp emitted as CSS custom properties on `:root` under " +
      '`Theme__Light`/`Theme__Dark` — the recon\'s own recommendation, which makes tokens ' +
      "consumable by addons without a SASS build. Our `--nxai-*` layer then derives from " +
      'Local\'s tokens instead of restating hex values beside them.',
    deletionTrigger: 'capabilities.themeTokens >= 1.',
  },
  {
    id: 'nav-theme-css-scope',
    title: "The injected rail item's own CSS, scoped under Local's dark-theme class",
    kind: 'write',
    localDependency: '`.Theme__Dark` as a CSS selector, plus six hardcoded values copied from Local\'s nav SCSS',
    status: 'open',
    reconStability:
      'The class: very likely (pinned by comment). The copied palette is not a selector and ' +
      'the recon does not assess it; it is a hand-copied constant that drifts silently if ' +
      "Local restyles its nav — which is the same exposure the rail slot removes.",
    reconCitation: 'recon-01 §7 table (their citation: ThemeCop.ts:55)',
    contractItem: 'mainVerticalNav',
    plannedReplacement:
      "A contributed rail item rendered by Local's own `VerticalNavItem`, which carries " +
      "Local's palette by construction. Dies with the injection, before the theme item lands.",
    deletionTrigger: 'capabilities.mainVerticalNav >= 1 — earlier than the other theme reaches.',
  },
  {
    id: 'theme-root-attribute',
    title: "This addon's own `data-ag-theme` attribute written onto Local's <html>",
    kind: 'write',
    localDependency:
      "None of Local's own names — the attribute is ours. The dependency is that we write an " +
      'attribute onto an element Local owns.',
    status: 'accepted',
    reconStability:
      'Not assessed by the recon, and not a Local-name dependency: an addon-namespaced ' +
      'attribute on the document element cannot be renamed out from under us.',
    reconCitation: 'not covered by recon-01 — this is our own attribute, not a Local selector',
    contractItem: null,
    plannedReplacement:
      'None planned. `agent-console.css` needs a theme scope it controls; the attribute is ' +
      'deliberately NOT `Theme__Dark` so our stylesheet does not break when Local renames its own.',
    deletionTrigger:
      'None. ACCEPTED as permanent guest behaviour under the designer\'s phase-0 gate, and ' +
      'therefore excluded from the phase-6 count — disclosed rather than hidden inside it.',
  },
  {
    id: 'nav-rail-injection',
    title: 'The Nexus rail item, injected as markup into a container we do not own',
    kind: 'inject',
    localDependency:
      '`#Sidebar` (the rail `<nav>`) and a child whose class contains `DragRegion` (the flex filler)',
    status: 'open',
    reconStability:
      '"id=\\"Sidebar\\" and TID_Main_Nav: likely. Internal wrapper nesting: coin-flip. The 2023 ' +
      'churn was real and could recur." The recon is explicit that no rail hook has EVER existed: ' +
      '"You didn\'t miss a hook. There is none."',
    reconCitation:
      'recon-01 §2 and §7 table (their citation: MainVerticalNav.tsx:34-192, :179-187; VerticalNav.tsx:14-27)',
    contractItem: 'mainVerticalNav',
    plannedReplacement:
      'ONE named slot (`mainVerticalNav`) taking a typed item modelled on `AddonSettingsItem` ' +
      '(renderer.d.ts:381-396), MobX-observable by stated requirement, with per-item error ' +
      "isolation and Local's own active-state resolution.",
    deletionTrigger: 'capabilities.mainVerticalNav >= 1.',
  },
  {
    id: 'nav-rail-observer',
    title: 'A MutationObserver over the whole body that re-injects the rail item when React drops it',
    kind: 'observe',
    localDependency:
      "Local's rail re-rendering and discarding foreign children — the reason the injection needs a watchdog at all",
    status: 'open',
    reconStability:
      'The recon names the underlying cause: the hook registry "is not reactive and is read ' +
      'exactly once per render", so anything registered after first paint appears only when a ' +
      'subtree happens to re-render. An observer is what an addon does instead.',
    reconCitation: 'recon-01 §1 (timing) and §10 (their citation: HooksRenderer.tsx:119-133, bootstrap-app.tsx:14-21)',
    contractItem: 'mainVerticalNav',
    plannedReplacement:
      'The slot being MobX-observable, which is why that is a STATED REQUIREMENT of the ask ' +
      'rather than an implementation detail: an additive-array API with one-shot semantics ' +
      'would leave this observer in place under a nicer name.',
    deletionTrigger: 'capabilities.mainVerticalNav >= 1 — deleted in the same change as the injection.',
  },
  {
    id: 'window-right-reservation',
    title: "The docked panel makes room by setting `right` on Local's shell",
    kind: 'write',
    localDependency: '`.Window` — a plain global class, styled `position: absolute; inset: 0`',
    status: 'open',
    reconStability:
      'Very likely over two releases. "The position: absolute; inset: 0 contract your docking ' +
      'relies on is the oldest layout code in the app." The recon also calls the approach ' +
      '"actually well-matched to this architecture" — and names what it cannot survive: a second ' +
      '`.Window` (Preferences renders its own) or a competing addon doing the same thing.',
    reconCitation: 'recon-01 §5 and §7 table (their citation: Window.tsx:93-110, Window.scss:3-14, preferences/index.tsx:48)',
    contractItem: 'layoutReservation',
    plannedReplacement:
      '`reserveEdge({ edge, requestedPx }) → { grantedPx }` on `Window`, v1 scoped as the recon ' +
      'scoped it: right edge, main window, one reservation, no persistence, grant clamped. The ' +
      'shell decides and reports what it granted.',
    deletionTrigger: 'capabilities.layoutReservation >= 1.',
    notes:
      'Two write sites and one read site: the read locates the shell, the writes set and clear ' +
      '`style.right`. All three go together.',
  },
  {
    id: 'window-data-location-read',
    title: "The route on screen, read off the `data-location` attribute of Local's shell",
    kind: 'read',
    localDependency: '`.Window[data-location]`, plus a body-wide attribute observer on `data-location`',
    status: 'open',
    reconStability:
      "`.Window` itself: very likely (see above). The `data-location` attribute is confirmed " +
      'present in the recon\'s own quotation of `Window.tsx` but is NOT assessed for stability ' +
      'anywhere in the document — recorded here as unassessed rather than inferred from the ' +
      "class's rating.",
    reconCitation: 'recon-01 §5 (their citation: Window.tsx:93-110); stability unassessed',
    contractItem: 'regionProviders',
    plannedReplacement:
      "A region provider receives Local's own typed props for the region it renders, so the site " +
      'on screen arrives as an argument rather than being inferred from an attribute. Until then ' +
      'the panel is mounted outside Local\'s router and has no route prop to read.',
    deletionTrigger:
      'capabilities.regionProviders >= 1 for the panel\'s own site context. NOTE: the panel is ' +
      'mounted on document.body; if it moves into a chrome slot first, the slot supplies context ' +
      'and this goes at mainVerticalNav/chrome-slot time instead. Whichever lands first.',
    notes:
      'One of the four sites is `panelReflow.readSiteId`, which is DEAD (no callers) and ' +
      'documented as such in place. It is marked and counted rather than quietly excluded: an ' +
      'inventory that omits a reach because nobody calls it is an inventory that can be gamed by ' +
      'not calling things.',
  },
  {
    id: 'sites-sidebar-toolbar-button',
    title: "The site-finder button, injected into Local's sites-sidebar toolbar and kept there by an observer",
    kind: 'inject',
    localDependency: '`[class*="SitesSidebar_Toolbar"]` — a CSS-module class, matched loosely',
    status: 'open',
    reconStability:
      'Fair game, explicitly: "every CSS-module class, all component internals, all DOM nesting" ' +
      'are listed as things the team would not hesitate to change. The loose match survives the ' +
      'hash and the version suffix but not a rename or a file move.',
    reconCitation: 'recon-01 §7 ("Fair game") and §7 TabNav analysis (their citation: shared-rules.js:14, css-loader dist/utils.js:289-299)',
    contractItem: 'mainVerticalNav',
    plannedReplacement:
      'A contributed chrome slot. The rail slot is the one ask; a second named slot is the ' +
      "recon's own \"~1 more week\" extension, and this is the surface that would consume it.",
    deletionTrigger:
      'capabilities.mainVerticalNav >= 2 (a second named slot) — or the button moves into the ' +
      'rail item itself at mainVerticalNav >= 1, whichever the design settles on. NOT retired by ' +
      'the v1 rail slot on its own.',
  },
  {
    id: 'site-list-filter-css',
    title: "Injected CSS that hides rows of Local's own site list to apply a Nexus filter",
    kind: 'write',
    localDependency: '`[data-site-id]` on Local\'s site-list rows',
    status: 'open',
    reconStability:
      'Not assessed by the recon. It is a data attribute on a component internal, which §7 ' +
      'places in "fair game" as a class; the recon does not rate data attributes specifically, ' +
      'so this is recorded as unassessed. It is also the reach with the largest blast radius: ' +
      "it hides Local's own content.",
    reconCitation: 'not covered by recon-01 — the recon was asked about four dependencies and this was not among them',
    contractItem: 'regionProviders',
    plannedReplacement:
      "`registerRegionProvider('main.siteList.body', …)` — the site list's body is exactly the " +
      'region the region-provider ask names first, and a provider RENDERS the filtered list ' +
      'rather than hiding rows of Local\'s.',
    deletionTrigger: 'capabilities.regionProviders >= 1.',
  },
  {
    id: 'site-list-badge',
    title: 'Per-site badges inserted into Local\'s site-list rows (present in the tree, wired to nothing)',
    kind: 'inject',
    localDependency: '`[data-site-id]` rows and the `.TID_SiteListSite_Span_SiteName` label inside them',
    status: 'open',
    reconStability:
      'The `TID_*` classes are "effectively public (renaming would be a deliberate, discussed ' +
      'act)" — "Test IDs, deliberately literal, referenced by the Playwright suites in this ' +
      'repo." The row attribute is unassessed, as above.',
    reconCitation: 'recon-01 §7 ("Effectively public": TID_* classes, their citation: MainVerticalNav.tsx:175, VerticalNav.tsx:127)',
    contractItem: 'regionProviders',
    plannedReplacement: "A region provider for the site list's body renders its own rows, badges included.",
    deletionTrigger: 'capabilities.regionProviders >= 1.',
    notes:
      'MEASURED 2026-08-20: `SidebarBadgeManager` has ZERO callers in `src/` — it is present but ' +
      'unwired. Counted as an open reach anyway, because it is code in the shipped bundle that ' +
      'would reach the moment someone instantiates it, and because deleting it is a decision this ' +
      'packet is not scoped to make.',
  },
  {
    id: 'tabnav-nowrap',
    title: "Injected CSS that stops our fifth site-info tab wrapping in Local's tab bar",
    kind: 'write',
    localDependency: '`[class*="TabNav_Items_"]` — the CSS-module class from `@getflywheel/local-components`',
    status: 'open',
    reconStability:
      'Better than we thought, and the recon corrected us in our favour: the `[hash:base64:5]` ' +
      'is computed over file PATH + class name, NOT content, so it survives every edit to ' +
      'TabNav.sass; only the `_v` suffix tracks releases, and local-components has bumped three ' +
      'times in 28 months. A version-suffix-tolerant selector is rated "better than 95% odds over ' +
      'two releases" and "this drops off your risk register entirely".',
    reconCitation:
      'recon-01 §7 ("The TabNav hash — you\'re wrong about how it works, in your favour") and ' +
      '"Where your assumptions are wrong" #4 (their citation: shared-rules.js:14, css-loader dist/utils.js:289-299)',
    contractItem: 'regionProviders',
    plannedReplacement:
      "Retired by the site screen absorbing its intelligence (the designer's phase 2): with no " +
      'fifth tab there is nothing to stop wrapping. Recorded against `regionProviders` because ' +
      'that is the capability the site screen needs.',
    deletionTrigger:
      'capabilities.regionProviders >= 1 AND the Nexus site tab is retired. Until then the loose ' +
      'selector stays — WP-47 already deleted the version-pinned duplicate that pinned v17.8.1 ' +
      'while Local ships 17.8.2.',
  },
];

// ── the scan ──────────────────────────────────────────────────────────────────

export interface MarkerHit {
  id: string;
  file: string;
  line: number;
}

export interface UnmarkedHit {
  file: string;
  line: number;
  token: string;
  text: string;
}

/**
 * Local-owned surface tokens. A hit on a NON-COMMENT line that no marker covers is an
 * unrecorded reach. Each entry names what it is looking for so a failure message can say
 * WHY the line was flagged.
 */
export const REACH_TOKENS: ReadonlyArray<{ token: string; re: RegExp }> = [
  { token: 'Theme__', re: /Theme__/ },
  { token: '.Window', re: /\.Window\b/ },
  // `TabNav_Items_` with the trailing underscore, deliberately: that is the CSS-MODULE class
  // (`TabNav_Items_<hash>_v<ver>`), which is a DOM reach. The hook ID `SiteInfo_TabNav_Items`
  // has no trailing underscore and is NOT a reach — it is supported API, published in
  // `app/api/renderer.d.ts` and rated "effectively public" by recon-01 §7 ("The content-hook
  // IDs. The deprecatedHooks alias table is a seven-year-old promise, still honoured"). The
  // one line this exclusion lets through is `index.tsx`'s `hooks.addContent(
  // 'SiteInfo_TabNav_Items', …)`, and it is excluded because it is a supported contribution,
  // not because the guard was inconvenient.
  { token: 'TabNav_Items_', re: /TabNav_Items_/ },
  { token: 'TID_', re: /TID_/ },
  { token: 'SitesSidebar_', re: /SitesSidebar_/ },
  { token: 'DragRegion', re: /DragRegion/ },
  { token: "id 'Sidebar'", re: /getElementById\(\s*['"]Sidebar['"]/ },
  { token: 'data-location', re: /data-location/ },
  { token: 'data-site-id', re: /data-site-id/ },
  { token: 'class*=', re: /class\*=/ },
  { token: 'MutationObserver', re: /new MutationObserver/ },
  { token: 'documentElement', re: /documentElement/ },
];

/**
 * A local-components CSS-module class pinned to a specific package version —
 * `TabNav_Items_ad_cY_v17-8-1` and anything shaped like it.
 *
 * The recon's correction (§7, "The TabNav hash — you're wrong about how it works, in your
 * favour") is the reason this is a permanent rule rather than a one-time cleanup: the hash
 * is over file path + class name and survives every content edit, while the `_v` suffix is
 * "the fragile part, and it is fragile on a slow clock". A pinned suffix therefore adds no
 * precision and guarantees eventual silent breakage — ours was pinned to v17.8.1 while
 * Local ships 17.8.2, so it had ALREADY stopped matching and nothing said so.
 *
 * Comment lines are exempt, so the pinned string can still be discussed in prose — which is
 * exactly where it now lives, in `index.tsx`'s explanation of why it was deleted.
 */
const VERSION_PIN_RE = /_v\d+-\d+(-\d+)?\b/;

export interface VersionPinHit {
  file: string;
  line: number;
  text: string;
}

/** Every version-pinned selector left in code. The sweep is a build gate, not a one-off. */
export function scanVersionPins(root: string = SCAN_ROOT): VersionPinHit[] {
  const hits: VersionPinHit[] = [];
  for (const file of listScannedFiles(root)) {
    const rel = path.relative(REPO_ROOT, file);
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        if (isCommentLine(text)) return;
        if (VERSION_PIN_RE.test(text)) hits.push({ file: rel, line: i + 1, text: text.trim() });
      });
  }
  return hits;
}

/** How many lines above a hit a marker may sit and still cover it. */
export const MARKER_WINDOW = 15;

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.css'];

function isCommentLine(text: string): boolean {
  const t = text.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

export function listScannedFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (SCANNED_EXTENSIONS.includes(path.extname(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

export interface ScanResult {
  markers: MarkerHit[];
  unmarked: UnmarkedHit[];
  filesScanned: number;
}

/** Scan a tree for markers and for reach tokens no marker covers. Pure over the filesystem. */
export function scanTree(root: string = SCAN_ROOT): ScanResult {
  const markers: MarkerHit[] = [];
  const unmarked: UnmarkedHit[] = [];
  const files = listScannedFiles(root);

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const markerLines: number[] = [];

    lines.forEach((text, i) => {
      const m = MARKER_RE.exec(text);
      if (m) {
        markers.push({ id: m[1], file: rel, line: i + 1 });
        markerLines.push(i + 1);
      }
    });

    lines.forEach((text, i) => {
      if (isCommentLine(text)) return;
      const hit = REACH_TOKENS.find((t) => t.re.test(text));
      if (!hit) return;
      const lineNo = i + 1;
      const covered = markerLines.some((ml) => ml <= lineNo && lineNo - ml <= MARKER_WINDOW);
      if (!covered) unmarked.push({ file: rel, line: lineNo, token: hit.token, text: text.trim() });
    });
  }

  return { markers, unmarked, filesScanned: files.length };
}

// ── the artifact ──────────────────────────────────────────────────────────────

export class InventoryError extends Error {}

export function buildInventory(
  scan: ScanResult = scanTree(),
  versionPins: VersionPinHit[] = scanVersionPins(),
): unknown {
  if (versionPins.length > 0) {
    throw new InventoryError(
      `VERSION-PINNED SELECTOR — ${versionPins.length} line(s) pin a local-components class to a ` +
        `package version:\n` +
        versionPins.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join('\n') +
        `\nThe hash is over path + class name and survives content edits; only the _v suffix ` +
        `tracks releases (recon-01 §7). Match the class without the suffix.`,
    );
  }
  if (scan.unmarked.length > 0) {
    throw new InventoryError(
      `UNRECORDED DOM REACH — ${scan.unmarked.length} line(s) touch Local's DOM with no ` +
        `${MARKER_PREFIX} marker within ${MARKER_WINDOW} lines above them:\n` +
        scan.unmarked.map((u) => `  ${u.file}:${u.line}  [${u.token}]  ${u.text}`).join('\n') +
        `\nDeclare the reach in scripts/generate-dom-reach-inventory.ts and mark the line, ` +
        `or move the token out of code.`,
    );
  }

  const declaredIds = new Set(REACHES.map((r) => r.id));
  const orphans = [...new Set(scan.markers.map((m) => m.id))].filter((id) => !declaredIds.has(id)).sort();
  if (orphans.length > 0) {
    throw new InventoryError(
      `MARKED BUT UNDECLARED — ${orphans.join(', ')}. Every ${MARKER_PREFIX} id must have a ` +
        `declaration in REACHES.`,
    );
  }

  const reaches = REACHES.map((r) => {
    const hits = scan.markers.filter((m) => m.id === r.id);
    const byFile = new Map<string, number>();
    for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
    return {
      ...r,
      sites: [...byFile.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([file, occurrences]) => ({ file, occurrences })),
      markedLines: hits.length,
    };
  });

  const undeclaredInCode = reaches.filter((r) => r.markedLines === 0).map((r) => r.id);
  if (undeclaredInCode.length > 0) {
    throw new InventoryError(
      `DECLARED BUT UNMARKED — ${undeclaredInCode.join(', ')}. A declaration with no marker in ` +
        `${path.relative(REPO_ROOT, SCAN_ROOT)} is either a reach that was deleted (remove the ` +
        `declaration — that is phase 6 working) or a marker that was lost.`,
    );
  }

  const open = reaches.filter((r) => r.status === 'open');
  const accepted = reaches.filter((r) => r.status === 'accepted');

  return {
    $generatedBy: 'scripts/generate-dom-reach-inventory.ts — npm run inventory:dom-reach',
    $shapeVersion: SHAPE_VERSION,
    $derived:
      'Every `sites` entry and every count below is scanned from the code. Run the generator; ' +
      'never hand-edit this file.',
    $notDerived:
      'Every judgement — localDependency, reconStability, reconCitation, contractItem, ' +
      'plannedReplacement, deletionTrigger, status — is hand-authored in the generator, sourced ' +
      "from the Local architect's reconnaissance (docs/intelligence/from-local-architect/" +
      'local-recon-01.txt) and host contract v2 (SHELL_INVERSION_PLAN.md Amendment 2). No claim ' +
      'about Local in this file comes from anywhere else.',
    $gate:
      "The designer's phase 6 (from-designer-10-shell-inversion-plan.dc.html): \"the inventory is " +
      'empty, and a Local release with renamed CSS modules breaks nothing." The number that must ' +
      'reach zero is totals.open. totals.accepted is permanent guest behaviour, accepted at ' +
      "phase 0's gate and disclosed separately so it can never be used to make the gate look closer.",
    totals: {
      declared: reaches.length,
      open: open.length,
      accepted: accepted.length,
      markedLines: scan.markers.length,
      filesScanned: scan.filesScanned,
    },
    byContractItem: [...new Set(REACHES.map((r) => r.contractItem))]
      .sort((a, b) => (String(a) < String(b) ? -1 : 1))
      .map((item) => ({
        contractItem: item,
        openReaches: open.filter((r) => r.contractItem === item).map((r) => r.id),
      })),
    reaches,
  };
}

export function render(): string {
  return `${JSON.stringify(buildInventory(), null, 2)}\n`;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : OUT_FILE;

  let text: string;
  try {
    text = render();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
    throw err;
  }

  if (argv.includes('--check')) {
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    if (current !== text) {
      process.stderr.write(
        `${path.relative(REPO_ROOT, outFile)} is stale — run: npm run inventory:dom-reach\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${path.relative(REPO_ROOT, outFile)} is current\n`);
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text, 'utf8');
  process.stdout.write(`wrote ${path.relative(REPO_ROOT, outFile)}\n`);
}
