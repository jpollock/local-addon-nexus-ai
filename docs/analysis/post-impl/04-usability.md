# Post-Implementation Usability Analysis

**Date:** April 17, 2026  
**Branch:** mvp-next  
**Commit:** 4dc9604 (feat(ux): Phase 1 usability repairs)  
**Analysis Scope:** Evaluates fixes to the 9 usability issues identified in previous analysis

---

## Executive Summary

The sprint successfully addressed **7 of 9** major usability issues from the previous analysis. Button naming is now clear, tooltips explain actions, confirmations provide feedback, Preferences are organized into collapsible sections, and a first-run onboarding card guides new users.

However, **3 new UX problems** emerged:

1. **Operations tab labeling is still vague** — "Refresh Site Data" ≠ actual operation names
2. **Progressive disclosure UI is incomplete** — Details toggle doesn't persist state across page reloads
3. **Error messages lack context** — Toast errors say "failed" but don't explain why

This analysis covers what improved, what remains broken, and what new issues the sprint created.

---

## What Improved: Before/After Examples

### 1. Button Labels: Now Action-Specific

| **Old Label** | **New Label** | **Where** | **Tooltip** |
|---|---|---|---|
| "Index Now" | "Index Content" | SiteNexusSection | "Creates a searchable database of posts, pages, and products using AI." |
| "Re-index" | "Update Index" | SiteNexusSection | Same as above |
| "Setup AI" | "Install AI Tools" | SiteNexusSection | "Installs the WordPress AI plugin and configures it with your provider credentials." |
| "Sync Keys" | "Sync AI Credentials" | SiteNexusSection | "Sends your AI provider API key to this WordPress site so AI features work in wp-admin." |
| "Refresh" | "Refresh Metadata" | SiteNexusSection | "Updates WordPress version, plugin list, themes, and admin email from the live site." |

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 635, 746, 814, 856

**Evidence:**
```tsx
// Line 635
const indexButtonText = indexing ? 'Working...'
  : indexEntry ? 'Update Index'
  : 'Index Content';

// Line 746
const setupButtonText = settingUpAI ? 'Working...' : 'Install AI Tools';

// Line 814, 856
children: refreshingMetadata ? 'Working...' : 'Refresh Metadata',
children: syncingCreds ? 'Working...' : 'Sync AI Credentials',
```

---

### 2. Preferences Now Organized into 5 Collapsible Sections

| **Section** | **Status** | **Contents** |
|---|---|---|
| AI Provider | Expanded by default | Provider picker, model selection, API key entry, validation |
| Local AI Gateway | Collapsed | Gateway enable/disable, status |
| Auto-Indexing | Collapsed | Auto-index toggle, excluded sites list |
| WP Engine | Collapsed | API credentials, auto-sync metadata, SSH refresh, offline site refresh |
| Advanced | Collapsed | Webhooks, REST API |

**File:** `/src/renderer/components/NexusPreferences.tsx` lines 960–1245

**Evidence:**
```tsx
// Line 173 — default state
expandedSections: new Set(['ai-provider']),

// Line 518 — section header with toggle
renderSectionHeader(sectionId: string, title: string): React.ReactElement {
  const expanded = this.state.expandedSections.has(sectionId);
  // Render chevron icon and onClick handler
}

// Line 964 — WP Engine section
this.renderSectionHeader('wpe', 'WP Engine'),
```

**Old Flow:** Scroll through 40+ settings in one long page.

**New Flow:** 
1. Open Preferences
2. See AI Provider section expanded, others collapsed
3. Click "WP Engine" header to expand/collapse
4. All settings remain grouped and discoverable

---

### 3. Toast Confirmations for All Actions

Every button click now shows a 3-second toast:

| **Action** | **Success Message** | **Error Message** |
|---|---|---|
| Index Content | `Indexed 1,234 documents in 45s` | `Indexing failed. Try indexing fewer sites at once.` |
| Refresh Metadata | `Metadata updated — WordPress 6.5.2 (was 6.5.1) · 23 plugins (was 22)` | `Metadata refresh failed: [error reason]` |
| Sync AI Credentials | `Credentials synced successfully.` | `Credentials sync failed. Your API key may be invalid. Re-enter it in Preferences.` |
| Install AI Tools | `AI tools installed and ready.` | `Setup failed. Check that the site is running. Start it from Local, then try again.` |

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 287–363

