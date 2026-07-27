# Task 1: Create Readiness Check Module

**Context:** This is part of fixing a race condition where Nexus AI tries to index Local sites before MySQL is fully provisioned, causing "Access denied" errors. We need a centralized readiness check that validates a site is truly ready before any automatic work begins.

**Files:**
- Create: `src/main/content/site-readiness.ts`
- Test: `tests/unit/content/site-readiness.test.ts`

**Interfaces:**
- Consumes: `LocalServicesBridge` (from `src/main/mcp/local-services-bridge.ts`), `MySQLExtractor` (from `src/main/content/MySQLExtractor.ts`)
- Produces: `isSiteReady(siteId: string, localServices: LocalServicesBridge, mysqlExtractor?: MySQLExtractor): Promise<{ ready: boolean; reason?: string }>`

**Global Constraints from Plan:**
- Base branch: `v0.5.1` tag (hotfix release)
- MySQL timeout: 6 seconds (3 retries × 2s via `connectWithRetry`)
- GraphQL timeout: 5 seconds
- Fail-closed: unknown states treated as "not ready"

## Requirements

Implement `isSiteReady()` function that validates in fail-fast order:

1. **Site exists check** - Query Local's GraphQL for site record
   - **Fail:** Site not found → `{ ready: false, reason: 'Site not found in Local state' }`

2. **Status check** - Verify `site.status === 'running'`
   - **Accept:** `'running'` only
   - **Reject:** `'provisioning'`, `'starting'`, `'stopping'`, `'halted'`, or any unknown state
   - **Fail:** Status not running → `{ ready: false, reason: 'Site status: ${status}' }`

3. **Filesystem check** - Verify `site.path` exists via `fs.existsSync`
   - **Fail:** Path missing → `{ ready: false, reason: 'Site path does not exist' }`

4. **MySQL connection test** (if `mysqlExtractor` provided)
   - Check socket exists: `MySQLExtractor.isAvailable(siteId)`
   - Attempt actual connection: `SELECT 1` query with 5s timeout
   - Uses existing `connectWithRetry()` from MySQLExtractor (3 retries × 2s)
   - **Fail:** Connection rejected → `{ ready: false, reason: 'MySQL not accepting connections' }`

5. **All pass** → `{ ready: true }`

## Testing Requirements

7 unit tests covering all validation paths:
1. Site not found in GraphQL → `ready: false`
2. Site status = 'provisioning' → `ready: false`
3. Site status = 'halted' → `ready: false`
4. Site path missing → `ready: false`
5. MySQL socket missing → `ready: false`
6. MySQL connection fails → `ready: false`
7. All checks pass → `ready: true`

## Implementation Steps

Follow TDD approach from the plan:
1. Write failing test for site not found
2. Run test (verify fails)
3. Create site-readiness.ts with site existence check
4. Run test (verify passes)
5. Write failing tests for status check
6. Run test (verify fails)
7. Implement status check
8. Run test (verify passes)
9. Write failing test for filesystem check
10. Run test (verify fails)
11. Implement filesystem check
12. Run test (verify passes)
13. Write failing tests for MySQL connection
14. Run test (verify fails)
15. Add `testConnection()` method to MySQLExtractor
16. Implement MySQL check in isSiteReady
17. Run tests (verify all 7 pass)
18. Commit

## Commit Message

```
feat: add centralized site readiness check

- New isSiteReady() function validates site exists, status=running, path exists, MySQL connects
- MySQLExtractor.testConnection() added for connection probing
- 7 unit tests covering all readiness paths
- Fail-closed: unknown states treated as not ready
```
