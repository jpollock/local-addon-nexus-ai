# Dark Mode Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix dark mode theming so all Nexus UI components respect Local's dark theme without visual inconsistencies.

**Architecture:** The root cause is two-fold: (1) CSS variables are injected only when `NexusOverview` mounts, not at the app root — so panels opened before the dashboard get no dark mode vars; (2) ~157 hardcoded hex color values across 15 components bypass the CSS variable system entirely. Fix: extract `injectThemeVars()` into a shared utility called from `SiteNexusSection.componentDidMount` (the root), expand the token sheet with missing tokens, then replace hardcoded values component-by-component starting with the most visible.

**Tech Stack:** React (class-based, no JSX, no hooks), CSS custom properties, `React.createElement`

**Branch:** `fix/dark-mode`

---

## Token Reference

The following CSS variables are used throughout. Always use the `var(--token, fallback)` form so components degrade to light-mode values if the style sheet hasn't loaded yet.

### Existing tokens (already in `injectCssVars`)
| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--nxai-card-bg` | `#ffffff` | `#2a2a2a` | Panel/card backgrounds |
| `--nxai-card-border` | `#e5e7eb` | `#404040` | Panel borders, dividers |
| `--nxai-card-label` | `#6b7280` | `#9ca3af` | Section labels, small caps headers |
| `--nxai-card-sub` | `#6b7280` | `#9ca3af` | Muted secondary text |
| `--nxai-card-text` | `#111827` | `#f3f4f6` | Primary body text |
| `--nxai-section-label` | `#374151` | `#d1d5db` | Section header text |
| `--nxai-code-bg` | `#f3f4f6` | `#1f1f1f` | Code blocks, mono backgrounds |
| `--nxai-table-hover` | `#f9fafb` | `#333333` | Row hover states |
| `--nxai-input-bg` | `#ffffff` | `#2a2a2a` | Input field backgrounds |
| `--nxai-input-border` | `#d1d5db` | `#555555` | Input borders |
| `--nxai-score-bg` | `#e5e7eb` | `#404040` | Score bar tracks |

### New tokens added in Task 1
| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--nxai-section-bg` | `#f9fafb` | `#222222` | Section/panel outer backgrounds |
| `--nxai-warn-text` | `#d97706` | `#fbbf24` | Amber warning text |
| `--nxai-status-neutral` | `#9ca3af` | `#6b7280` | Neutral/unknown status |
| `--nxai-danger-text` | `#ef4444` | `#f87171` | Destructive action text |

### Do NOT change (intentional hardcoded values)
- `color: '#fff'` on WPE brand-colored buttons — white text on brand background is correct in both modes
- `UI_COLORS.STATUS_RUNNING`, `UI_COLORS.STATUS_ERROR`, etc. — semantic status colours
- `UI_COLORS.WPE_BRAND` — brand colour constant
- `rgba(...)` semi-transparent overlays — these adapt naturally
- `#3b82f6` (blue), `#51BB7B` (green), `#ef4444` (red) when used as button background colours — semantic UI colours, intentional

---

## File Map

**New:**
- `src/renderer/utils/theme.ts` — `injectThemeVars()` utility (extracted from NexusOverview, expanded)

**Modified:**
- `src/renderer/components/SiteNexusSection.tsx` — call `injectThemeVars()` on mount
- `src/renderer/components/NexusOverview.tsx` — remove inline `injectCssVars`, use tokens for 12 remaining hardcoded text colours
- `src/renderer/components/NexusPreferences.tsx` — replace 4 hardcoded values with tokens
- `src/renderer/components/SidebarSearchPanel.tsx` — replace hardcoded background/text colours
- `src/renderer/components/BulkOperationsPanel.tsx` — replace hardcoded colours
- `src/renderer/components/AISiteFinderPanel.tsx` — replace hardcoded colours
- `src/renderer/components/SiteGroupsPanel.tsx` — replace hardcoded colours
- `src/renderer/components/UnifiedSearchPanel.tsx` — replace hardcoded colours
- `src/renderer/components/SavedQueriesPanel.tsx` — replace hardcoded colours

---

## Task 1: Extract Theme Injection to Root

**Files:**
- Create: `src/renderer/utils/theme.ts`
- Modify: `src/renderer/components/SiteNexusSection.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx`

The CSS variables must be injected at the root component (`SiteNexusSection`) so they exist regardless of which tab the user opens first.