**Evidence:**
```tsx
// Line 287 — after indexing completes
const msg = `Indexed ${docCount.toLocaleString()} documents in ${elapsed}s`;
(window as any).showToast?.(msg, 'success');

// Line 305 — success or error toast
const msg = result.success
  ? 'AI tools installed and ready.'
  : `${result.message || 'Setup failed'}. Check that the site is running...`;
(window as any).showToast?.(msg, result.success ? 'success' : 'error');
```

**Old Flow:** Click button → button shows "Working..." → button returns to normal → ??? (did it work?)

**New Flow:** Click button → button shows "Working..." → toast appears with result → toast disappears after 3 sec

---

### 4. Tooltips on All Buttons & Status Labels

Every button now has a `title=` attribute with 1–2 line explanation:

**SiteNexusSection buttons:**
- Index Content button: "Creates a searchable database of posts, pages, and products using AI. Run after adding content to your site."
- Refresh Metadata button: "Updates WordPress version, plugin list, themes, and admin email from the live site."
- Sync AI Credentials button: "Sends your AI provider API key to this WordPress site so AI features work in wp-admin."
- Upgrade to WP 7.0 button: "Upgrade WordPress to the latest version. Required for AI features."

**Status labels:**
- "Indexed" label: "Content is indexed for semantic search. Update Index if you've published new content."
- "Stale" metadata label: "This data is more than 24 hours old. Click Refresh Metadata to update it."

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 636–651, 805–816

**Evidence:**
```tsx
// Line 636–639 — index button tooltip
const indexButtonTitle = indexing ? undefined
  : indexEntry
  ? 'Creates a searchable database of posts, pages, and products using AI. Run after adding content to your site.'
  : 'Creates a searchable database of posts, pages, and products using AI. Run after adding content to your site.';

// Line 644 — status label tooltip
React.createElement('span', {
  style: dotStyle(stateColor),
  title: stateLabelTooltip,
}),
```

---

### 5. Error Recovery Guidance

Error messages now include actionable next steps:

| **Error** | **Old Message** | **New Message** |
|---|---|---|
| Setup AI failed | ❌ Setup failed | ❌ Setup failed. Check that the site is running. Start it from Local, then try again. |
| Credentials sync failed | ❌ Sync Keys failed | ❌ Credentials sync failed. Your API key may be invalid. Re-enter it in Preferences. |
| Index failed | ❌ Indexing failed | ❌ Indexing failed. Try indexing fewer sites at once. |

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 290–291, 305–306, 352

---

### 6. First-Run Onboarding Card

New users see a dismissible card with 3-step Getting Started flow:

**Card Content:**
```
Getting Started with Nexus AI  [X]

1. Configure your AI provider in Preferences to connect Claude, OpenAI, or another provider.

2. Enable auto-indexing in Preferences so new content is indexed automatically when sites start.

3. Go to a site and click "Install AI Tools" to enable WordPress AI features on that site.

[ Dismiss — don't show again ]
```

**Appearance:**
- Shows on first Dashboard visit
- Green-tinted card with WPE brand border
- Dismissible via X button or "Dismiss" link
- Won't show again after dismissed (state persisted via `onboardingDismissed` setting)

**File:** `/src/renderer/components/NexusOverview.tsx` lines 1357–1447

**Evidence:**
```tsx
// Line 1357–1358 — only render if not dismissed
renderOnboardingCard(): React.ReactNode {
  if (this.state.onboardingDismissed) return null;
  // ...
}

// Line 1345–1355 — save dismissal state
handleDismissOnboarding = async (): Promise<void> => {
  this.setState({ onboardingDismissed: true });
  // Persist to settings
  await this.props.electron.ipcRenderer.invoke(
    IPC_CHANNELS.UPDATE_SETTINGS,
    { onboardingDismissed: true },
  );
};
```

---

### 7. Progressive Disclosure in Per-Site Panel

Details are now collapsed by default — users see only:
- Index status + action button
- WordPress version
- AI Provider

Details section (hidden by "Show details ▸") includes:
- Documents + chunks
- Last indexed
- Auto-index toggle
- Metadata age + refresh
- AI Plugin status (if not active)
- Local AI Gateway status
- Credentials sync status
- AI Context file
- Database health

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 627–932

