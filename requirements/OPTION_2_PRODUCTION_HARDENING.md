# Option 2: Production Hardening - Implementation Plan

**Goal:** Prepare addon for production deployment with proper logging, monitoring, and proven stability under load.

**Estimated:** 3-5 days
**Priority:** HIGH - Required before marketplace launch

---

## Current State Audit

### Debug Logging Analysis
- **Total console statements:** 203 across 193 source files
- **Categories:**
  - CLI user-facing output: ~89 (intentional - sites: 44, sync: 32, wp: 13)
  - Debug logging: ~60 (needs removal)
  - Error logging: ~40 (keep, but improve)
  - Renderer UI feedback: ~14 (keep)

**Files with debug logging (to clean):**
- `src/main/mcp/tool-registry.ts` - 6 debug logs
- `src/main/mcp/mcp-safety-wrapper.ts` - 1 debug log
- `src/main/mcp/modules/wp-connector/event-tools.ts` - 16 debug logs
- `src/main/wpe-auto-pull.ts` - 22 logs (mix of debug + info)
- `src/main/search/SearchService.ts` - 11 logs
- `src/main/ipc-handlers.ts` - 14 logs

### Memory Usage Baseline
- **Current:** Unknown (need to measure)
- **Target:** <200MB RSS for 20-site fleet
- **Need:** Baseline measurement, leak detection

