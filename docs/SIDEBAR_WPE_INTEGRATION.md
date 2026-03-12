# Sidebar WPE Integration Plan

**Goal:** Mix WPE sites into Local's existing Sites sidebar with enhanced badges for all sites.

## User Decisions (2026-03-11)

1. ✅ **Mix WPE into existing sidebar** (not separate Fleet-only view)
2. ✅ **WPE site clicks** → Open modified Site Info page:
   - Disable buttons that don't work for remote sites
   - Don't populate areas without data
   - Make it clear it's a remote site
   - Offer actions: "Re-sync Metadata" and "Pull to Local"
3. ✅ **Badge priority:** WP version, WPE connection status, PHP version, Index status
4. ✅ **Keep Fleet nav** for now (compare which UX is better)

---

## Technical Approach

### Phase 1: Sidebar DOM Injection

**File:** `src/renderer/SidebarWPEInjector.ts` (NEW)

**Responsibilities:**
1. Fetch WPE sites via IPC
2. Inject WPE site items into Local's Sites sidebar DOM
3. Add badges to ALL sites (local + WPE)
4. Handle clicks on WPE sites → navigate to modified Site Info

**DOM Structure to Inject:**
```html
<div data-site-id="wpe-{installId}" class="nexus-wpe-site-item">
  <a href="#/main/site-info-wpe/{installId}">
    <div class="site-name">
      ☁️ Site Name
      <span class="badge badge-wpe">WPE</span>
      <span class="badge badge-wp">6.9.1</span>
      <span class="badge badge-indexed">✓</span>
    </div>
    <div class="site-domain">domain.wpengine.com</div>
  </a>
</div>
```

**Badge Injection for Local Sites:**
- Use MutationObserver to find existing site items
- Inject badges into each site item's DOM
- Badges: WPE status, WP version, PHP version, index status

---

### Phase 2: Badge Component

**Badge Types:**

1. **WPE Connection Badge**
   - `Local + WPE` - Cyan border, for local sites connected to WPE
   - `☁️ WPE` - Cyan background, for remote-only WPE sites

2. **WP Version Badge**
   - `6.9.1` - Gray background
   - Only show if version is known

3. **PHP Version Badge**
   - `8.2` - Gray background
   - Only show if version is known

4. **Index Status Badge**
   - `✓` - Green, if indexed
   - `○` - Gray, if not indexed

**CSS Styling:**
```css
.nexus-badge {
  display: inline-block;
  padding: 2px 6px;
  margin-left: 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  vertical-align: middle;
}

.badge-wpe-connected {
  background: rgba(14, 202, 212, 0.05);
  color: #0ECAD4;
  border: 1px solid #0ECAD4;
}

.badge-wpe-remote {
  background: rgba(14, 202, 212, 0.1);
  color: #0ECAD4;
}

.badge-wp,
.badge-php {
  background: #f3f4f6;
  color: #6b7280;
}

.badge-indexed-yes {
  color: #10b981;
}

.badge-indexed-no {
  color: #9ca3af;
}
```

---

### Phase 3: WPE Site Info Page

**File:** `src/renderer/components/SiteInfoWPE.tsx` (NEW)

**Purpose:** Modified Site Info view for remote WPE sites

**Layout:**
```
┌─────────────────────────────────────────┐
│ ☁️ Site Name (Remote WPE Site)          │
│ domain.wpengine.com                     │
├─────────────────────────────────────────┤
│ Site Details                            │
│ ├─ WordPress: 6.9.1                     │
│ ├─ Environment: production              │
│ ├─ Install ID: abc123                   │
│ ├─ Last Synced: 2 hours ago             │
│ └─ Linked Local Site: site-name (if any)│
├─────────────────────────────────────────┤
│ Actions                                 │
│ [🔄 Re-sync Metadata]  [⬇️ Pull to Local]│
├─────────────────────────────────────────┤
│ [Disabled sections greyed out]          │
│ Database, SSL, etc. - not available     │
└─────────────────────────────────────────┘
```

**Sections to Show:**
- ✅ Site Details (name, domain, WP version, environment)
- ✅ Indexed Content (if indexed via remote sync)
- ✅ Actions: Re-sync Metadata, Pull to Local
- ❌ Database (disabled/hidden)
- ❌ SSL (disabled/hidden)
- ❌ Logs (disabled/hidden)
- ❌ Tools (disabled/hidden)

**Route:** `/main/site-info-wpe/{installId}`

---

### Phase 4: Route Handling

**Update:** `src/renderer/index.tsx`

Add new route for WPE site info:
```typescript
hooks.addContent('routes[main]', () =>
  React.createElement(Route, {
    path: '/main/site-info-wpe/:installId',
    render: (props: any) => React.createElement(SiteInfoWPE, {
      electron,
      installId: props.match.params.installId,
    }),
  }),
);
```

---

### Phase 5: IPC Handlers