**Evidence:**
```tsx
// Line 630 — split into always-visible and detail rows
const alwaysRows: React.ReactElement[] = [];
const detailRows: React.ReactElement[] = [];

// Lines 627–653 — always show these
alwaysRows.push(row('Index status', ...));

// Lines 920–924 — toggle to show/hide details
onClick: () => this.setState({ detailsExpanded: !detailsExpanded }),
detailsExpanded ? 'Hide details \u25be' : 'Show details \u25b8',

// Line 931 — conditionally render detail rows
...(detailsExpanded ? detailRows : []),
```

**Old Flow:** 18 rows visible, all info at once, overwhelming.

**New Flow:** 3 rows always visible, user clicks "Show details ▸" to expand, cleaner at a glance.

---

### 8. CLI: "reindex" Deprecated, "index" Primary

**Old:**
```bash
nexus content reindex mysite
```

**New:**
```bash
nexus content index mysite
# or deprecated (still works):
nexus content reindex mysite
# ⚠️  "nexus content reindex" is deprecated. Use "nexus content index" instead.
```

**File:** `/src/cli/commands/content.ts` lines 320–361

**Evidence:**
```tsx
// Line 320–321 — primary command
.command('index <target>')
.description('Index content for a site (creates searchable database of posts, pages, and products)')

// Line 360–361 — deprecated alias
.command('reindex <target>')
.description('[Deprecated] Use "nexus content index" instead')
// Line 363 — warn but still execute
console.warn('\n⚠️  "nexus content reindex" is deprecated. Use "nexus content index" instead.\n');
```

---

### 9. CLI: "Twin" → "Site Data"

**Old:**
```
Site data:    ❌ None — run: nexus sites refresh mysite
```

**New:**
```
Site data:    ❌ Not available — run: nexus sites refresh mysite
```

**File:** `/src/cli/commands/sites.ts` line 127

---

## What's Still Broken

### 1. Operations Tab Labels Don't Match Button Descriptions

**Issue:** The Operations tab groups buttons under generic labels that don't match the button descriptions.

| **Tab Label** | **Button Inside** | **Mismatch** |
|---|---|---|
| "Refresh Site Data" | "Refresh local sites" | Both mean the same thing; inconsistent naming |
| "Index for Search" | "Index local sites" | Same content, different phrasing |
| "AI Features" | "Set up AI on all local sites" | Label is singular, button is plural |

**File:** `/src/renderer/components/NexusOverview.tsx` lines 1690–1722

**Evidence:**
```tsx
// Line 1691 — label
React.createElement('div', { style: groupLabelStyle }, 'Refresh Site Data'),

// Line 1694 — button inside
'Refresh local sites', 'Syncing...',
this.handleSyncGraph,
```

**Impact:** Users see "Refresh Site Data" → "Refresh local sites" and may think they're different operations. The inconsistency creates cognitive friction.

**Fix:** Either rename tab labels to match buttons ("Refresh Local/WPE Sites" and "Index Local/WPE Sites") or make button text shorter to align with the tab ("Refresh", "Index").

---

### 2. Preferences Section Names Weren't Fully Updated

**Issue:** One section kept old naming:

| **Section** | **Current Name** | **Old Name** | **Issue** |
|---|---|---|---|
| WP Engine metadata sync | "Auto-Sync WP Engine Metadata" | ✓ Updated | Clear |
| WP Engine SSH scan | "Auto-Update WP Engine Site Info" | ✓ Updated (was "WPE SSH Refresh") | Clear |
| Offline sites refresh | "Refresh Offline Sites" | ✓ Updated (was "Halted Site Refresh") | Clear |

Actually, upon review, **all section names were updated correctly**. No issue here. ✓

---

### 3. Per-Site Panel Details Toggle Doesn't Persist

**Issue:** The "Show details ▸" toggle state is stored in component state, not persisted. When user navigates away or reloads, the expanded state is lost.

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 60, 153, 920

**Current Behavior:**
1. User opens site page
2. Clicks "Show details ▸" to expand
3. Navigates to another site (SiteNexusSection unmounts)
4. Returns to first site
5. Details are collapsed again (state lost)

**Expected Behavior:** Remember whether user had details expanded for each site.

**Impact:** Repeated clicks to expand details is annoying.

