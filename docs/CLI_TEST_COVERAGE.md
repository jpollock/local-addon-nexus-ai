# CLI Test Coverage Analysis

**Last Updated:** 2026-03-20
**Status:** INCOMPLETE — Only 10 basic commands tested

## Current Test Files

### Unit Tests (1 file, 15 tests)
```
tests/unit/cli/
└── bootstrap.test.ts (✅ 15/15 passing)
    ├── Platform detection (macOS, Windows, Linux)
    ├── Local installation check
    ├── Connection info reading
    ├── Addon installation/activation
    └── GraphQL readiness polling
```

### Functional Tests (1 file, ~10 tests)
```
tests/functional/
└── cli-commands.functional.test.ts (partial)
    └── Target parsing (local, WPE formats)
```

### E2E Tests (1 file, 60+ tests)
```
tests/e2e/
└── 26-cli-commands.e2e.test.ts (✅ comprehensive)
    ├── Sites commands (list, start, stop, restart, delete)
    ├── WP commands (plugin list, core version, theme list, option get)
    ├── Sync commands (pull, push with flags)
    ├── Help and version
    ├── Error handling
    ├── Output formatting
    └── Target parsing
```

## Test Coverage by Command

| Command | Unit | Functional | E2E | Integration | Total |
|---------|------|------------|-----|-------------|-------|
| **Sites** |
| `sites list` | ❌ | ❌ | ✅ | ❌ | 25% |
| `sites get` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites create` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `sites clone` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites rename` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites start` | ❌ | ❌ | ✅ | ❌ | 25% |
| `sites stop` | ❌ | ❌ | ✅ | ❌ | 25% |
| `sites restart` | ❌ | ❌ | ✅ | ❌ | 25% |
| `sites delete` | ❌ | ❌ | ✅ | ❌ | 25% |
| `sites export` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites import` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites logs` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites config php` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites config ssl` | ❌ | ❌ | ❌ | ❌ | 0% |
| `sites config xdebug` | ❌ | ❌ | ❌ | ❌ | 0% |
| **Blueprints** |
| `blueprints list` | ❌ | ❌ | ❌ | ❌ | 0% |
| `blueprints save` | ❌ | ❌ | ❌ | ❌ | 0% |
| **WPE** |
| `wpe accounts` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wpe installs` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wpe install` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wpe backup` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wpe cache` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wpe link` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wpe changes` | ❌ | ❌ | ❌ | ❌ | 0% |
| **Sync** |
| `sync pull` | ❌ | ❌ | ✅ | ❌ | 25% |
| `sync push` | ❌ | ❌ | ✅ | ❌ | 25% |
| `sync history` | ❌ | ❌ | ❌ | ❌ | 0% |
| **WP** |
| `wp <generic>` | ❌ | ❌ | ✅ | ❌ | 25% |
| `wp plugin list` | ❌ | ❌ | ✅ | ❌ | 25% |
| `wp plugin install` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp plugin activate` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp plugin deactivate` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp plugin update` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp theme list` | ❌ | ❌ | ✅ | ❌ | 25% |
| `wp theme activate` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wp core version` | ❌ | ❌ | ✅ | ❌ | 25% |
| `wp core update` | ❌ | ❌ | ❌ | ❌ | 0% |
| `wp db export` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp db import` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp db search-replace` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp post create` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp post update` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp post delete` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp user list` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `wp option get` | ❌ | ❌ | ✅ | ❌ | 25% |
| `wp health` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| **Fleet** |
| `fleet summary` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet health` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet search` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet filter` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet outdated` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet compare` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet drift` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet groups *` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet bulk plugin update` | ❌ | ❌ | ❌ | ❌ | 0% |
| `fleet bulk reindex` | ❌ | ❌ | ❌ | ❌ | 0% |
| **Search** |
| `search content` | ❌ | ❌ | ❌ | ❌ | 0% |
| `search across` | ❌ | ❌ | ❌ | ❌ | 0% |
| **Index** |
| `index status` | ❌ | ❌ | ❌ | ❌ | 0% |
| `index list` | ❌ | ❌ | ❌ | ❌ | 0% |
| `index reindex` | ❌ | ❌ | ❌ | ❌ | 0% |
| **AI** |
| `ai ask` | ❌ | ❌ | ❌ | ❌ | 0% |
| `ai models` | ❌ | ❌ | ❌ | ❌ | 0% |
| `ai setup` | ❌ | ❌ | ❌ | ❌ | 0% |
| `ai abilities` | ❌ | ❌ | ❌ | ❌ | 0% |
| `ai run` | ❌ | ❌ | ❌ | ❌ | 0% |
| `ai credentials sync` | ❌ | ❌ | ❌ | ❌ | 0% |
| `ai credentials auto-sync` | ❌ | ❌ | ❌ | ❌ | 0% |
| **Audit** |
| `audit site` | ❌ | ❌ | ❌ | ❌ | 0% |
| `audit plugin` | ❌ | ❌ | ❌ | ❌ | 0% |
| **Global** |
| `update` | ❌ | ❌ | ⚠️ | ❌ | 5% |
| `--help` | ❌ | ❌ | ✅ | ❌ | 25% |
| `--version` | ❌ | ❌ | ✅ | ❌ | 25% |