### Performance Baseline
- **E2E tests show:** Fast (search <1.2s, wp-cli <2s)
- **Fleet scale tested:** 37 sites (user's current fleet)
- **Need:** 100+ site stress test

---

## Task Breakdown

### Task 1: Structured Logging System (Day 1)

**Goal:** Replace ad-hoc console.log with structured, leveled logging

**Approach:**
1. Create `src/main/logging/Logger.ts`
   - Log levels: ERROR, WARN, INFO, DEBUG
   - Environment-aware (production = ERROR/WARN only)
   - Structured format: `[timestamp] [level] [component] message`
   - File output option for debugging

2. Replace console.log systematically:
   - **Keep:** CLI user-facing output (sites.ts, wp.ts, sync.ts)
   - **Remove:** Debug logs in tool-registry, safety-wrapper, event-tools
   - **Convert to Logger.error():** Error handling
   - **Convert to Logger.info():** Important operations (indexing, sync)
   - **Convert to Logger.debug():** Verbose debugging (off by default)

3. Add logging configuration:
   - Environment variable: `NEXUS_LOG_LEVEL` (ERROR, WARN, INFO, DEBUG)
   - Default: production = WARN, development = DEBUG
   - Log file path configuration

**Files to update:**
- Create: `src/main/logging/Logger.ts`
- Update: 18 files with significant logging
- Test: Verify logs don't spam in production mode

**Success criteria:**
- Clean production logs (no debug spam)
- Errors properly logged with context
- Performance impact <5ms per log call

---

### Task 2: Production Monitoring/Telemetry (Day 2)

**Goal:** Track key metrics for observability and debugging

**Metrics to track:**
1. **MCP Tool Usage**
   - Tool call counts by name
   - Success/error rates
   - Average duration per tool
   - Concurrent operation count

2. **Event Processing**
   - Events processed per minute
   - Event queue depth
   - Processing latency
   - Error rate

3. **Search Performance**
   - Query count
   - Average search time
   - Cache hit rate
   - Index size per site

4. **Resource Usage**
   - Memory usage (RSS)
   - Database file sizes
   - Vector table sizes
   - Active connection count

**Implementation:**
1. Create `src/main/telemetry/MetricsCollector.ts`
   - Counter, Gauge, Histogram metrics
   - In-memory storage with periodic aggregation
   - Export to JSON for analysis

2. Create `src/main/telemetry/PerformanceTracker.ts`
   - Wrap tool calls with timing
   - Track operation durations
   - Detect slow operations (>5s threshold)

3. Add health check endpoint
   - Expose via MCP tool: `get_system_health`
   - Return: memory, event queue, error rates, uptime

4. Add metrics dashboard (optional)
   - Simple HTML page served via MCP
   - Real-time metrics display
   - Performance graphs

**Files to create:**
- `src/main/telemetry/MetricsCollector.ts`
- `src/main/telemetry/PerformanceTracker.ts`
- `src/main/telemetry/types.ts`
- `src/main/mcp/modules/telemetry-tools.ts`

**Success criteria:**
- Metrics collected with <2% performance overhead
- Health check responds in <100ms
- Metrics exported to JSON on demand

---

### Task 3: Stress Testing (Day 3)

**Goal:** Validate performance with 100+ sites and 1000+ posts per site

**Test scenarios:**
1. **Fleet Scale Test**
   - Create 100 test sites (or use fixtures)
   - Run `list_indexed_sites` and measure response time
   - Run `fleet_summary` and measure memory/time
   - Run `find_outdated_sites` across 100 sites

2. **Large Site Test**
   - Create site with 1000 posts
   - Index all content and measure time/memory
   - Run search queries and measure response time
   - Run bulk operations (100 parallel plugin installs)

3. **Concurrent Operations Test**
   - 50 parallel `wp_plugin_list` calls
   - 20 parallel search queries
   - 10 parallel site creation operations
   - Monitor queue depth and latency

4. **Long-Running Operations**
   - Run indexing for 1 hour continuously
   - Monitor memory growth
   - Check for connection leaks
   - Verify database integrity

**Implementation:**
1. Create `tests/stress/` directory
2. Create test data generators:
   - `tests/stress/fixtures/site-generator.ts` - Create many sites
   - `tests/stress/fixtures/post-generator.ts` - Create many posts
   - `tests/stress/fixtures/cleanup.ts` - Clean up test data

3. Create stress test suites:
   - `tests/stress/01-fleet-scale.test.ts` - 100 sites
   - `tests/stress/02-large-site.test.ts` - 1000 posts
   - `tests/stress/03-concurrent-ops.test.ts` - Parallel load
   - `tests/stress/04-long-running.test.ts` - Memory leak detection

4. Add performance assertions:
   - Fleet operations: <5s for 100 sites
   - Search: <2s for 1000-post site
   - Memory: <500MB for 100 sites
   - No memory growth over 1 hour

**Files to create:**
- `tests/stress/fixtures/site-generator.ts`
- `tests/stress/fixtures/post-generator.ts`
- `tests/stress/01-fleet-scale.test.ts`
- `tests/stress/02-large-site.test.ts`
- `tests/stress/03-concurrent-ops.test.ts`
- `tests/stress/04-long-running.test.ts`

**Success criteria:**
- 100-site fleet operations complete in <10s
- 1000-post site indexing completes in <2 minutes
- No memory leaks detected over 1 hour
- All operations remain responsive under load

---

### Task 4: Memory Leak Detection (Day 4)

**Goal:** Identify and fix memory leaks in long-running operations

**Approach:**
1. **Baseline Memory Profiling**
   - Measure idle memory usage
   - Run operations and track heap growth
   - Use Node.js heap snapshots

2. **Long-Running Operation Tests**
   - Index/reindex 10 sites 100 times
   - Run 1000 search queries sequentially
   - Process 1000 WordPress events
   - Run bulk operations repeatedly

3. **Leak Detection Strategy**
   - Take heap snapshots before/after operations
   - Compare retained objects
   - Identify unclosed connections, listeners
   - Check for circular references

4. **Common Leak Sources**
   - Event listeners not cleaned up
   - Database connections not closed
   - Timers/intervals not cleared
   - Large objects in closure scope
   - Vector store handles not released

**Tools:**
- Node.js `--inspect` and Chrome DevTools
- `heapdump` package for snapshots
- `memwatch-next` for leak detection
- Custom RSS monitoring script

**Implementation:**
1. Create `tests/stress/memory-leak-detector.ts`
   - Run operations in loop
   - Track memory after each iteration
   - Alert if memory grows >10% over baseline

2. Create `scripts/profile-memory.js`
   - Start addon with profiling
   - Run test operations
   - Generate heap snapshots
   - Analyze and report leaks

3. Fix identified leaks:
   - Add cleanup to event processors
   - Ensure database connections close
   - Clear timers in lifecycle hooks
   - Add weak references where appropriate

**Files to create:**
- `tests/stress/memory-leak-detector.ts`
- `scripts/profile-memory.js`
- Update files with leak fixes

**Success criteria:**
- No memory growth over 1000 iterations
- All connections properly closed
- Event listeners cleaned up
- RSS stable at <200MB for 20 sites

---

### Task 5: Error Recovery Testing (Day 5)

**Goal:** Validate graceful degradation under failure conditions

**Failure scenarios:**
1. **Network Failures**
   - WPE API request timeout
   - WPE API 500 error
   - Network disconnect during sync
   - DNS resolution failure

2. **Disk Failures**
   - Disk full during indexing
   - Database file permissions error
   - Temp directory not writable
   - Vector file corruption

3. **Database Failures**
   - MySQL connection lost mid-query
   - Database file locked (concurrent access)
   - Query timeout (slow queries)
   - Corrupted database file

4. **Resource Exhaustion**
   - Out of memory
   - Too many open files
   - Event queue overflow
   - Thread pool exhausted

**Implementation:**
1. Create `tests/stress/error-recovery/` directory

2. Create fault injection helpers:
   - `tests/stress/error-recovery/network-simulator.ts` - Simulate network failures
   - `tests/stress/error-recovery/disk-simulator.ts` - Simulate disk errors
   - `tests/stress/error-recovery/db-simulator.ts` - Simulate database failures

3. Create recovery test suites:
   - `tests/stress/error-recovery/01-network-failures.test.ts`
   - `tests/stress/error-recovery/02-disk-failures.test.ts`
   - `tests/stress/error-recovery/03-db-failures.test.ts`
   - `tests/stress/error-recovery/04-resource-exhaustion.test.ts`

4. Add recovery mechanisms:
   - Retry logic with exponential backoff
   - Circuit breakers for failing services
   - Graceful degradation (continue without failed service)
   - Data integrity checks after recovery
   - User-visible error messages

**Files to create:**
- `tests/stress/error-recovery/network-simulator.ts`
- `tests/stress/error-recovery/disk-simulator.ts`
- `tests/stress/error-recovery/01-network-failures.test.ts`
- `tests/stress/error-recovery/02-disk-failures.test.ts`
- `tests/stress/error-recovery/03-db-failures.test.ts`
- Update error handling in main codebase

**Success criteria:**
- Network failures trigger retry (3x with backoff)
- Disk full errors logged and reported to user
- Database failures don't corrupt data
- System remains responsive after recovery
- No crashes from resource exhaustion

---

## Implementation Schedule

### Day 1: Structured Logging
- [ ] Create Logger class with levels
- [ ] Replace console.log in critical paths (tool-registry, safety-wrapper, event-tools)
- [ ] Add logging configuration
- [ ] Test production log output

### Day 2: Telemetry
- [ ] Create MetricsCollector and PerformanceTracker
- [ ] Instrument MCP tool calls
- [ ] Add event processing metrics
- [ ] Create health check tool
- [ ] Test metrics collection overhead

### Day 3: Stress Testing
- [ ] Create test data generators
- [ ] Write fleet scale tests (100 sites)
- [ ] Write large site tests (1000 posts)
- [ ] Write concurrent operation tests
- [ ] Run tests and collect baseline performance

### Day 4: Memory Leak Detection
- [ ] Create memory profiling tools
- [ ] Run long-running operation tests
- [ ] Take heap snapshots and analyze
- [ ] Fix identified leaks
- [ ] Verify fixes with repeated tests

### Day 5: Error Recovery
- [ ] Create fault injection helpers
- [ ] Write network failure tests
- [ ] Write disk failure tests
- [ ] Write database failure tests
- [ ] Add retry/recovery mechanisms
- [ ] Verify graceful degradation

---

## Success Metrics

### Logging
- ✅ Production logs are clean (no debug spam)
- ✅ Errors include full context for debugging
- ✅ Logging overhead <5ms per call
- ✅ Log levels configurable via environment

### Telemetry
- ✅ Key metrics tracked (tool calls, events, search, memory)
- ✅ Health check responds in <100ms
- ✅ Metrics overhead <2%
- ✅ Metrics exportable for analysis

### Performance
- ✅ 100-site fleet operations <10s
- ✅ 1000-post site indexing <2 minutes
- ✅ Search queries <2s under load
- ✅ Memory usage <500MB for 100 sites

### Stability
- ✅ No memory leaks over 1000 iterations
- ✅ No crashes under normal load
- ✅ Graceful recovery from network failures
- ✅ No data corruption from failures

### Resilience
- ✅ Network failures trigger retry (3x with backoff)
- ✅ Disk full errors reported to user
- ✅ Database failures don't corrupt data
- ✅ System remains responsive after recovery

---

## Risk Mitigation

### High Risk Items
1. **Memory leaks in long-running operations**
   - Mitigation: Heap profiling and leak detection tests
   - Fallback: Restart addon daily (not ideal, but safe)

2. **Performance degradation with 100+ sites**
   - Mitigation: Pagination, lazy loading, caching
   - Fallback: Recommend site count limits

3. **Database corruption from concurrent access**
   - Mitigation: Connection pooling, transaction isolation
   - Fallback: Backup/restore mechanism

### Medium Risk Items
1. **Telemetry overhead slows operations**
   - Mitigation: Async metrics collection, sampling
   - Fallback: Make telemetry optional

2. **Stress tests can't create 100 sites (resource limits)**
   - Mitigation: Use fixtures/mocks for site data
   - Fallback: Test with 50 sites instead

---

## Deliverables

### Code
- Structured logging system
- Telemetry and metrics collection
- Stress test suite (4 test files)
- Memory leak detection tools
- Error recovery tests and mechanisms

### Documentation
- Logging configuration guide
- Metrics reference (what's tracked)
- Performance benchmarks (100 sites, 1000 posts)
- Known limitations and recommendations

### Test Results
- Stress test performance report
- Memory leak analysis report
- Error recovery validation report
- Production readiness checklist

---

**Last Updated:** 2026-03-19
**Status:** Ready to begin
**Next Step:** Day 1 - Create structured logging system
