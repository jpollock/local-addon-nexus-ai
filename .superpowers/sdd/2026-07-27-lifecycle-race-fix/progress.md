# SDD ledger — plan: docs/planning/2026-07-27-lifecycle-race-fix.md

## Task 1: Create Readiness Check Module

Initial review: Spec ❌ - Critical interface mismatch
- Interface uses `siteData: LocalSiteDataAccessor` instead of `localServices: LocalServicesBridge` from brief
- This breaks Task 2 integration
- Minor: error messages less specific than plan intended

Starting fix round 1/5...
