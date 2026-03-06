# Sprint 1: UI Mockup & Visual Design

**Component:** FleetOverview - Visibility Tab
**Created:** 2026-03-05

---

## Tab Navigation

```
┌────────────────────────────────────────────────────────────────────┐
│ Nexus AI Fleet Overview                                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [ Overview ]  [ Search ]  [ Sites ]  [ Visibility ]  [ Chat ]    │
│                                         ^^^^^^^^^^^^               │
│                                         Active Tab                  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Full Visibility Tab Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Nexus AI Fleet Overview                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [ Overview ]  [ Search ]  [ Sites ]  [ Visibility ]  [ Chat ]             │
│                                         ^^^^^^^^^^^^                         │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  EVENT STATISTICS (3 cards, grid layout)                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ Total Events     │  │ Today            │  │ Health Status    │         │
│  │                  │  │                  │  │                  │         │
│  │       43         │  │       12         │  │   ✓ Good         │         │
│  │                  │  │   +3 vs yest.    │  │                  │         │
│  │                  │  │                  │  │   0 pending      │         │
│  │                  │  │                  │  │   0 failed       │         │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MAIN CONTENT (2-column grid: 2fr + 1fr)                                    │
│                                                                              │
│  ┌────────────────────────────────────────┐  ┌────────────────────────┐   │
│  │ EVENT TIMELINE                         │  │ TOP ISSUES             │   │
│  │                                        │  │                        │   │
│  │ Last 50 Events  [Filter ▼] [Refresh] │  │ 3 issues detected      │   │
│  │                                        │  │                        │   │
│  │ ● Plugin Activated      2 mins ago    │  │ ⚠️ 2 Failed Events     │   │
│  │   akismet on nexus-e2e-test.local     │  │   [View →]             │   │
│  │   Status: ✓ Processed                 │  │                        │   │
│  │                                        │  │ 🔒 3 Security Updates  │   │
│  │ ● Post Updated          5 mins ago    │  │   [View →]             │   │
│  │   "Hello World" on nexus-e2e-test     │  │                        │   │
│  │   Status: ✓ Processed                 │  │ 💾 Storage at 75%      │   │
│  │                                        │  │   [Cleanup →]          │   │
│  │ ● User Created         12 mins ago    │  │                        │   │
│  │   editor@example.com on my-site       │  └────────────────────────┘   │
│  │   Status: ⏱ Pending                   │                               │
│  │                                        │  ┌────────────────────────┐   │
│  │ ● Plugin Deactivated   18 mins ago    │  │ STORAGE HEALTH         │   │
│  │   hello-dolly on demo.local           │  │                        │   │
│  │   Status: ✓ Processed                 │  │ Graph Database:        │   │
│  │                                        │  │ 2.3 MB  [████░░░] 12% │   │
│  │ [Load More...]                        │  │                        │   │
│  │                                        │  │ Vector Database:       │   │
│  └────────────────────────────────────────┘  │ 45.8 MB [████████░] 75%│   │
│                                               │                        │   │
│                                               │ Event Queue:           │   │
│                                               │ 43 events (0 pending)  │   │
│                                               │                        │   │
│                                               │ Oldest: 2026-03-04     │   │
│                                               │ Latest: 2026-03-05     │   │
│                                               │                        │   │
│                                               │ [Cleanup] [Optimize]   │   │
│                                               └────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component 1: Event Stats Cards (Detail)

### Card 1: Total Events
```
┌─────────────────────┐
│ Total Events        │
│                     │
│                     │
│        43           │  ← Large number, bold
│                     │
│                     │
└─────────────────────┘

Styling:
- Background: #FFFFFF (white)
- Border: 1px solid #E0E0E0
- Border-radius: 10px
- Padding: 24px
- Font size: 48px (number), 14px (label)
- Color: #333333 (number), #666666 (label)
```

### Card 2: Today's Events
```
┌─────────────────────┐
│ Today               │
│                     │
│                     │
│        12           │  ← Large number, bold
│                     │
│    +3 vs yest.      │  ← Green if positive, red if negative
│                     │
└─────────────────────┘