- [ ] **Step 1: Create `src/renderer/utils/theme.ts`**

```typescript
import { UI_COLORS } from '../../common/constants';

const STYLE_ID = 'nexus-ai-theme-vars';

/**
 * Injects Nexus AI CSS custom properties into the document head.
 * Must be called from the root component (SiteNexusSection) on mount.
 * Idempotent — safe to call multiple times.
 */
export function injectThemeVars(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --nxai-card-bg: #ffffff;
      --nxai-card-border: #e5e7eb;
      --nxai-card-label: #6b7280;
      --nxai-card-sub: #6b7280;
      --nxai-card-text: #111827;
      --nxai-section-label: #374151;
      --nxai-section-bg: #f9fafb;
      --nxai-code-bg: #f3f4f6;
      --nxai-table-hover: #f9fafb;
      --nxai-input-bg: #ffffff;
      --nxai-input-border: #d1d5db;
      --nxai-score-bg: #e5e7eb;
      --nxai-score-fill: ${UI_COLORS.WPE_BRAND};
      --nxai-warn-text: #d97706;
      --nxai-status-neutral: #9ca3af;
      --nxai-danger-text: #ef4444;
    }
    .Theme__Dark {
      --nxai-card-bg: #2a2a2a;
      --nxai-card-border: #404040;
      --nxai-card-label: #9ca3af;
      --nxai-card-sub: #9ca3af;
      --nxai-card-text: #f3f4f6;
      --nxai-section-label: #d1d5db;
      --nxai-section-bg: #222222;
      --nxai-code-bg: #1f1f1f;
      --nxai-table-hover: #333333;
      --nxai-input-bg: #2a2a2a;
      --nxai-input-border: #555555;
      --nxai-score-bg: #404040;
      --nxai-score-fill: ${UI_COLORS.WPE_BRAND};
      --nxai-warn-text: #fbbf24;
      --nxai-status-neutral: #6b7280;
      --nxai-danger-text: #f87171;
    }
  `;
  document.head.appendChild(style);
}
```

- [ ] **Step 2: Call `injectThemeVars()` in `SiteNexusSection.componentDidMount`**

In `src/renderer/components/SiteNexusSection.tsx`, add the import at the top of the file:

```typescript
import { injectThemeVars } from '../utils/theme';
```

Then in `componentDidMount()` (line ~156), add as the first line of the method:

```typescript
componentDidMount(): void {
  injectThemeVars();           // ← add this line
  this.mounted = true;
  this.fetchData();
  // ... rest of existing code
```

- [ ] **Step 3: Remove `injectCssVars` from `NexusOverview.tsx`**

In `src/renderer/components/NexusOverview.tsx`:

1. Find the `injectCssVars()` method (around line 420) and **delete the entire method**.
2. Find where `injectCssVars()` is called (search for `this.injectCssVars()`) and **delete that call** (it's likely in `componentDidMount` of NexusOverview).
3. Add the import at the top of the file:

```typescript
import { injectThemeVars } from '../utils/theme';
```

4. In `NexusOverview.componentDidMount()`, replace the `this.injectCssVars()` call with `injectThemeVars()`.

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/utils/theme.ts src/renderer/components/SiteNexusSection.tsx src/renderer/components/NexusOverview.tsx
git commit -m "fix(dark-mode): move CSS var injection to root SiteNexusSection

Previously injectCssVars() only ran when NexusOverview mounted. If the
user opened Preferences or any other panel first, dark mode variables were
never injected and all var() fallbacks resolved to light-mode values.

Extracted to src/renderer/utils/theme.ts with expanded token set (4 new
tokens: --nxai-section-bg, --nxai-warn-text, --nxai-status-neutral,
--nxai-danger-text). SiteNexusSection calls it on mount as the root
component that always mounts first."
```

---

## Task 2: Fix NexusPreferences.tsx

`NexusPreferences` is the most user-visible panel and has **zero** CSS variable usage. Replace the 4 hardcoded values that affect dark mode legibility.

**File:** `src/renderer/components/NexusPreferences.tsx`

- [ ] **Step 1: Replace hardcoded colours**

Find and replace these specific values:

```typescript
// Line ~441 — amber warning text on environment access section
// Change:
color: '#f59e0b'
// To:
color: 'var(--nxai-warn-text, #d97706)'

// Line ~645 and ~770 — neutral status colour (#999 used for unset status)
// Change:
'#999'
// To:
'var(--nxai-status-neutral, #9ca3af)'

// Line ~1593 — near-black text for scope label (visible in both modes needed)
// This is inline in a React.createElement — find: { color: '#111827', flex: 1 }
// Change:
color: '#111827'
// To:
color: 'var(--nxai-card-text, #111827)'

// Line ~1592 — gray label text
// Find: { color: '#6b7280', fontWeight: 600 }
// Change:
color: '#6b7280'
// To:
color: 'var(--nxai-card-label, #6b7280)'
```

**Do NOT change:**
- `color: '#fff'` on brand-coloured buttons (lines 722, 828) — intentional white-on-brand
- `border: '1px solid rgba(...)'` semi-transparent borders — adapt naturally
- `var(--color-border-primary, #ccc)` — already using Local's host theme variable

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/NexusPreferences.tsx
git commit -m "fix(dark-mode): replace hardcoded colours in NexusPreferences"
```

---

## Task 3: Fix NexusOverview.tsx (12 remaining hardcoded text colours)

After Task 1 removed the `injectCssVars` method, NexusOverview still has ~12 hardcoded inline text colour values that bypass the token system.

**File:** `src/renderer/components/NexusOverview.tsx`

- [ ] **Step 1: Replace hardcoded values**

Use find-and-replace for each pattern. Be careful — only change the colours listed here; do NOT change button background colours or brand/status colours.

```typescript
// Pattern: gray sub-text — colour used for labels, hints, secondary text
// Find: color: '#6b7280'  (appears ~8 times inline)
// Replace: color: 'var(--nxai-card-sub, #6b7280)'
// EXCEPTION: do NOT change '#6b7280' when it is a backgroundColor (e.g. neutral button bg)

// Pattern: near-black primary text
// Find: color: '#111827'
// Replace: color: 'var(--nxai-card-text, #111827)'

// Pattern: lighter gray (already is the dark-mode equivalent of #6b7280)
// Find: color: '#9ca3af'  (sub-text, hints)
// Replace: color: 'var(--nxai-status-neutral, #9ca3af)'

// Pattern: amber warning text (staleness indicators, warnings)
// Find: color: '#f59e0b'
// Replace: color: 'var(--nxai-warn-text, #f59e0b)'
```

Run a targeted search to find each location before replacing:

```bash
grep -n "color: '#6b7280'\|color: '#111827'\|color: '#9ca3af'\|color: '#f59e0b'" \
  src/renderer/components/NexusOverview.tsx
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/NexusOverview.tsx
git commit -m "fix(dark-mode): replace hardcoded text colours in NexusOverview"
```

---

## Task 4: Fix SidebarSearchPanel + BulkOperationsPanel + AISiteFinderPanel

Three components with 28–46 hardcoded values each. Same token substitution pattern.

**Files:**
- `src/renderer/components/SidebarSearchPanel.tsx`
- `src/renderer/components/BulkOperationsPanel.tsx`
- `src/renderer/components/AISiteFinderPanel.tsx`

- [ ] **Step 1: Find the hardcoded values in each file**

```bash
grep -n "color: '#\|backgroundColor: '#\|border.*'#\|borderColor.*'#" \
  src/renderer/components/SidebarSearchPanel.tsx \
  src/renderer/components/BulkOperationsPanel.tsx \
  src/renderer/components/AISiteFinderPanel.tsx | \
  grep -v "UI_COLORS\|WPE_BRAND\|STATUS_\|nxai\|var(--"
```

- [ ] **Step 2: Apply token substitution**

For each file, apply these substitutions (same token map as Tasks 2–3):

| Hardcoded value | Replace with |
|-----------------|-------------|
| `color: '#6b7280'` | `color: 'var(--nxai-card-sub, #6b7280)'` |
| `color: '#9ca3af'` | `color: 'var(--nxai-status-neutral, #9ca3af)'` |
| `color: '#111827'` or `color: '#1f2937'` | `color: 'var(--nxai-card-text, #111827)'` |
| `color: '#374151'` | `color: 'var(--nxai-section-label, #374151)'` |
| `color: '#f59e0b'` | `color: 'var(--nxai-warn-text, #f59e0b)'` |
| `backgroundColor: '#f3f4f6'` or `'#f9fafb'` | `backgroundColor: 'var(--nxai-code-bg, #f3f4f6)'` |
| `backgroundColor: '#ffffff'` or `'#fff'` (non-button) | `backgroundColor: 'var(--nxai-card-bg, #fff)'` |
| `border: '1px solid #e5e7eb'` or `'#d1d5db'` | `border: '1px solid var(--nxai-card-border, #e5e7eb)'` |

**Keep as-is** (do not change):
- `color: '#fff'` on buttons with explicit `backgroundColor` brand colour
- `backgroundColor: UI_COLORS.WPE_BRAND` and similar — semantic colours
- `color: '#ef4444'` destructive/error — these are semantic, intentional in both modes
- `color: '#51BB7B'` success — semantic

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 4: Commit**

```bash
git add \
  src/renderer/components/SidebarSearchPanel.tsx \
  src/renderer/components/BulkOperationsPanel.tsx \
  src/renderer/components/AISiteFinderPanel.tsx
git commit -m "fix(dark-mode): replace hardcoded colours in SidebarSearch, BulkOps, AISiteFinder"
```

---

## Task 5: Fix Remaining Components + Final Build

**Files:**
- `src/renderer/components/SiteGroupsPanel.tsx`
- `src/renderer/components/UnifiedSearchPanel.tsx`
- `src/renderer/components/SavedQueriesPanel.tsx`
- `src/renderer/components/ChatTab.tsx`
- `src/renderer/components/SiteFinderPanel.tsx` (already mostly tokenised — confirm)
- `src/renderer/components/SmartFiltersPanel.tsx`
- `src/renderer/components/EventTimeline.tsx`
- `src/renderer/components/StorageHealthPanel.tsx`
- `src/renderer/components/SiteNexusSection.tsx`
- `src/renderer/components/NexusSiteTab.tsx`
- `src/renderer/components/ToastManager.tsx`

- [ ] **Step 1: Run the full hardcoded colour audit**

```bash
grep -rn "color: '#\|backgroundColor: '#\|border.*'#" \
  src/renderer/components/ --include="*.tsx" | \
  grep -v "UI_COLORS\|WPE_BRAND\|STATUS_\|nxai\|var(--\|transparent\|none" | \
  grep -v "51BB7B\|3b82f6\|ef4444\|10b981\|0ECAD4" | \
  sort
```

- [ ] **Step 2: Apply the same token substitution map (from Task 4)**

Work through each file in the list. Apply the same mapping. For each file, only change the values that affect readability in dark mode (text colours, backgrounds, borders). Leave semantic/status colours unchanged.

- [ ] **Step 3: Full build + test**

```bash
npm run build 2>&1 | grep "error TS" | head -10
npm test 2>&1 | grep -E "^Tests:|^Test Suites:" | head -3
```

Expected: no build errors, all tests pass (tests are not affected by style changes).

- [ ] **Step 4: Visual verification checklist**

After `npm run rebuild` and Local restart, verify in **dark mode**:

- [ ] Open Preferences directly (without visiting Dashboard first) — all text legible, no white backgrounds
- [ ] Switch to Dashboard tab — consistent with Preferences
- [ ] Open Site Finder panel — dark backgrounds, no light text on light background
- [ ] Open Bulk Operations panel — consistent
- [ ] Open AI Site Finder — consistent
- [ ] Toggle between light/dark mode in Local settings — verify all panels update

- [ ] **Step 5: Final commit**

```bash
git add src/renderer/components/
git commit -m "fix(dark-mode): replace hardcoded colours in remaining components

Completes dark mode fix. All Nexus components now use CSS custom properties
(--nxai-* tokens) for theme-sensitive colours. Theme injection moved to
root SiteNexusSection so vars are available from first mount regardless
of which panel opens first."
```

---

## Self-Review

**Spec coverage:**
- ✅ CSS injection moved to root — Task 1
- ✅ Token sheet expanded with missing tokens — Task 1
- ✅ NexusPreferences fixed — Task 2 (most visible)
- ✅ NexusOverview remaining colours — Task 3
- ✅ High-count components — Task 4
- ✅ All remaining components — Task 5
- ✅ Build + visual verification — Task 5

**Placeholder scan:** Task 5 Step 2 says "work through each file" — the token map is explicit in Task 4 and applies identically. Not a placeholder — the map is complete and referenceable.

**Type consistency:** `injectThemeVars()` is defined once in Task 1 and imported identically in SiteNexusSection and NexusOverview. No naming inconsistency.
