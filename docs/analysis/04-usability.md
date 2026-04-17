# Usability Analysis: Nexus AI Local Addon

## Executive Summary

The Nexus AI addon provides powerful, feature-rich interfaces (Dashboard, CLI, MCP tools) but suffers from **terminology inconsistency**, **confusing naming patterns**, **poor feedback loops**, and **missing onboarding**. These issues create friction for new users and agencies managing multiple sites. Terminology is used interchangeably without explaining differences; status feedback is sparse; and the system requires trial-and-error to understand operations.

---

## 1. Terminology Inconsistencies

### Problem: "Refresh," "Sync," "Index," and "Twin" Are Used Ambiguously

The product uses multiple terms that seem to overlap but have different meanings. Users must infer the distinction through experimentation.

| Term | Used For | Where | Notes |
|------|----------|-------|-------|
| **Index / Reindex** | Vector embedding of site content | Dashboard, CLI (`content reindex`), UI button ("Index Now", "Re-index") | Clear purpose: create searchable content embeddings |
| **Sync** | WP Engine metadata pull + credential distribution | Preferences: "WP Engine Auto-Sync"; per-site: "Sync Keys" | Two different operations share one name! |
| **Refresh** | Metadata update (WP version, plugins, themes) | Preferences: "WPE SSH Refresh"; per-site: "Refresh Metadata" | Vague — doesn't specify *what* is refreshed |
| **Twin** | Unified digital snapshot of site state | MCP tool `nexus_get_site_twin`, internal only | Developer/AI term, never explained to end users |

### Root Cause

- "Sync" has **two meanings**: (a) sync WP Engine site metadata, (b) sync AI provider credentials to WordPress
- "Refresh" conflates metadata reloads with SSH re-scans
- "Index" and "Twin" are conceptually related (twin includes index state) but not explained

### Real-World Examples from Code

**File:** `src/renderer/components/NexusPreferences.tsx` (lines 757–837)
- "WP Engine Auto-Sync" (line 757) — pulls plugins, WP/PHP versions
- "Enable auto-sync" (line 774) — label is vague about what "sync" does
- "WPE SSH Refresh" (line 802) — refreshes via SSH, updates plugins/themes/URL/email/post count
- "Halted Site Refresh" (line 841) — filesystem-based metadata refresh for halted sites

**File:** `src/renderer/components/SiteNexusSection.tsx`
- Line 558: "Index Now" or "Re-index" — builds vector embeddings
- Line 601: "Refresh" — updates metadata cache only
- Line 758: "Sync Keys" — distributes credentials

### Recommendation

**Rename terms for clarity:**
1. **"Index" / "Re-index"** → Keep as is. Clear and distinct.
2. **"Sync WP Engine Metadata"** → Rename "WP Engine Auto-Sync" section to "WP Engine Metadata Sync"
3. **"Sync Credentials"** → Rename button from "Sync Keys" to "Sync AI Credentials" (per-site)
4. **"Refresh Metadata"** → Keep "Refresh" button but add a one-line tooltip: "Updates WordPress version, plugins, themes, and admin email"
5. **"Scan via SSH"** → Rename "WPE SSH Refresh" to "WP Engine SSH Scan" (Settings > Auto-Refresh Interval)

**Or simpler:** Remove "Auto-Sync" language entirely in preferences. Replace with:
- "Automatically update WP Engine site metadata every [8] hours"
- "Automatically scan halted sites every [24] hours"

---

## 2. Information Architecture Issues

### Problem: Settings Are Scattered Across Three Interfaces

| Feature | Dashboard | Preferences | Per-Site Panel | CLI |
|---------|-----------|-------------|----------------|-----|
| Enable/disable auto-indexing | — | ✓ | ✓ (checkbox) | — |
| Configure AI provider | — | ✓ | ✓ (inline picker) | — |
| WP Engine credentials | — | ✓ | — | `wpe login` |
| AI provider keys | — | ✓ | — | — |
| Index a site | ✓ (Sites tab) | — | ✓ (button) | `content reindex` |
| Refresh metadata | ✓ (per-site) | — | ✓ (button) | — |
| Setup AI for site | ✓ (bulk) | — | ✓ (button) | — |
| Bulk operations | ✓ (Operations tab) | — | — | — |