Styling:
- Same as Card 1
- Comparison: #22C55E (green) if positive, #EF4444 (red) if negative
- Comparison font: 12px, lighter weight
```

### Card 3: Health Status
```
┌─────────────────────┐
│ Health Status       │
│                     │
│   ✓ Good            │  ← Icon + status text
│                     │
│   0 pending         │  ← Smaller text
│   0 failed          │
│                     │
└─────────────────────┘

Health States:
- Good (green): ✓ icon, #22C55E
- Warning (yellow): ⚠️ icon, #F59E0B
- Error (red): ✗ icon, #EF4444

Conditions:
- Good: 0 pending, 0 failed
- Warning: >0 pending, 0 failed
- Error: >0 failed
```

---

## Component 2: Event Timeline (Detail)

```
┌──────────────────────────────────────────────────────────┐
│ Event Timeline (Last 50)       [Filter ▼]  [⟳ Refresh]  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ ● Plugin Activated                         2 mins ago    │
│   akismet/akismet.php on nexus-e2e-test.local           │
│   Status: ✓ Processed                                    │
│   [▼ View Details]                                       │
│                                                           │
├─────────────────────────────────────────────────── ─────┤
│                                                           │
│ ● Post Updated                             5 mins ago    │
│   "Hello World" (#1) on nexus-e2e-test.local            │
│   Status: ✓ Processed                                    │
│                                                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ ● User Created                            12 mins ago    │
│   editor@example.com on my-site.local                    │
│   Status: ⏱ Pending                                      │
│                                                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ ● Plugin Deactivated                      18 mins ago    │
│   hello-dolly on demo.local                              │
│   Status: ✗ Failed - Retry available                     │
│                                                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│                    [Load More...]                         │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### Event Entry Structure
```
┌──────────────────────────────────────────────────────────┐
│ ●  EVENT_TYPE_NAME                      RELATIVE_TIME    │  ← Header
│    event_summary_text on site_name                       │  ← Summary
│    Status: STATUS_INDICATOR                              │  ← Status
│    [▼ View Details]                                      │  ← Expander (optional)
└──────────────────────────────────────────────────────────┘
```

### Event Type Icons
- `●` for all events (colored by type)
- Plugin events: 🔌 (blue #3B82F6)
- Content events: 📄 (purple #8B5CF6)
- User events: 👤 (orange #F59E0B)
- Site events: 🌐 (green #22C55E)

### Status Indicators
```
✓ Processed  (green #22C55E)
⏱ Pending    (yellow #F59E0B)
✗ Failed     (red #EF4444)
```

### Expanded Event Details
```
┌──────────────────────────────────────────────────────────┐
│ ● Plugin Activated                         2 mins ago    │
│   akismet/akismet.php on nexus-e2e-test.local           │
│   Status: ✓ Processed                                    │
│   [▲ Hide Details]                                       │
│                                                           │
│   ┌────────────────────────────────────────────────┐    │
│   │ Event ID: 42                                    │    │
│   │ Site ID: e2e-test-site                          │    │
│   │ Created: 2026-03-05 16:42:08                    │    │
│   │ Processed: 2026-03-05 16:42:08 (45ms)           │    │
│   │                                                  │    │
│   │ Payload:                                         │    │
│   │ {                                                │    │
│   │   "plugin_slug": "akismet",                      │    │
│   │   "plugin_file": "akismet/akismet.php",          │    │
│   │   "network_wide": false                          │    │
│   │ }                                                │    │
│   └────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Filter Dropdown
```
[Filter: All ▼]

Dropdown options:
┌─────────────────┐
│ All             │ ✓ (checkmark if selected)
│ Content         │
│ Plugins         │
│ Users           │
│ Site            │
└─────────────────┘
```

---

## Component 3: Top Issues Panel (Detail)

```
┌────────────────────────────────────────────┐
│ Top Issues (3)                             │
├────────────────────────────────────────────┤
│                                             │
│ ⚠️ 2 Failed Events              [View →]   │
│    Events failed to process, may need      │
│    retry                                    │
│                                             │
├────────────────────────────────────────────┤
│                                             │
│ 🔒 3 Sites with Security Updates [View →]  │
│    nexus-e2e-test.local, my-site.local,    │
│    demo.local                               │
│                                             │
├────────────────────────────────────────────┤
│                                             │
│ 💾 Storage at 75% Capacity     [Cleanup →] │
│    Vector database is growing large        │
│                                             │
└────────────────────────────────────────────┘
```

### Issue Entry Structure
```
┌────────────────────────────────────────────┐
│ ICON TITLE                      [ACTION →] │
│    description text                        │
│                                             │
└────────────────────────────────────────────┘
```

### Issue Severity Colors
```
Error:   Red background (#FEE2E2), red icon (#EF4444)
Warning: Yellow background (#FEF3C7), orange icon (#F59E0B)
```

### Empty State
```
┌────────────────────────────────────────────┐
│ Top Issues (0)                             │
├────────────────────────────────────────────┤
│                                             │
│              ✓                              │
│                                             │
│      All systems healthy                    │
│                                             │
│   No issues detected across your fleet     │
│                                             │
└────────────────────────────────────────────┘
```

---

## Component 4: Storage Health Panel (Detail)

```
┌─────────────────────────────────────────────────────────┐
│ Storage Health                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Graph Database:                                         │
│ 2.3 MB                        [████░░░░░░] 12% used    │
│                                                          │
│ Vector Database:                                        │
│ 45.8 MB                       [████████░░] 75% used    │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Event Queue:         43 events (0 pending, 0 failed)    │
│ Oldest Event:        2026-03-04 14:23:12                │
│ Latest Event:        2026-03-05 16:42:08                │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [Cleanup Old Events (30+ days)]  [Optimize Databases]  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Progress Bar Design
```
Graph Database:
2.3 MB                        [████░░░░░░] 12% used
^      ^                      ^          ^ ^
│      │                      │          │ └─ Percentage
│      │                      │          └─── Progress bar
│      │                      └────────────── Filled portion
│      └───────────────────────────────────── Size label
└──────────────────────────────────────────── Database name
```

### Progress Bar Colors
- < 50%: Green (#22C55E)
- 50-75%: Yellow (#F59E0B)
- > 75%: Red (#EF4444)

### Action Buttons
```
┌──────────────────────────────────┐    ┌──────────────────────┐
│ Cleanup Old Events (30+ days)    │    │ Optimize Databases   │
└──────────────────────────────────┘    └──────────────────────┘

On click:
1. Show loading spinner in button
2. IPC call
3. Show success message
4. Refresh storage health
```

---

## Colors & Typography

### Color Palette

**Status Colors:**
- Success/Good: #22C55E (green-500)
- Warning: #F59E0B (amber-500)
- Error: #EF4444 (red-500)
- Info: #3B82F6 (blue-500)

**Event Type Colors:**
- Plugins: #3B82F6 (blue)
- Content: #8B5CF6 (purple)
- Users: #F59E0B (orange)
- Site: #22C55E (green)

**UI Colors:**
- Background: #FFFFFF (white)
- Border: #E0E0E0 (gray-200)
- Text primary: #333333
- Text secondary: #666666
- Text muted: #999999

### Typography

**Event Stats Cards:**
- Label: 14px, weight 500, #666666
- Number: 48px, weight 700, #333333
- Comparison: 12px, weight 400, #22C55E or #EF4444

**Event Timeline:**
- Event type: 14px, weight 600, #333333
- Summary: 13px, weight 400, #666666
- Timestamp: 12px, weight 400, #999999
- Status: 12px, weight 500, color varies

**Top Issues:**
- Title: 14px, weight 600, color varies
- Description: 12px, weight 400, #666666

**Storage Health:**
- Label: 14px, weight 500, #333333
- Size: 14px, weight 600, #333333
- Percentage: 12px, weight 400, #666666

---

## Responsive Behavior

### Desktop (>1200px)
- 3-column stats cards
- 2-column main layout (2fr + 1fr)
- All features visible

### Tablet (768px - 1200px)
- 3-column stats cards (might stack to 2-1)
- 1-column main layout (timeline full width, issues/storage below)

### Mobile (<768px)
- 1-column stats cards (stacked)
- 1-column main layout
- Shorter event list (25 instead of 50)

---

## Loading States

### Initial Load
```
┌─────────────────────────────────────────────────────────┐
│ Nexus AI Fleet Overview                                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [ Overview ]  [ Search ]  [ Sites ]  [ Visibility ]   │
│                                         ^^^^^^^^^^^^     │
│                                                          │
│                                                          │
│                    ⏳ Loading visibility data...         │
│                                                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Component-Level Loading
```
┌──────────────────────────────────────────┐
│ Event Timeline                           │
├──────────────────────────────────────────┤
│                                           │
│            ⏳ Loading events...           │
│                                           │
└──────────────────────────────────────────┘
```

---

## Error States

### Component Error
```
┌──────────────────────────────────────────┐
│ Event Timeline                           │
├──────────────────────────────────────────┤
│                                           │
│  ✗ Failed to load events                 │
│                                           │
│  Error: Connection timeout               │
│                                           │
│           [Retry]                         │
│                                           │
└──────────────────────────────────────────┘
```

### Empty State (No Events)
```
┌──────────────────────────────────────────┐
│ Event Timeline (Last 50)                 │
├──────────────────────────────────────────┤
│                                           │
│              📭                           │
│                                           │
│        No events yet                      │
│                                           │
│  Events will appear here as WordPress    │
│  activities are tracked across your      │
│  fleet.                                   │
│                                           │
└──────────────────────────────────────────┘
```

---

## Interaction Design

### Auto-Refresh Behavior

**EventStatsCards:**
- Poll every 30 seconds
- Fade in new data (no jarring flash)
- Pause when user hovers (prevents jumpy UX)

**EventTimeline:**
- Poll every 10 seconds
- New events appear at top with slide-in animation
- Preserve scroll position if user scrolled down
- Badge: "3 new events" if user scrolled away from top

**StorageHealthPanel:**
- Poll every 60 seconds
- Smooth progress bar animation

**TopIssuesPanel:**
- Poll every 60 seconds
- Highlight new issues with pulse animation

### Click Behaviors

**Event Entry:**
- Click anywhere → expand details
- Click "View Details" → same as above
- Click site name → navigate to site in Sites tab

**Stats Card:**
- Click → expand to show by-type breakdown (modal or inline)

**Issue:**
- Click action button → execute action
- Click title → expand details

**Storage:**
- Click "Cleanup" → confirm dialog → execute → success message
- Click "Optimize" → confirm dialog → execute → success message

---

## Accessibility

### Keyboard Navigation
- Tab through all interactive elements
- Enter/Space to activate buttons
- Arrow keys to navigate event list
- Escape to close expanded views

### ARIA Labels
- `aria-label="Event timeline"` on timeline container
- `aria-live="polite"` on auto-updating regions
- `aria-expanded` on expandable event entries
- Semantic HTML (nav, section, article)

### Screen Reader Support
- Announce new events when timeline updates
- Announce status changes (pending → processed)
- Descriptive button labels ("Cleanup events older than 30 days")

---

## Animation & Polish

### Subtle Animations
- Fade in: 200ms ease-in
- Slide in (new events): 300ms ease-out
- Progress bar fill: 500ms ease-in-out
- Pulse (new issue): 1s infinite

### Hover States
- Cards: subtle shadow increase
- Buttons: background darken 10%
- Event entries: background lighten 5%

### Focus States
- 2px blue (#3B82F6) outline
- Offset 2px for visibility

---

**Last Updated:** 2026-03-05
**Designer:** Claude (AI)
**Implementation:** Sprint 1 (Weeks 1-2)

