# Planning Document Structure

**Created:** 2026-03-05
**Purpose:** Define single source of truth for planning

---

## Documentation Hierarchy

### 1. Strategic Vision (pm-work/)
**Location:** `/Users/jeremy.pollock/development/wpengine/flywheel-local/pm-work/`
**Status:** READ-ONLY (historical record)

**Files:**
- `local-ai-vision.md` - Original strategic vision and positioning
- `nexus-ai-implementation-plan.md` - Phases 1-11 technical implementation

**Purpose:**
- Records the technical foundation we built (Phases 1-11)
- Defines tiered capability model (Tier 1-4)
- Documents architectural decisions

**DO NOT MODIFY** - This is the completed V1 technical foundation

---

### 2. User Value Vision (addon root)
**Location:** `/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/`
**Status:** ACTIVE (what we're building now)

**Files:**
- `AHA_MOMENTS.md` - 6 user experiences we're delivering
- `ROADMAP.md` - Sprint-by-sprint implementation plan (WILL CREATE)
- `VISION.md` - "WordPress and AI development, effortlessly local" (WILL CREATE)

**Purpose:**
- Defines user-facing value, not just technical features
- Guides next 12 weeks of work (Sprints 1-4)
- Maps aha moments to implementation

**ACTIVELY MAINTAINED** - This drives current work

---

### 3. Technical Context (addon root)
**Location:** `/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/`
**Status:** REFERENCE (context for Claude)

**Files:**
- `CLAUDE.md` - Claude Code guidance (references pm-work vision + aha moments)
- `MASTER_PLAN.md` - Comprehensive overview linking everything
- `STATUS.md` - Current state, metrics, quick commands

**Purpose:**
- Help Claude understand full context after compaction
- Link technical foundation (pm-work) to user value (aha moments)
- Show what's done vs what's next

**UPDATED AS NEEDED** - Keep aligned with current work

---

### 4. Implementation Details (docs/)
**Location:** `/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/docs/`
**Status:** REFERENCE (historical + guides)

**Files:**
- `user-guide.md` - User-facing documentation
- `developer-guide.md` - Development setup and patterns
- `testing-strategy.md` - Test philosophy
- `implementation-notes/` - Phase completion notes

**Purpose:**
- Document HOW things were built
- Reference for future work
- User and developer guides

**APPEND-ONLY** - Add new docs, don't delete history

---

## The Update Plan

### What to Archive
Move to `docs/archive/`:
- `STRATEGIC_VISION.md` - Superseded by AHA_MOMENTS.md
- `NEXT_WORK_OPTIONS.md` - Decision made, no longer needed
- `DECISION_MATRIX.md` - Decision made, no longer needed
- `ACTUAL_STATUS.md` - Superseded by updated STATUS.md

### What to Create
New planning docs in addon root:

1. **`VISION.md`** - One-page vision statement
2. **`ROADMAP.md`** - Sprint-by-sprint plan (Sprints 1-4)
3. Updated **`MASTER_PLAN.md`** - Links pm-work + aha moments
4. Updated **`STATUS.md`** - Current state with new direction
5. Updated **`CLAUDE.md`** - Add aha moments context

### What to Keep As-Is
- `README.md` - User-facing (update after Sprint 1 ships)
- `THIRD_PARTY_LICENSES.md` - No changes
- `AHA_MOMENTS.md` - Just created, perfect
- `pm-work/*` - Historical record, don't touch

---

## Single Source of Truth

### For "Why are we building this?"
→ **`VISION.md`** (one-page vision statement)
→ **`AHA_MOMENTS.md`** (6 user experiences)

### For "What's the plan?"
→ **`ROADMAP.md`** (Sprint 1-4 implementation)

### For "What's done and what's next?"
→ **`STATUS.md`** (current state)

### For "What was the technical foundation?"
→ **`pm-work/nexus-ai-implementation-plan.md`** (Phases 1-11)

### For "How does everything connect?"
→ **`MASTER_PLAN.md`** (comprehensive overview)

### For "What does Claude need to know?"
→ **`CLAUDE.md`** (context for AI pair programming)

---

## Proposed Directory Structure

```
/local-addon-nexus-ai/
├── VISION.md                    ← NEW: One-page "why"
├── ROADMAP.md                   ← NEW: Sprint 1-4 plan
├── AHA_MOMENTS.md               ← ✅ Just created
├── MASTER_PLAN.md               ← UPDATE: Link everything
├── STATUS.md                    ← UPDATE: New direction
├── CLAUDE.md                    ← UPDATE: Add aha context
├── README.md                    ← Keep (update after Sprint 1)
├── THIRD_PARTY_LICENSES.md      ← Keep
│
├── docs/
│   ├── user-guide.md
│   ├── developer-guide.md
│   ├── testing-strategy.md
│   ├── implementation-notes/
│   │   └── wordpress-events/
│   └── archive/                 ← NEW: Old planning docs
│       ├── STRATEGIC_VISION.md
│       ├── NEXT_WORK_OPTIONS.md
│       ├── DECISION_MATRIX.md
│       └── ACTUAL_STATUS.md
│
└── scripts/
    └── manual-testing/

/flywheel-local/pm-work/         ← DON'T TOUCH
├── local-ai-vision.md           (historical record)
└── nexus-ai-implementation-plan.md  (Phases 1-11)
```

---

## Next Steps

1. **Create `VISION.md`** - One-page vision statement
2. **Create `ROADMAP.md`** - Sprint 1-4 detailed plan
3. **Update `MASTER_PLAN.md`** - Link technical foundation → user value
4. **Update `STATUS.md`** - Current state + new direction
5. **Update `CLAUDE.md`** - Add aha moments context
6. **Archive old docs** - Move to docs/archive/

**Ready to execute this structure?**
