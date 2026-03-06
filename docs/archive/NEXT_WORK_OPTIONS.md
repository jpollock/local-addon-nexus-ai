# Next Body of Work - Options

**Created:** 2026-03-05
**Current Phase:** 11 (Polish & Distribution) - 85% complete
**Decision Needed:** What to prioritize next

---

## Current State Summary

### What's Complete ✅

**From pm-work/nexus-ai-implementation-plan.md:**
- ✅ Phases 1-9: Foundation → Ollama Integration
- ✅ Phase 11 (partial): Edge cases, packaging, documentation
- ✅ 708 total tests passing (489 unit + 85 integration + 44 eval + 90 E2E)
- ✅ Per-platform packaging working
- ✅ README and licenses complete

**Bonus - Built Beyond V1 Scope:**
- ✅ Content change webhooks via WordPress events system (was "out of scope")
- ✅ Cross-site search via fleet tools (was "out of scope")
- ✅ Real-time context via event tracking (enables future intelligence)

### What's Remaining in Phase 11

From `pm-work/nexus-ai-implementation-plan.md` Phase 11 acceptance criteria:

**Testing Hardening (Not Done):**
- [ ] WooCommerce extraction tests with product fixtures
- [ ] ACF field extraction tests with repeater/group/flexible content
- [ ] Error recovery tests (MySQL socket disappears, ONNX missing, DB corrupted)
- [ ] Memory leak testing (index 50 sites, check RSS growth)

**Already Done:**
- ✅ Integration tests for full pipeline
- ✅ MCP protocol compliance (via E2E tests)
- ✅ Edge case coverage (Unicode, emoji, CJK, large posts)
- ✅ Per-platform packages build successfully
- ✅ Package sizes within range (~115 MB)
- ✅ Native modules load correctly
- ✅ README complete
- ✅ THIRD_PARTY_LICENSES complete

**Completion Level:** ~85% (4 testing tasks remain)

---

## Option 1: Complete Phase 11 & Ship V1 (Headless MCP-Only)

### What This Means

Finish the remaining Phase 11 testing tasks, then ship as headless MCP-only addon.

### Work Involved

**Week 1: Testing Hardening (4-5 days)**
- WooCommerce test fixtures and extraction validation
- ACF field test fixtures (repeater, group, flexible content)
- Error recovery test suite (simulate failures)
- Memory leak testing with 50-site fixture

**Week 2: Beta & Marketplace Prep (3-4 days)**
- Beta testing with 2-3 real users
- Address critical feedback
- Marketplace submission preparation
- Final QA pass

**Timeline:** 2 weeks
**Effort:** Low-Medium (testing only, no new features)
**Risk:** Low (just hardening existing functionality)

### Pros
- ✅ Follows original pm-work plan exactly
- ✅ Ships proven, tested, production-ready addon
- ✅ Gets real user feedback before building more features
- ✅ Validates market demand for MCP-first approach
- ✅ Shortest path to value delivery

### Cons
- ❌ No visual UI (some users may prefer it)
- ❌ Doesn't address broader vision from STRATEGIC_VISION.md
- ❌ Limited to Tier 1 capabilities (no cloud gateway, no advanced AI)

### What Comes After

Based on beta feedback:
- If users love MCP-only → Continue with post-V1 features
- If users request UI → Build Phase 10
- If users need Tier 2/3/4 → Build AI Gateway

---

## Option 2: Build Phase 10 UI Before Shipping

### What This Means

Build Local UI dashboard showing event stats, context search, storage health BEFORE releasing.

### Work Involved

From `docs/phase1-ui-plan.md`:

**Week 1: Write Failing Tests (RED)**
- Component tests (StatsCard, EventTimeline, ContextSearch, StorageHealth)
- Hook tests (useNexusData)
- IPC handler tests

**Week 2: Implement Components (GREEN)**
- IPC handlers in main process
- Base UI components
- Custom data hook
- Main dashboard component

**Week 3: Integration & Polish**
- Tab registration in Local
- Manual testing in real Local app
- UI polish and refinement