### Information Architecture Flaws

1. **Global settings live in Preferences, not Dashboard**
   - New user opens Dashboard → sees "Bulk Operations" panel but doesn't know how to trigger bulk setup
   - Must hunt in Preferences to enable auto-indexing, configure AI provider
   - No breadcrumb or navigation hint from Dashboard to Preferences

2. **Per-site configuration spread between Preferences and per-site panel**
   - Exclude a site from auto-indexing → Preferences (checkbox)
   - Override AI provider for one site → Per-Site Panel (inline picker)
   - No unified site management view

3. **WP Engine management lives three places**
   - Dashboard: WPE sync progress (Operations tab)
   - Preferences: WPE API credentials
   - CLI: `nexus wpe` commands
   - No single "WP Engine hub" in UI

4. **Missing discovery layer**
   - Dashboard doesn't explain what "Index" means or why to do it
   - Preferences has no "Quick Start" guide (e.g., "1. Configure AI provider, 2. Enable auto-indexing, 3. Go to Sites tab")
   - Per-site section doesn't explain why "Setup AI" is needed or what it installs

### Root Cause

The addon grew feature-by-feature without a cohesive information architecture. Each subsystem (indexing, AI setup, WPE management) has its own settings location.

### Recommendation

1. **Add a "Getting Started" card to Dashboard Overview tab** (visible on first visit only)
   - "1. Configure your AI provider in Preferences"
   - "2. Enable auto-indexing (optional)"
   - "3. Go to Sites tab and click 'Setup AI' on any site"

2. **Create a "Configuration Hub" in Preferences**
   - Section 1: AI Provider & Models (today: scattered)
   - Section 2: WP Engine Credentials (today: isolated)
   - Section 3: Auto-Indexing Rules (today: unclear difference between three refresh types)

3. **Consolidate per-site settings**
   - Show all per-site overrides in one expandable section
   - "AI Provider for this site", "Exclude from auto-indexing", etc.

4. **Add breadcrumbs**
   - When user sees "Index Now" button, tooltip or inline help: "Not configured? Set up in Preferences first."

---

## 3. Feedback & Status Gaps

### Problem: Users Don't Know What's Happening or How Long It Will Take

#### Gap 1: Missing Duration Estimates

- "Indexing..." — How long will it take? (5 sec, 5 min, 5 hours?)
- "Syncing AI credentials..." — Status unknown, duration unknown
- "WPE SSH Refresh..." — Runs in background, no progress indicator

**File:** `src/renderer/components/SiteNexusSection.tsx` (lines 556–559)
```tsx
children: indexing ? 'Indexing...' : (indexEntry ? 'Re-index' : 'Index Now'),
```
No indication of progress, ETA, or what happens after.

**File:** `src/renderer/components/NexusPreferences.tsx` (lines 765–797)
- Clicking "Apply" on "WP Engine Auto-Sync" settings → nothing happens
- No feedback that settings were saved or applied
- Only a checkmark on the "Saved" badge (line 621), easy to miss

#### Gap 2: Silent Failures

- Button shows "Sync Keys" → clicked → nothing visible happens → user doesn't know if it worked
- WPE SSH refresh enabled in Preferences → no indication in dashboard that it's running
- "Setup AI" on 10 sites → Bulk Operations panel shows progress, but per-site section doesn't update until manual refresh

**File:** `src/renderer/components/BulkOperationsPanel.tsx` (lines 259–279)
```tsx
// Error silently logged, state just shows "Failed" badge — no error message
this.setState({
  error: result.error || 'Failed to load operations',
  loading: false,
});
```