**Fix:** Store `detailsExpanded` in user preferences per site ID, or at minimum in a global component state shared across mount/unmount.

---

### 4. Error Messages Lack Recovery Hints in Some Places

**Issue:** Some IPC handlers still show generic errors without recovery guidance.

**Example:** BulkOperationsPanel result display (line 268–279):

```tsx
// From commit 4dc9604 diff
if (result.success) {
  this.setState({ operations: result.operations || [], loading: false, error: null });
} else {
  this.setState({
    error: result.error || 'Failed to load operations',  // ← Generic fallback
    loading: false,
  });
}
```

The success/error toasts in `SiteNexusSection` are great, but bulk operation results show errors in a panel without recovery hints.

**File:** `/src/renderer/components/BulkOperationsPanel.tsx` lines 252–279

**Impact:** Low — bulk operations show success badges, but failed items don't have helpful next steps.

---

### 5. Onboarding Card Doesn't Show on Subsequent Visits if Dismissed

**Issue:** Once dismissed, the card never shows again — there's no way to re-trigger it for new users who accidentally dismiss it.

**File:** `/src/renderer/components/NexusOverview.tsx` line 1358

**Current Behavior:** User dismisses card → state: `onboardingDismissed: true` → card hidden forever

**Expected Behavior:** Option to "Show Getting Started guide again" somewhere in Preferences or Dashboard.

**Impact:** Low — power users won't need it, but if a new user dismisses it by accident, they can't see it again without clearing app data.

---

## New Issues Introduced by the Sprint

### 1. Install AI Tools Button Still Shows Version Requirement as Disabled State

**Issue:** When WordPress version < 7.0, the button is disabled and shows a tooltip, but the disabled state is visually subtle.

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 747–762

**Evidence:**
```tsx
const setupButtonText = settingUpAI ? 'Working...' : 'Install AI Tools';
const setupDisabled = settingUpAI || !canSetupAI;
const setupTitle = !canSetupAI
  ? 'Requires WordPress 7.0 or later. Upgrade WordPress first.'
  : 'Installs the WordPress AI plugin...';

alwaysRows.push(row('AI Provider',
  // ...
  this.createActionButtonWithTitle({
    onClick: canSetupAI ? () => this.setState({ ... }) : undefined,
    disabled: setupDisabled,  // ← Silent disabled state
    title: setupTitle,
    children: setupButtonText,
  }),
));
```

**Problem:** The button label is still "Install AI Tools" even when disabled. A user might:
1. See "Install AI Tools" button
2. Try to click it
3. Nothing happens (button is disabled)
4. Hover to see tooltip explaining WordPress requirement

vs. if it showed "Upgrade WordPress first" in the button text, it would be clearer upfront.

**This was addressed in the old analysis but the fix is partial** — the tooltip is there, but the button text doesn't change. This is acceptable UX, not a critical bug.

---

### 2. Toast Confirmations Are Too Fast on Slow Networks

**Issue:** Toast messages disappear after 3 seconds, but on slow connections, an operation might take 10+ seconds to complete.

**File:** `/src/renderer/components/SiteNexusSection.tsx` lines 287–363

**Example:**
1. User clicks "Index Content"
2. Button shows "Working..."
3. Operation takes 15 seconds
4. Toast appears "Indexed 5,000 documents" → disappears in 3 seconds
5. User might miss the success message

**Impact:** Low — the button state changes from "Working..." to "Update Index", so user knows it completed.

**Fix:** Make toast duration dynamic based on operation duration, or increase to 5 seconds.

---

### 3. Site Data Label Used Inconsistently Across CLI

**Issue:** The CLI replaced "twin" with "site data" in `sites get` command, but internal types and GraphQL still use `twinCompleteness`, `twinAge`.

**File:** `/src/cli/commands/sites.ts` line 125

**Evidence:**
```tsx
// User-facing: "Site data"
console.log(`Site data:    ${icon} ${site.twinCompleteness} · ${site.twinAge ?? 'unknown age'}`);

// But the field is still called twinCompleteness (internal)
if (site.twinCompleteness && site.twinCompleteness !== 'none') {
```

**Impact:** Low — end users see "Site data" (good), but the backend uses "twin" terminology (internal only, acceptable).