**Existing:**
- `WPE_GET_SYNCED_SITES` - Already returns WPE sites from graph

**New/Enhanced:**
- `WPE_GET_SITE_DETAILS` - Get detailed info for a single WPE site
- `WPE_SYNC_SINGLE_SITE` - Re-sync metadata for one WPE site
- `WPE_PULL_TO_LOCAL` - Trigger automated pull (uses WpeAutoPullService)

---

## Implementation Order

1. **SidebarWPEInjector.ts** - Inject WPE sites into sidebar with badges
2. **Badge styles** - CSS for all badge types
3. **SiteInfoWPE.tsx** - Remote site info page
4. **Route registration** - Wire up /main/site-info-wpe/:installId
5. **IPC handlers** - Add missing handlers for re-sync and pull
6. **Testing** - Verify sidebar mixing, badges, WPE site clicks

---

## Data Flow

### Sidebar Injection
```
Local loads → SidebarWPEInjector.initialize()
  ↓
Fetch WPE sites via IPC (WPE_GET_SYNCED_SITES)
  ↓
Fetch local sites via IPC (GET_SITES)
  ↓
Build WPE site DOM elements
  ↓
Inject into sidebar after local sites
  ↓
Add badges to ALL sites (local + WPE)
  ↓
Observe for changes, re-inject as needed
```

### WPE Site Click
```
User clicks WPE site in sidebar
  ↓
Navigate to /main/site-info-wpe/{installId}
  ↓
SiteInfoWPE component mounts
  ↓
Fetch site details via IPC (WPE_GET_SITE_DETAILS)
  ↓
Render site info with disabled sections
  ↓
User clicks "Pull to Local" → WPE_PULL_TO_LOCAL IPC
  ↓
WpeAutoPullService.pullToLocal() executes
  ↓
Success → Navigate to /main/site-info/{newLocalSiteId}
```

---

## Badge Logic

### For Local Sites:
```typescript
const badges = [];

// WPE Connection Badge (highest priority)
if (site.isWpe && site.wpeInstallId) {
  badges.push({ type: 'wpe-connected', text: 'Local + WPE' });
}

// WP Version Badge
if (site.wpVersion) {
  badges.push({ type: 'wp', text: site.wpVersion });
}

// PHP Version Badge
if (site.phpVersion) {
  badges.push({ type: 'php', text: site.phpVersion });
}

// Index Status Badge
badges.push({
  type: site.indexed ? 'indexed-yes' : 'indexed-no',
  text: site.indexed ? '✓' : '○',
});
```

### For WPE Sites:
```typescript
const badges = [];

// WPE Remote Badge (always first)
badges.push({ type: 'wpe-remote', text: '☁️ WPE' });

// WP Version Badge
if (site.wp_version) {
  badges.push({ type: 'wp', text: site.wp_version });
}

// PHP Badge - not available for WPE sites (omit)

// Index Status Badge (if indexed via remote sync)
badges.push({
  type: site.indexed ? 'indexed-yes' : 'indexed-no',
  text: site.indexed ? '✓' : '○',
});
```

---

## Search Integration

**Already exists:** SidebarSearchPanel filters sites via CSS

**Update needed:** Include WPE sites in search results
- Search should filter both local and WPE sites
- Filter logic already uses `data-site-id` attribute
- Ensure WPE sites have `data-site-id="wpe-{installId}"` attribute

---

## Known Challenges

1. **DOM Injection Stability**
   - Local may re-render Sites sidebar
   - Need robust MutationObserver to re-inject on changes
   - Solution: Same pattern as NavItemInjector and SidebarBadgeManager

2. **WPE Site Info Page Content**
   - Limited data available for remote sites
   - Need to clearly communicate what's not available
   - Solution: Use greyed-out sections with explanatory text

3. **Pull to Local Progress**
   - Pull is async and takes time
   - Need to show progress or redirect to Local app logs
   - Solution: Show modal with "Pull in progress, check Local logs for status"

4. **Badge Space Constraints**
   - Too many badges = cluttered
   - Solution: Use priority order, only show most important
   - Consider tooltip on hover for full details

---

## Success Criteria

- ✅ WPE sites appear in Local's Sites sidebar
- ✅ All sites show relevant badges (WP, PHP, WPE status, Index)
- ✅ Clicking WPE site opens modified Site Info page
- ✅ WPE Site Info clearly shows it's remote
- ✅ "Pull to Local" button works
- ✅ "Re-sync Metadata" updates WPE site data
- ✅ Search icon (magnifying glass) still works
- ✅ Search filters both local and WPE sites
- ✅ No breaking changes to existing Local UX

---

## Next Steps

1. Create `SidebarWPEInjector.ts`
2. Create `SiteInfoWPE.tsx`
3. Add route in `index.tsx`
4. Add IPC handlers
5. Test with real WPE sites
6. Refine badge styling
7. Compare with Fleet view to decide which UX to keep