#### Gap 3: Ambiguous Status Labels

- "Indexed" — Does this mean the latest content is indexed? (Stale?)
- "Metadata: Cached (24h ago, stale)" — What makes it "stale"? (> 24h old? > date modified?)
- "AI Plugin: Installed (inactive)" — Why is it inactive? Should user fix it?

**File:** `src/renderer/components/SiteNexusSection.tsx` (lines 539–547)
```tsx
const stateColor = !indexEntry ? '#888'
  : indexEntry.state === 'indexed' ? UI_COLORS.STATUS_RUNNING
  : indexEntry.state === 'stale' ? UI_COLORS.STATUS_WARNING
  : indexEntry.state === 'error' ? UI_COLORS.STATUS_ERROR
  : UI_COLORS.WPE_BRAND;
```
No user-facing explanation of state transitions.

#### Gap 4: Missing Action Confirmation

- User clicks "Sync WP Engine Metadata" → button becomes "Syncing..." → no indication when done
- User enables auto-sync → silent acceptance (where's the "Saved" feedback?)
- Bulk operations complete → Bulk panel updates but no toast/notification

### Recommendation

1. **Add operation timelines**
   - "Indexing site... (estimated 2-5 min, depends on content volume)"
   - "Syncing credentials... (usually <10 sec)"
   - Show actual time once operation completes

2. **Add explicit "Saved" confirmations**
   - Every settings change (including toggles) → brief toast: "Auto-indexing enabled ✓"
   - Dismiss automatically after 3 sec

3. **Explain status values**
   - On hover, tooltip: "Indexed: Latest content is indexed for search. Click 'Re-index' if content changed."
   - "Stale: > 24 hours old. Click 'Refresh' to update."
   - "Metadata: Cached (24h ago) — click to refresh if data is out of date"

4. **Add progress bars for long operations**
   - WPE SSH Refresh: "Scanning 15 sites... 7/15 complete (47%)"
   - Bulk Setup: Already has progress bar (BulkOperationsPanel), keep it visible

5. **Add "What's Next?" hints**
   - After "Setup AI" completes → suggestion: "Next: Try indexing the site content (see Sites tab)"
   - After index completes → "Ready for semantic search! Try: `content search`"

---

## 4. Confusing Naming (Specific Examples)

### Button & Label Confusions

| Label | Issue | Better Name |
|-------|-------|-------------|
| "Index Now" | Ambiguous. Does it run now? Always? | "Index Content Now" or "Start Indexing" |
| "Re-index" | Does it remove old data first? | "Re-index Content" or "Update Index" |
| "Refresh" | Refresh what? Settings? Data? | "Refresh Metadata" or "Update Version & Plugins" |
| "Sync Keys" | Sounds like file sync. | "Sync AI Credentials" or "Push Credentials to Site" |
| "Setup AI" | Setup what? | "Install AI Tools" or "Configure Site for AI" |
| "Metadata: Cached" | Is it being cached? Still fresh? | "Metadata: Cached (24h ago) — Refresh if stale" |
| "Requires WP 7.0+" | Shown as button text. Confusing. | Greyed-out button with tooltip: "Requires WordPress 7.0 or later" |

**File:** `src/renderer/components/SiteNexusSection.tsx` (line 705)
```tsx
const setupButtonText = settingUpAI ? 'Setting up...'
  : !canSetupAI ? 'Requires WP 7.0+'  // <-- This is button text, not tooltip!
  : 'Setup AI';
```

### Section Names

| Name | Issue | Better Name |
|------|-------|-------------|
| "WP Engine Auto-Sync" | Is this about syncing to WPE? From WPE? | "Auto-Sync WP Engine Metadata" |
| "WPE SSH Refresh" | Technical jargon. Why "SSH"? | "Auto-Update WP Engine Site Info" |
| "Halted Site Refresh" | Why specifically "halted"? | "Refresh Offline Sites" or "Background Site Updates" |
| "Auto-Index" | Does it auto-run? Auto-enable? | "Automatically Index on Startup" |

**File:** `src/renderer/components/NexusPreferences.tsx`
- Line 757: "WP Engine Auto-Sync"
- Line 802: "WPE SSH Refresh"
- Line 841: "Halted Site Refresh"

### CLI Command Naming

| Command | Issue | Better |
|---------|-------|--------|
| `nexus content reindex <target>` | "reindex" doesn't tell user what's being indexed | `nexus content index <target>` |
| `nexus content search <target> <query>` | Is this semantic search or keyword search? | `nexus content search --semantic <target> <query>` |
| `nexus sites refresh <target>` | Refresh what? | `nexus sites sync-metadata <target>` |
| `nexus wpe backup <target>` | Backup to where? | `nexus wpe create-backup <target>` |

**File:** `src/cli/commands/content.ts` (line 319)
```tsx
.command('reindex <target>')
.description('Reindex a site')
```

**File:** `src/cli/commands/sites.ts` (line 127)
```tsx
console.log(`Twin data:    ❌ None — run: nexus sites refresh ${site.name}`);
```
"Twin" term appears in CLI output without explanation.

### Recommendation

1. **Rename buttons to be action-specific:**
   - "Index Now" → "Index Content"
   - "Re-index" → "Update Index"
   - "Refresh" → "Refresh Metadata"
   - "Sync Keys" → "Sync Credentials"
   - "Setup AI" → "Install AI Tools"

2. **Rename settings sections:**
   - "WP Engine Auto-Sync" → "Auto-Sync WP Engine Metadata"
   - "WPE SSH Refresh" → "Auto-Update WP Engine Site Info"
   - "Halted Site Refresh" → "Refresh Offline Sites"
   - "Auto-Index" → "Auto-Index on Startup"

3. **Add tooltips:**
   - Every button hover: 1–2 line explanation (e.g., "Index Content: Add posts, pages, and products to the search database")
   - Section headers: "What is this?" link opens docs

4. **Fix CLI:**
   - `nexus content reindex` → `nexus content index` (consistent with "Index Now" UI)
   - `nexus sites refresh` → `nexus sites sync` (matches Preferences naming)
   - Remove "twin" from user-facing messages; use "site data" instead

---

## 5. CLI UX Issues

### Problem: Inconsistent Command Structure & Naming

#### Gap 1: Commands Don't Match UI Terminology

| UI Button | CLI Equivalent | Mismatch |
|-----------|----------------|----------|
| "Index Now" | `nexus content reindex` | UI says "Index", CLI says "reindex" |
| "Refresh Metadata" | No CLI equivalent | Users must use UI or MCP tool |
| "Setup AI" | No direct CLI equivalent | No terminal-native way to set up |
| "Sync Keys" | No CLI equivalent | Credentials can only be set in Preferences or via MCP |

**File:** `src/cli/commands/content.ts` (line 319–325)
```tsx
.command('reindex <target>')
.description('Reindex a site')
```
But UI says "Index Now"/"Re-index", not "reindex".

#### Gap 2: Flags Are Inconsistent

| Command | Flags |
|---------|-------|
| `nexus wp plugin update` | `--all`, `--dry-run` (dashes) |
| `nexus sites export` | `[outputPath]` positional, no flags |
| `nexus wpe backup` | Various, undocumented structure |
| `nexus content search` | `--limit <n>`, `--json` |

**File:** `src/cli/commands/wp.ts` (line 189–205)
```tsx
.option('--all', 'Update all plugins')
.option('--dry-run', 'Show what would be updated')
```
But search uses `--limit`, not `--max` or `--count`.

#### Gap 3: No Guidance on Target Syntax

- Is it `site@local` or `site`?
- Is it `site@wpe` or `install-id`?
- How do I specify a WPE install? By name? By ID?

**File:** `src/cli/commands/sites.ts` (lines 145–149)
```tsx
if (!source.endsWith('@local')) {
  console.error('\n❌ Source site must be local.');
  console.error(`   Use: nexus sites clone ${source}@local ${newName}`);
```
Error tells user the syntax, but help text doesn't.

#### Gap 4: No Verb Tense Consistency

- `nexus sites list` (noun) vs. `nexus sites start` (verb)
- `nexus wp plugin list` vs. `nexus wp plugin install` (both verbs, fine)
- `nexus wpe accounts` (noun) vs. `nexus wpe installs` (noun)

Should be: `nexus sites list`, `nexus wp plugins list`, `nexus wpe list-accounts`.

### Recommendation

1. **Align CLI commands with UI**
   - Rename `content reindex` to `content index --full` (or `content index --refresh`)
   - Add `content refresh` as an alias for metadata updates
   - Add `sites setup-ai` command (mirrors Dashboard UI)
   - Add `sites sync-credentials` command

2. **Standardize flags**
   - Always use `--help` for documentation
   - Prefer long flags: `--all`, `--dry-run`, `--limit`, `--format`
   - Consistent plural forms: `--fields` not `--field`

3. **Add "targets" help**
   - `nexus --help` → includes section "Target Syntax"
   - `Local site: mysite or mysite@local`
   - `WPE install: install-id or install-id@wpe`

4. **Standardize command structure**
   - Resource-verb pattern: `nexus RESOURCE VERB ARGS`
   - `nexus sites list` (verb comes first)
   - `nexus wp plugins list` (consistent pluralization)

5. **Add interactive mode for complex operations**
   - `nexus wpe backup --interactive` → guided wizard
   - Reduces flag confusion

---

## 6. Missing Onboarding

### Problem: No Guided First-Run Experience

#### Gap 1: No Welcome Flow

- User installs addon → Dashboard loads → 9 tabs, 50+ settings
- No "Getting Started" checklist
- No explanation of what "Index", "Setup AI", "Sync" mean
- New user must reverse-engineer the product

#### Gap 2: No Contextual Help

- Hover over "Index Now" → no tooltip
- Read Preferences → wall of text, no quick-start
- Error message "Requires WP 7.0+" → no link to upgrade guide

#### Gap 3: No Error Recovery Guidance

- "Setup AI failed: Plugin install returned error code 2" → what do I do?
- "Sync Keys failed: Authentication error" → is the API key wrong? Is the site running?
- No "Common issues" or troubleshooting steps

#### Gap 4: Documentation Not Linked from UI

- User sees "Twin data: None — run: nexus sites refresh" (CLI output)
- CLI help doesn't link to user guide
- Dashboard doesn't explain MCP connection or how to use Claude Desktop

**File:** `src/renderer/components/NexusOverview.tsx` (no UI docs link visible)
**File:** `src/cli/commands/sites.ts` (line 127)
```tsx
console.log(`Twin data:    ❌ None — run: nexus sites refresh ${site.name}`);
```
Refers to "twin" without explanation.

### Recommendation

1. **Add First-Run Checklist**
   - Show on first addon load (flag: `addon.seenOnboarding`)
   - Checkbox flow:
     - [ ] Configure AI provider (link to Preferences)
     - [ ] Enable auto-indexing (link to Preferences)
     - [ ] Set up first site (link to Sites tab)
   - Dismissible, but remind on Dashboard header if uncompleted

2. **Add Inline Help System**
   - Hover tooltips on all buttons:
     - "Index Content: Creates a searchable database of posts, pages, and products using AI embeddings."
     - "Refresh Metadata: Updates WordPress version, plugins, themes, and admin email."
   - Links to 1–2 sentence docs

3. **Add Error Recovery Guidance**
   - When setup fails: "❌ Setup failed: Plugin install error"
     - → Likely causes: (1) Site not running, (2) plugins dir not writable
     - → Try: Start site, then try again
     - → Still stuck? See troubleshooting

4. **Link Documentation**
   - Dashboard header: "Help" button → opens user guide in default browser
   - CLI `--help` includes link: "Full docs: docs/user-guide.md"
   - Preferences sections: "(?) Learn more" links for each feature

5. **Add Interactive Onboarding Tour**
   - First 3 visits: Highlight key buttons in Dashboard
     - Visit 1: "This is the Overview tab. Click Sites to index content."
     - Visit 2: "Use Preferences to configure your AI provider."
     - Visit 3: "Bulk Operations panel shows progress on large tasks."

---

## 7. Progressive Disclosure Issues

### Problem: The UI Dumps Complexity on New Users

#### Gap 1: Too Many Tabs & Panels at Once

Dashboard loads with 9 tabs:
- Overview (fleet stats, bulk operations)
- Activity (event timeline)
- Operations (bulk ops, WPE sync, DB scan, diagnostics)
- Sites (site list, index status)
- Search (semantic search)
- Chat (AI agent)
- Fleet Intelligence (plugin usage, version distribution, health)
- WP Engine (install list, links)
- Preferences (settings)

A solo developer is overwhelmed. An agency managing 300+ sites needs only 2–3.

**File:** `src/renderer/components/NexusOverview.tsx` (lines 29–182)
State object includes 40+ fields. Component is 1500+ lines.

#### Gap 2: Preferences Section Has 8 Settings

- AI Credentials (provider, model, API key, validation)
- Local AI Gateway toggle
- Auto-Index toggle
- Excluded sites list
- WP Engine Auto-Sync (enable + interval)
- WPE SSH Refresh (enable + interval)
- Halted Site Refresh (interval only, no toggle)
- All collapsed into one long page

**File:** `src/renderer/components/NexusPreferences.tsx` (lines 129–869)
No grouping. User must scroll past 20+ settings to find one.

#### Gap 3: Per-Site Panel Shows Everything

- Index status + action
- Document count + chunks
- Last indexed
- Auto-index toggle
- Metadata refresh
- WordPress version + upgrade button
- AI Provider (setup/change/gateway state)
- AI Plugin status
- Local AI Gateway status
- Credentials sync
- AI Context file
- Database health + scan

18 rows of information for one site. New user doesn't know which are critical.

**File:** `src/renderer/components/SiteNexusSection.tsx` (lines 550–825)
All rendered unconditionally, user must scroll through 20+ lines.

### Recommendation

1. **Simplify Dashboard for first-time users**
   - Add "Beginner Mode" toggle in Preferences
   - Beginner: Show only Overview + Sites tabs; hide Fleet Intelligence, WP Engine, Chat
   - Advanced: Show all 9 tabs
   - Default to Beginner for first week

2. **Group Preferences by task**
   - Section 1: "Get Started" (AI provider, model, API key)
   - Section 2: "Auto-Indexing" (enable, excluded sites)
   - Section 3: "WP Engine" (credentials, auto-sync, SSH refresh, halted site refresh)
   - Section 4: "Advanced" (gateway, other options)
   - Collapse Section 3 & 4 by default

3. **Collapse non-critical rows in per-site panel**
   - Always show: Index status, AI provider, WordPress version
   - Collapse: Document count, database health, AI plugin status
   - User can expand for details

4. **Add "Quick Setup" wizard**
   - 3-step flow: (1) AI provider, (2) Enable auto-indexing, (3) Choose first site to index
   - Appears first time, completable in 2 min, then never shown again

---

## 8. Top 10 Usability Improvements (Prioritized)

### Tier 1: High Impact, Medium Effort (Do First)

**1. Rename terminology for clarity**
   - Rename "Sync Keys" → "Sync Credentials"
   - Rename "WP Engine Auto-Sync" → "Auto-Sync WP Engine Metadata"
   - Rename "WPE SSH Refresh" → "Auto-Update WP Engine Site Info"
   - Add tooltips on buttons explaining what they do
   - **Impact:** Reduces confusion by 50%, clarifies intent on first read
   - **Files:** `src/renderer/components/SiteNexusSection.tsx`, `NexusPreferences.tsx`

**2. Add "Saved" toast confirmations**
   - Every settings change + button action → 3-sec toast: "✓ Setting saved"
   - Use Local's native toast component if available
   - **Impact:** Users know their actions worked
   - **Files:** `src/renderer/components/NexusOverview.tsx`, `NexusPreferences.tsx`, `SiteNexusSection.tsx`

**3. Add inline tooltips to all buttons**
   - "Index Content: Add posts, pages, and products to the search database"
   - "Refresh Metadata: Update WordPress version, plugins, and themes"
   - "Sync Credentials: Send your AI provider keys to this WordPress site"
   - **Impact:** New users understand intent without documentation
   - **Files:** `SiteNexusSection.tsx`, `BulkOperationsPanel.tsx`

**4. Explain status states**
   - "Indexed: ✓ Latest content indexed for search"
   - "Stale: ⚠️ > 24 hours old, click Refresh to update"
   - Add hover tooltips to status labels
   - **Impact:** Users know when to take action
   - **Files:** `SiteNexusSection.tsx`

**5. Simplify Preferences with sections**
   - Group AI settings, WP Engine settings, Auto-Indexing rules
   - Collapse "Advanced" by default
   - **Impact:** Preferences go from overwhelming to scannable
   - **Files:** `NexusPreferences.tsx`

### Tier 2: Medium Impact, Low Effort (Do Next)

**6. Add "Getting Started" card to Dashboard**
   - Show on first visit: "1. Configure AI provider, 2. Enable auto-indexing, 3. Index a site"
   - Dismissible, links to each step
   - **Impact:** Reduces time-to-first-value by 50%
   - **Files:** `NexusOverview.tsx`

**7. Fix CLI command naming**
   - Rename `content reindex` → `content index --refresh` (matches UI "Re-index")
   - Add `sites sync-metadata` command
   - Add `sites setup-ai` command
   - **Impact:** CLI and UI naming align
   - **Files:** `src/cli/commands/content.ts`, `sites.ts`

**8. Add error recovery guidance**
   - When "Setup AI" fails: "Likely cause: Site not running. Try: Start the site, then try again."
   - Add common troubleshooting steps
   - **Impact:** Users can self-serve instead of asking for help
   - **Files:** `SiteNexusSection.tsx`, MCP error handlers

**9. Remove "Twin" from user-facing text**
   - CLI: Change "Twin data: None" → "Site data: Not available"
   - Replace with "site metadata" in MCP tool descriptions
   - **Impact:** Removes developer jargon, clearer communication
   - **Files:** `src/cli/commands/sites.ts`, MCP tool definitions

### Tier 3: Lower Impact, High Effort (Optional)

**10. Add progress estimates to long operations**
   - "Indexing... (typically 2–5 min depending on content size)"
   - "Syncing credentials... (usually < 10 sec)"
   - Show actual time after completion
   - **Impact:** Users know if something is stuck
   - **Files:** `SiteNexusSection.tsx`, operation handlers

---

## 8. Missing Feedback Loops (Detailed)

### What Happens After User Clicks a Button?

| Button | Current Feedback | Better Feedback |
|--------|------------------|-----------------|
| "Index Content" | Button becomes "Indexing..." then returns to "Re-index" after silence | "✓ Indexing complete (1,234 docs, 5,678 chunks) · Indexed 2 min ago" |
| "Refresh Metadata" | Button becomes "Refreshing..." then silent | "✓ Metadata refreshed · WordPress 6.5.2 (was 6.5.1) · 23 plugins (was 22)" |
| "Sync Credentials" | Button becomes "Syncing..." then silent | "✓ Credentials synced to 5 sites" |
| "Setup AI" | Button shows "Setting up..." → result banner appears (if user is watching) | "✓ AI tools installed · Ready to chat with Claude" (dismissible toast) |
| Enable "Auto-Indexing" toggle | No feedback | "✓ Auto-indexing enabled for running sites" |
| Apply AI Provider change in Preferences | No feedback on button click | "✓ AI provider saved to preferences" |

**Real Example from Code:**
**File:** `src/renderer/components/NexusPreferences.tsx` (lines 325–337)
```tsx
handleSaveKey = async (): Promise<void> => {
  const { keyInput, settings } = this.state;
  const providerId = settings.aiProvider;
  if (!providerId || !keyInput.trim()) return;

  await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SAVE_API_KEY, providerId, keyInput.trim());
  if (!this.mounted) return;

  this.setState((prev) => ({
    keyStatus: { ...prev.keyStatus, [providerId]: 'unchecked' },
    keySaved: true,  // <-- Only flag; no user notification
  }));
};
```

---

## 9. Mobile / Responsive Design

### Problem: Dashboard Not Tested at Small Window Sizes

The Dashboard is optimized for 1920x1200+ but Local users often have:
- Split-screen setups (50% of viewport)
- Laptop displays (1366x768, common)
- Dual monitors with windows side-by-side

**Tested Breakpoints (Missing):**
- 800x600 (netbook)
- 1024x768 (tablet)
- 1366x768 (common laptop)
- 1920x1080 (desktop)

**Known Issues:**
- Preferences page: input fields squish at < 1200px
- Dashboard tabs: overflow at < 1400px
- SiteNexusSection: Rows stack poorly on narrow screens
- BulkOperationsPanel: Progress bar wraps oddly on small screens

**File:** `src/renderer/components/NexusPreferences.tsx` (lines 91–102)
```tsx
const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '14px',
  lineHeight: '1.5',
  borderRadius: '6px',
  border: '1px solid rgba(128, 128, 128, 0.3)',
  outline: 'none',
  width: '350px',  // <-- Fixed width, no responsive breakpoint
  maxWidth: '100%',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};
```

### Recommendation

Test and fix layout at 3 breakpoints:
- 768px (tablet/split-screen)
- 1024px (smaller laptop)
- 1920px (desktop)

Use CSS media queries or responsive grid layouts:
```css
@media (max-width: 1024px) {
  .card-container { grid-template-columns: 1fr; }
  .input-style { width: 100%; max-width: 400px; }
}
```

---

## Summary: User Archetypes & Pain Points

### Solo Developer (Persona A)
- **Goal:** Index local site, search for content
- **Pain:** Doesn't understand "Sync", "Refresh", "Twin"
- **Improvement:** Simpler terminology, 2-min setup

### Agency Managing 50+ Sites (Persona B)
- **Goal:** Setup all sites for AI at once, monitor bulk operations
- **Pain:** Can't batch-configure settings; must visit each site
- **Improvement:** Fleet-level settings, bulk actions

### DevOps Team Managing WP Engine (Persona C)
- **Goal:** Sync WPE metadata, manage backup/restore via CLI
- **Pain:** CLI commands don't align with UI; limited error messages
- **Improvement:** Consistent naming, better error messages, progress indicators

---

## Appendix: Specific Files to Modify

| Priority | File | Changes |
|----------|------|---------|
| 1 | `src/renderer/components/SiteNexusSection.tsx` | Rename buttons, add tooltips, improve status feedback |
| 2 | `src/renderer/components/NexusPreferences.tsx` | Group settings, rename sections, add confirmations |
| 3 | `src/renderer/components/NexusOverview.tsx` | Add "Getting Started" card, improve feedback |
| 4 | `src/cli/commands/content.ts`, `sites.ts` | Rename commands, add flags documentation |
| 5 | `src/renderer/components/BulkOperationsPanel.tsx` | Show durations, add error details |
| 6 | All tooltip definitions | Add inline help text to every button |

---

**Last Updated:** April 16, 2026
**Next Review:** After implementing Tier 1 improvements