**Legend:**
- ✅ Full coverage (all test types)
- ⚠️ Partial coverage (mentioned in tests but not fully tested)
- ❌ No coverage

## Overall Coverage Statistics

### Implemented Commands
- **Existing:** 10 commands (sites, wp, sync, update)
- **Tested (E2E):** 10 commands (100% of existing)
- **Tested (Unit):** 0 commands (0% of existing)
- **Tested (Integration):** 0 commands (0% of existing)

### Planned Commands (from CLI_MCP_FEATURE_PARITY.md)
- **Total to implement:** 60+ commands
- **Tested:** 0% (not implemented yet)

### Bootstrap System
- **Unit tests:** ✅ 15/15 passing (100%)
- **Coverage:** Platform detection, addon management, GraphQL polling

## Test Requirements for 100% Coverage

### 1. Unit Tests (56 new test files needed)

```
tests/unit/cli/
├── bootstrap.test.ts (✅ existing)
├── commands/
│   ├── sites.test.ts
│   │   ├── list (local-only, wpe-only, json)
│   │   ├── get
│   │   ├── create (blueprint, php, wp options)
│   │   ├── clone
│   │   ├── rename
│   │   ├── start/stop/restart
│   │   ├── delete (force confirmation)
│   │   ├── export/import
│   │   ├── logs (tail, follow)
│   │   └── config (php, ssl, xdebug)
│   ├── blueprints.test.ts
│   │   ├── list
│   │   └── save
│   ├── wpe.test.ts
│   │   ├── accounts
│   │   ├── installs
│   │   ├── install
│   │   ├── backup
│   │   ├── cache
│   │   ├── link
│   │   └── changes
│   ├── sync.test.ts
│   │   ├── pull (db-only, files-only)
│   │   ├── push (db, db-only, files-only, create)
│   │   └── history
│   ├── wp.test.ts
│   │   ├── generic passthrough
│   │   ├── plugin (list, install, activate, deactivate, update)
│   │   ├── theme (list, activate)
│   │   ├── core (version, update)
│   │   ├── db (export, import, search-replace)
│   │   ├── post (create, update, delete)
│   │   ├── user (list)
│   │   ├── option (get)
│   │   └── health
│   ├── fleet.test.ts
│   │   ├── summary
│   │   ├── health
│   │   ├── search
│   │   ├── filter
│   │   ├── outdated
│   │   ├── compare
│   │   ├── drift
│   │   ├── groups (list, create, add, remove, delete)
│   │   └── bulk (plugin update, reindex)
│   ├── search.test.ts
│   │   ├── content
│   │   └── across
│   ├── index.test.ts
│   │   ├── status
│   │   ├── list
│   │   └── reindex
│   ├── ai.test.ts
│   │   ├── ask
│   │   ├── models
│   │   ├── setup
│   │   ├── abilities
│   │   ├── run
│   │   └── credentials (sync, auto-sync)
│   └── audit.test.ts
│       ├── site
│       └── plugin
├── utils/
│   ├── target.test.ts (✅ partial in functional)
│   ├── graphql.test.ts
│   ├── version.test.ts
│   └── context.test.ts
```

### 2. Integration Tests (NEW)

```
tests/integration/cli/
├── graphql-integration.test.ts
│   ├── Test CLI → GraphQL → Resolvers flow
│   ├── Test error propagation
│   └── Test timeout handling
├── target-resolution.test.ts
│   ├── Test local site resolution
│   ├── Test WPE install resolution
│   └── Test error cases
└── bootstrap-integration.test.ts
    ├── Test full bootstrap flow
    ├── Test addon activation
    └── Test Local startup
```

### 3. E2E Tests (Expand existing)