**Fix:** Rename GraphQL fields from `twinCompleteness` → `siteDataCompleteness` for consistency, but this is optional for internal code.

---

## Operations Tab Assessment

**Question:** Is the current tab structure clear to a new user?

**Tab Structure in Operations Tab:**

```
┌─ Refresh Site Data
│  ├ Refresh local sites
│  └ Refresh WPE sites
├─ Index for Search
│  ├ Index local sites
│  └ Index WPE sites
├─ AI Features
│  └ Set up AI on all local sites
├─ WP Engine
│  ├ Create WPE Backup
│  ├ Sync WPE Metadata Now
│  └ Go-Live Checklist
├─ Maintenance
│  └ Scan all sites for health issues
└─ Developer Tools
   └ SSH diagnostics
```

**Assessment: 7/10 — Good but Could Be Clearer**

**Strengths:**
- Clear grouping (Refresh, Index, AI, WPE, Maintenance, Developer)
- Buttons have 1–2 line descriptions (tooltips)
- Each button is self-contained and obvious

**Weaknesses:**
- "Refresh Site Data" label doesn't match "Refresh local sites" button name (see issue #1)
- "Maintenance" section has only one button; could be integrated into another section
- No indication which operations can run in parallel vs. which must run sequentially

**Recommendation:** Keep tab structure, but rename group labels to match button text:
- "Refresh Site Data" → "Refresh Sites" (both local and WPE)
- "Index for Search" → "Index Sites" (both local and WPE)
- "Maintenance" → remove label, show "Database Health" directly

---

## Onboarding Assessment

**Question:** Does the new onboarding card actually help? What's still missing?

**Current Onboarding Card Strength:**

1. **Timing:** Appears on first Dashboard visit → good timing
2. **Brevity:** 3 steps, takes < 30 seconds to read → good
3. **Links:** Step 1–2 have clickable "Preferences" link that opens Preferences panel → excellent UX
4. **Clarity:** Each step says exactly what to do and where to do it
5. **Dismissal:** User can dismiss with X button or "Dismiss" link → respects power user workflows

**Current Onboarding Card Weakness:**

1. **No progress tracking:** After user completes step 1 (configure AI provider), the card doesn't acknowledge it or move to step 2
2. **No "next steps" after completion:** After user completes all 3 steps, there's no "you're all set!" message
3. **No recovery if dismissed:** Card can't be triggered again without clearing app data (see issue #5 above)
4. **No help links:** Card says "Configure your AI provider" but doesn't link to docs explaining what an API key is or which provider to choose

**Missing Elements:**

| **Missing Element** | **Importance** | **Example** |
|---|---|---|
| Progress indicator | Medium | "Step 1 of 3: Configure AI Provider" |
| Completion checklist | High | After step 1, show ✓ to indicate done |
| "Next steps" messaging | Medium | After all 3, show "Ready to use Nexus AI! Try: nexus content index mysite" |
| Help links | Medium | "What's an API key?" link in step 1 |
| Reshow option | Low | "Preferences → About → Show Getting Started guide" |

**Overall Assessment: 7/10 — Good, But Could Be Incremental**

The card successfully explains the 3 critical steps, but doesn't:
- Track which steps are completed
- Celebrate completion
- Guide users to their first successful action (e.g., "You configured Claude! Now try indexing your site")

---

## Top 5 Remaining Usability Improvements

### 1. Make Details Toggle Persistent Per-Site (High Impact, Low Effort)

**Why:** Users who want to see details have to click "Show details ▸" every time they visit the site page.

**How:** 
- Store `detailsExpanded` per site ID in Preferences
- Or persist in component state using a context provider

**Effort:** 2 hours

**Impact:** Annoyance → convenience for detail-oriented users

---

### 2. Normalize Operations Tab Labels to Match Button Names (High Impact, Low Effort)

**Why:** "Refresh Site Data" and "Refresh local sites" are the same operation but use different names → cognitive dissonance.

**How:**
- Rename "Refresh Site Data" → "Refresh Sites" (both local and WPE)
- Rename "Index for Search" → "Index Sites" (both local and WPE)
- Remove "Maintenance" label, inline the database health scan

**Effort:** 30 minutes

**Impact:** Reduces confusion for new users who see multiple names for the same operation

---

### 3. Add "Completion Checklist" to Onboarding Card (High Impact, Medium Effort)