**Timeline:** 3 weeks
**Effort:** Medium (32 new tests + full UI implementation)
**Risk:** Medium (UI needs to work in Local's React/MobX environment)

### Pros
- ✅ Visual insights for non-technical users
- ✅ Better onboarding experience
- ✅ Showcases event system value immediately
- ✅ Professional polish for marketplace launch

### Cons
- ❌ Delays V1 ship by 3 weeks
- ❌ May be wasted effort if users prefer MCP-only
- ❌ Doesn't address broader strategic vision
- ❌ Local uses older React (no hooks) - implementation complexity

### What Comes After

Ship V1 with UI, then:
- Post-V1 features from pm-work "Out of Scope"
- Strategic vision features from STRATEGIC_VISION.md

---

## Option 3: Ship V1 Now, Build UI Post-Launch (Hybrid)

### What This Means

Complete Phase 11 testing (1 week), ship headless, build UI based on feedback.

### Work Involved

**Week 1: Phase 11 Completion**
- WooCommerce + ACF tests
- Error recovery tests
- Memory leak tests
- Marketplace prep

**Week 2: Ship & Beta**
- Release to beta users
- Gather feedback
- Monitor usage patterns

**Weeks 3-5: Conditional UI Build**
- If demand exists → Build Phase 10 UI
- If not needed → Skip to post-V1 features

**Timeline:** 2 weeks to ship, +3 weeks if UI needed
**Effort:** Low initially, scales based on demand
**Risk:** Low (data-driven decision making)

### Pros
- ✅ Fastest time to market (2 weeks)
- ✅ Data-driven decision on UI investment
- ✅ Validates MCP-first hypothesis
- ✅ Can pivot based on real feedback

### Cons
- ❌ May lose users who need UI immediately
- ❌ Two-phase rollout (complexity)
- ❌ UI still not addressing broader vision

---

## Option 4: Pivot to Strategic Vision Features

### What This Means

Skip Phase 10 UI, skip remaining Phase 11 tests, and start building features from STRATEGIC_VISION.md.

### Work Involved

From earlier STRATEGIC_VISION.md (10 domains, 90-day roadmap):

**March (Weeks 1-4): Site Context & Dashboard**
- Site context overview UI (different from Phase 10)
- Manual context editing
- Bulk context refresh (long-running job UI)
- MCP context tools (get_site_context, update_site_context, search_context_across_sites)

**April (Weeks 5-8): Security & Performance Foundations**
- Plugin vulnerability detection (WPScan database)
- WordPress core version checking
- Security posture dashboard
- Performance monitoring (database size, PHP memory, disk space)

**May (Weeks 9-12): Fleet Intelligence**
- Cross-site security metrics
- Performance scoring
- Chat context injection (auto-include site context)

**Timeline:** 12 weeks (full Q1 2026 roadmap)
**Effort:** High (new feature development)
**Risk:** High (scope creep, delayed V1 ship)

### Pros
- ✅ Builds toward comprehensive vision
- ✅ High-value features (security, performance)
- ✅ Differentiated from competitors
- ✅ Fleet intelligence = strategic moat

### Cons
- ❌ Never ships V1 (continuous feature building)
- ❌ No user validation before building more
- ❌ High risk of over-engineering
- ❌ Delays market feedback by 3+ months

---

## Option 5: Focus on WordPress Events Expansion

### What This Means

The events system is foundational. Expand coverage before shipping or building UI.

### Work Involved

**Additional Event Types (from earlier brainstorming):**
- Theme events: theme_switched, theme_updated, theme_deleted
- Comment events: comment_created, comment_updated, comment_deleted, comment_spam
- Taxonomy events: term_created, term_updated, term_deleted
- Settings events: option_updated, permalink_structure_changed
- Media events: attachment_uploaded, attachment_deleted

**Enhanced Event Intelligence:**
- Event pattern detection (unusual plugin activations)
- Anomaly alerting
- Event-based triggers (auto-reindex on content changes)
- Event history queries via MCP

**Timeline:** 2-3 weeks
**Effort:** Medium (known patterns, similar to existing events)
**Risk:** Medium (more WordPress surface area to cover)

### Pros
- ✅ Deeper context for AI intelligence
- ✅ Enables proactive management features
- ✅ Foundation for security/audit features
- ✅ Differentiates from competitors

### Cons
- ❌ Still delays V1 ship
- ❌ May be over-engineering for initial users
- ❌ More events = more storage/processing overhead

---

## Recommended Path Forward

### My Recommendation: **Option 3 (Hybrid)**

**Rationale:**
1. **Get to market fast** - 2 weeks to ship V1 validates the core value prop
2. **Data-driven** - Real user feedback informs UI decision
3. **Low risk** - Can always build UI later if needed
4. **Aligns with vision** - MCP-first is the strategic bet

**Execution Plan:**

**Week 1 (March 6-12): Complete Phase 11**
- Monday-Tuesday: WooCommerce extraction tests
- Wednesday: ACF field extraction tests
- Thursday: Error recovery test suite
- Friday: Memory leak testing

**Week 2 (March 13-19): Ship Prep**
- Monday-Tuesday: Beta testing with 2-3 users
- Wednesday: Address critical feedback
- Thursday-Friday: Marketplace submission prep

**Week 3+ (March 20+): Based on Feedback**
- If UI demand → Build Phase 10 (3 weeks)
- If feature requests → Prioritize from STRATEGIC_VISION.md
- If working well → Post-V1 enhancements from pm-work

### Alternative If You Disagree

**If you want UI now:** Choose Option 2 (3 weeks total)
**If you want strategic features:** Choose Option 4 (12 weeks, no V1 ship)
**If you want more events:** Choose Option 5 (2-3 weeks)

---

## Questions to Decide

1. **Is MCP-only acceptable for V1?** Or is UI mandatory?
2. **What's the primary goal?** Ship fast? Comprehensive vision? Market validation?
3. **Who's the initial user?** Power users (MCP-first) or broader audience (need UI)?
4. **What's the risk tolerance?** Ship lean and iterate? Or build complete before launch?
5. **What's the timeline pressure?** Need something now? Or can invest 3+ months?

---

## Next Steps

**Once you choose an option:**

1. I'll create detailed implementation plan with:
   - Day-by-day task breakdown
   - Test specifications
   - Acceptance criteria
   - Risk mitigation strategies

2. We'll update MASTER_PLAN.md with the chosen path

3. I'll start executing immediately

**What's your decision?**