```
tests/e2e/
├── 26-cli-commands.e2e.test.ts (✅ existing, expand)
├── 27-cli-fleet.e2e.test.ts (NEW)
│   ├── Fleet summary
│   ├── Fleet filtering
│   ├── Site groups
│   └── Bulk operations
├── 28-cli-ai.e2e.test.ts (NEW)
│   ├── AI setup
│   ├── Credential sync
│   ├── Ability execution
│   └── Ollama integration
├── 29-cli-wpe.e2e.test.ts (NEW)
│   ├── Account listing
│   ├── Install management
│   ├── Backup creation
│   └── Cache purging
└── 30-cli-workflows.e2e.test.ts (NEW)
    ├── Full site lifecycle (create → configure → sync → delete)
    ├── Plugin audit workflow
    ├── Fleet health workflow
    └── AI setup workflow
```

### 4. Functional Tests (Expand existing)

```
tests/functional/
├── cli-commands.functional.test.ts (expand)
│   ├── Target parsing (✅ existing)
│   ├── GraphQL query generation
│   ├── Output formatting
│   └── Error handling
├── cli-validation.functional.test.ts (NEW)
│   ├── Required parameter validation
│   ├── Flag validation
│   └── Target syntax validation
└── cli-output.functional.test.ts (NEW)
    ├── JSON output format
    ├── Table formatting
    ├── Progress indicators
    └── Error messages
```

## Test Coverage Gaps

### Critical Gaps (must fix)
1. ❌ **No unit tests for command implementations** - Only bootstrap tested
2. ❌ **No integration tests for CLI** - No GraphQL flow testing
3. ❌ **Limited functional tests** - Only target parsing
4. ❌ **No tests for new commands** - 50+ commands not implemented OR tested

### Medium Priority
1. ⚠️ **E2E tests incomplete** - Only basic commands covered
2. ⚠️ **No workflow tests** - Multi-command scenarios untested
3. ⚠️ **No error scenario tests** - Edge cases not covered

### Low Priority
1. ⚠️ **Output formatting not tested** - Table/JSON formatting uncovered
2. ⚠️ **Confirmation prompts not tested** - Delete/push confirmations
3. ⚠️ **Help text not validated** - Help content not verified

## Proposed Test Implementation Order

### Phase 1: Foundation (Week 1)
- [ ] Unit tests for existing commands (sites, wp, sync)
- [ ] Unit tests for utilities (target, graphql, version, context)
- [ ] Integration tests for GraphQL flow

### Phase 2: New Commands - Site Management (Week 2)
- [ ] Unit tests for site management commands
- [ ] E2E tests for site management
- [ ] Integration tests for site operations

### Phase 3: New Commands - WPE (Week 2-3)
- [ ] Unit tests for WPE commands
- [ ] E2E tests for WPE integration
- [ ] Integration tests for CAPI calls

### Phase 4: New Commands - Fleet (Week 3-4)
- [ ] Unit tests for fleet commands
- [ ] E2E tests for fleet operations
- [ ] Workflow tests for bulk operations

### Phase 5: New Commands - AI & Search (Week 4)
- [ ] Unit tests for AI commands
- [ ] Unit tests for search/index commands
- [ ] E2E tests for AI workflows

### Phase 6: Comprehensive E2E (Week 5)
- [ ] Workflow tests (full lifecycles)
- [ ] Error scenario tests
- [ ] Edge case coverage

## Success Criteria

### 100% Coverage Achieved When:
- ✅ Every command has unit tests (56 new test files)
- ✅ Every command has integration tests (GraphQL flow)
- ✅ Every command has E2E tests (actual CLI execution)
- ✅ All edge cases covered (error handling, validation)
- ✅ All workflows covered (multi-command scenarios)
- ✅ All output formats tested (JSON, table, progress)

### Metrics:
- **Line coverage:** >90%
- **Branch coverage:** >85%
- **Function coverage:** 100%
- **Command coverage:** 100% (all commands tested)

## Current Status Summary

```
Commands Implemented: 10/60+ (17%)
Commands Tested (E2E): 10/10 (100% of implemented)
Commands Tested (Unit): 0/10 (0% of implemented)
Commands Tested (Integration): 0/10 (0% of implemented)

Overall Test Coverage: ~15% (only E2E, no unit/integration)
Target Test Coverage: 100% (all types, all commands)
Gap: 85% of work remaining
```

## Next Steps

1. ✅ Document gaps (this file)
2. Implement Phase 1 commands (see CLI_MCP_FEATURE_PARITY.md)
3. Write unit tests for Phase 1 commands **before** implementation (TDD)
4. Write integration tests for Phase 1 commands
5. Expand E2E tests for Phase 1 commands
6. Repeat for Phases 2-7
7. Achieve 100% coverage across all test types
