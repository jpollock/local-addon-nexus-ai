# Sprint 1: Enhanced Visibility

**Status:** Ready to Start
**Timeline:** 2 Weeks (10 working days)
**Start Date:** 2026-03-05
**Goal:** Show users what's happening across their WordPress fleet in real-time

---

## Quick Links

- **[Detailed Design & Plan](./sprint-1-detailed-plan.md)** - Complete architecture, component specs, testing strategy
- **[Task Checklist](./sprint-1-task-checklist.md)** - Day-by-day task breakdown with time estimates
- **[UI Mockup](./sprint-1-ui-mockup.md)** - Visual design, colors, layouts, interactions

---

## What We're Building

A comprehensive visibility dashboard in FleetOverview that surfaces the event tracking system we've built.

### Components

1. **EventStatsCards** - At-a-glance metrics (total events, today's activity, health)
2. **EventTimeline** - Live stream of WordPress events across all sites
3. **StorageHealthPanel** - Database sizes, capacity usage, cleanup controls
4. **TopIssuesPanel** - Proactive alerts ("3 sites need security updates")

### Backend

- 4 new GraphService methods (query events, stats, storage health, detect issues)
- 6 new IPC handlers (timeline, stats, health, issues, cleanup, retry)
- Event enrichment logic (generate summaries, add site names)

---

## Why This Matters

**Current State:**
- ✅ Event system built (EventProcessor, GraphService, 10 event types)
- ✅ 43 events processed in testing
- ❌ **Users can't see ANY of it** — critical gap!

**After Sprint 1:**
- ✅ Users see "43 events processed, 3 sites need updates" immediately
- ✅ Event timeline shows plugin activations, content changes, user updates
- ✅ Health indicators surface problems proactively
- ✅ Storage visualization prevents "why is my disk full?" questions

---

## Deliverables

**Code:**
- 4 new React components (EventStatsCards, EventTimeline, StorageHealthPanel, TopIssuesPanel)
- 4 new GraphService methods
- 6 new IPC handlers
- Enhanced FleetOverview with "Visibility" tab

**Tests:**
- 10+ unit tests (components + GraphService)
- 3 integration tests (IPC flows)
- 2 E2E tests (full visibility dashboard)

**Documentation:**
- Updated README with Visibility tab
- Screenshots
- IPC handler documentation

---

## Success Metrics

### Must Have (Sprint Complete)
- [ ] All 4 components render in <1s
- [ ] Event timeline updates in real-time
- [ ] Stats cards show accurate counts
- [ ] Storage health reflects actual DB sizes
- [ ] Issues detected automatically
- [ ] All tests passing (10+ unit, 3 integration, 2 E2E)
- [ ] Zero console errors

### Nice to Have (Post-Sprint)
- Export timeline as CSV
- Event detail modal
- Custom date range selector
- Event search within timeline

---

## Timeline

### Week 1: Backend & Foundation (Days 1-4)
- **Day 1:** GraphService query methods (9.5h)
- **Day 2:** Types & helpers (6.5h)
- **Day 3:** IPC handlers (7h)
- **Day 4:** Testing & validation (7.5h)

### Week 2: UI Components (Days 5-10)
- **Day 5:** EventStatsCards (8h)
- **Day 6:** EventTimeline (9h)
- **Day 7:** StorageHealthPanel (9.5h)
- **Day 8:** TopIssuesPanel (9h)
- **Day 9:** FleetOverview integration (8h)
- **Day 10:** E2E tests & polish (10.5h)

**Total:** 84.5 hours (~10.5 days)

---

## How to Use This Documentation

1. **Read the Detailed Plan first** - Understand the full architecture
2. **Follow the Task Checklist** - Day-by-day implementation guide
3. **Reference the UI Mockup** - Visual design and interaction patterns
4. **Track progress** - Update checkboxes in the task checklist as you go

---

## Getting Started

### Prerequisites
- Sprint 0 complete (events system built)
- Local running with nexus-ai addon
- WordPress test site (nexus-e2e-test.local)
- nexus-ai-connector plugin installed

### Day 1 Kickoff
1. Read all documentation
2. Set up development environment
3. Start with T1.1: Add getRecentEvents() to GraphService
4. Follow task checklist sequentially

### Development Loop
1. Write tests first (TDD)
2. Implement feature
3. Run tests (`npm test`)
4. Manual testing
5. Commit
6. Next task

---

## Questions?

Refer to:
- `requirements/COMPREHENSIVE_ROADMAP.md` - Overall vision and roadmap
- `CLAUDE.md` - Development patterns and principles
- `docs/testing-strategy.md` - Testing philosophy

---

**Next Sprint:** Sprint 2 - Easy Fleet Discovery 🔍