**Why:** Users don't know if they've completed the Getting Started steps or what to do next.

**How:**
- Track which of the 3 steps are done (step 1: AI provider configured, step 2: auto-index enabled, step 3: site has AI tools installed)
- Show checkmarks as user completes steps
- After all 3 are done, show "You're ready! Try: nexus content index mysite"

**Effort:** 4 hours

**Impact:** Users know their progress and have a concrete "first action" to try

---

### 4. Add Error Context to Bulk Operation Failures (Medium Impact, Medium Effort)

**Why:** When a bulk operation fails for one site, the result shows "Failed" but no recovery hint.

**How:**
- Capture error reason from each site's result
- Show "Failed: Site not running" vs. "Failed: Permission denied" vs. generic "Failed"
- Add a "Retry" button for transient failures (site not running)

**Effort:** 3 hours

**Impact:** Bulk operations don't feel like a black box

---

### 5. Add "Re-Show Onboarding" to Preferences (Low Impact, Low Effort)

**Why:** If a user accidentally dismisses the Getting Started card, they can't trigger it again.

**How:**
- Add a checkbox in Preferences: "Show Getting Started guide on next visit"
- Or add a "Preferences → Help → Getting Started" button

**Effort:** 1 hour

**Impact:** Fail-safe for users who dismiss the card by accident

---

## Summary: Pre-Sprint vs. Post-Sprint Scorecard

| **Category** | **Pre-Sprint Score** | **Post-Sprint Score** | **Status** |
|---|---|---|---|
| **Button Naming Clarity** | 2/10 (confusing) | 9/10 (action verbs) | ✅ Fixed |
| **Tooltip Coverage** | 1/10 (none) | 9/10 (on all buttons) | ✅ Fixed |
| **Feedback Loops (Toasts)** | 2/10 (silent) | 8/10 (informative) | ✅ Fixed |
| **Error Guidance** | 1/10 (generic) | 7/10 (actionable hints) | ✅ Mostly Fixed |
| **Preferences Organization** | 2/10 (wall of text) | 8/10 (5 sections) | ✅ Fixed |
| **First-Run Onboarding** | 0/10 (none) | 7/10 (3-step card) | ✅ Fixed |
| **Progressive Disclosure** | 3/10 (18 rows visible) | 8/10 (details toggle) | ✅ Fixed |
| **CLI Naming Alignment** | 4/10 (reindex vs. Index) | 9/10 (index primary) | ✅ Fixed |
| **Terminology Consistency** | 3/10 (twin jargon) | 8/10 (site data) | ✅ Fixed |
| **Operations Tab Clarity** | 6/10 (decent grouping) | 6/10 (label mismatch) | ⚠️ Regressed |

**Overall:** Pre-sprint average **2.2/10** → Post-sprint average **7.9/10**  
**Impact:** **+5.7 points** — substantial improvement

---

## Recommendations for Next Sprint

1. **Quick wins** (< 2 hours each):
   - Rename Operations tab group labels to match button text
   - Add "Re-Show Onboarding" checkbox to Preferences
   - Increase toast duration from 3 to 5 seconds

2. **Medium effort** (2–4 hours each):
   - Make details toggle persistent per-site
   - Add completion checklist to onboarding card

3. **Consider for future**:
   - Full contextualized error messages for bulk operations
   - Interactive onboarding tour (highlight key buttons on each visit)
   - In-app help system with links to docs

---

## Appendix: Files Changed in This Sprint

| **File** | **Lines Changed** | **Key Changes** |
|---|---|---|
| `src/renderer/components/SiteNexusSection.tsx` | +382 / -335 | Button renaming, tooltips, toasts, progressive disclosure |
| `src/renderer/components/NexusPreferences.tsx` | +467 / -335 | 5 collapsible sections, renamed labels |
| `src/renderer/components/NexusOverview.tsx` | +109 | Onboarding card rendering |
| `src/cli/commands/content.ts` | +49 / -49 | `index` command primary, `reindex` deprecated |
| `src/cli/commands/sites.ts` | +6 / -6 | "Twin" → "Site data" in output |

**Total Churn:** ~1,100 lines changed across 5 files

---

**Last Updated:** April 17, 2026 (post-implementation)  
**Next Review:** After addressing top 5 improvements in next sprint
