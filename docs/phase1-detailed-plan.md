# Phase 1: Event Processing System - Detailed Plan

## Overview

This plan follows **Test-Driven Development (TDD)** with API contracts as the specification. We will:

1. Define API contracts (OpenAPI + TypeScript + SQL)
2. Write failing tests that validate contracts (RED)
3. Implement to make tests pass (GREEN)
4. Achieve 80% code coverage (DONE)

**Success Criteria:**
- ✅ All tests passing (unit + integration + E2E)
- ✅ 80% code coverage
- ✅ OpenAPI spec published and validated

---

## 1. API Contracts

### 1.1 HTTP API (OpenAPI 3.0)

**File:** `src/main/mcp/contracts/http-api.yaml`

```yaml
openapi: 3.0.0
info:
  title: Nexus AI Event Processing API
  version: 1.0.0
  description: HTTP interface for receiving WordPress events and calling MCP tools

servers:
  - url: http://localhost:{port}
    description: Local development server
    variables:
      port:
        default: '51234'

paths:
  /health:
    get:
      summary: Health check endpoint
      operationId: healthCheck
      responses:
        '200':
          description: Service is healthy
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthResponse'

  /info:
    get:
      summary: Get server information and capabilities
      operationId: getInfo
      responses:
        '200':
          description: Server information
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InfoResponse'

  /api/events:
    post:
      summary: Receive event from WordPress
      operationId: receiveEvent
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SiteEvent'
      responses:
        '202':
          description: Event queued for processing
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EventQueuedResponse'
        '400':
          description: Invalid event format
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '500':
          description: Internal server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  /api/tools/{toolName}:
    post:
      summary: Call MCP tool via HTTP
      operationId: callTool
      parameters:
        - name: toolName
          in: path
          required: true
          schema:
            type: string
          description: Name of the MCP tool to call
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ToolCallRequest'
      responses:
        '200':
          description: Tool execution result
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ToolCallResponse'
        '404':
          description: Tool not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

components:
  schemas:
    HealthResponse:
      type: object
      required:
        - status
        - mcpServer
        - eventProcessor
      properties:
        status:
          type: string
          enum: [ok, degraded, error]
        mcpServer:
          type: string
          enum: [running, stopped]
        eventProcessor:
          type: object
          properties:
            running:
              type: boolean
            queueSize:
              type: integer
            lastProcessed:
              type: string
              format: date-time

    InfoResponse:
      type: object
      required:
        - name
        - version
        - port
        - capabilities
      properties:
        name:
          type: string
        version:
          type: string
        port:
          type: integer
        capabilities:
          type: array
          items:
            type: string

    SiteEvent:
      type: object
      required:
        - site_id
        - event_type
        - timestamp
        - data
      properties:
        site_id:
          type: string
          description: WordPress site identifier
        event_type:
          type: string
          enum:
            - post_published
            - post_updated
            - post_deleted
            - plugin_activated
            - plugin_deactivated
            - theme_switched
            - user_login
            - user_logout
            - user_registered
        timestamp:
          type: string
          format: date-time
        data:
          type: object
          additionalProperties: true
          description: Event-specific data payload

    EventQueuedResponse:
      type: object
      required:
        - queued
      properties:
        queued:
          type: boolean
        event_id:
          type: string
          description: Unique identifier for the queued event

    ToolCallRequest:
      type: object
      required:
        - args
      properties:
        args:
          type: object
          additionalProperties: true

    ToolCallResponse:
      type: object
      properties:
        content:
          type: array
          items:
            type: object
        isError:
          type: boolean

    ErrorResponse:
      type: object
      required:
        - error
      properties:
        error:
          type: string
        details:
          type: object
```

### 1.2 TypeScript Interfaces

**File:** `src/main/mcp/contracts/types.ts`

```typescript
/**
 * HTTP API request/response types
 * These mirror the OpenAPI schema
 */

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  mcpServer: 'running' | 'stopped';
  eventProcessor: {
    running: boolean;
    queueSize: number;
    lastProcessed?: string;
  };
}

export interface InfoResponse {
  name: string;
  version: string;
  port: number;
  capabilities: string[];
  availableTools?: string[];
}

export interface SiteEvent {
  site_id: string;
  event_type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type EventType =
  | 'post_published'
  | 'post_updated'
  | 'post_deleted'
  | 'plugin_activated'
  | 'plugin_deactivated'
  | 'theme_switched'
  | 'user_login'
  | 'user_logout'
  | 'user_registered';

export interface EventQueuedResponse {
  queued: boolean;
  event_id?: string;
}

export interface ToolCallRequest {
  args: Record<string, unknown>;
}

export interface ToolCallResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

export interface ErrorResponse {
  error: string;
  details?: Record<string, unknown>;
}

/**
 * Internal API types
 * Used between EventProcessor, GraphService, etc.
 */

export interface ProcessedEvent extends SiteEvent {
  id: string;
  processed: boolean;
  processed_at?: string;
  error?: string;
}

export interface EventProcessorConfig {
  batchSize: number;
  processingInterval: number; // milliseconds
  maxQueueSize: number;
  retryAttempts: number;
}

export interface GraphNode {
  site_id: string;
  type: 'post' | 'plugin' | 'user' | 'theme';
  id: string;
  metadata: Record<string, unknown>;
}

export interface GraphRelationship {
  site_id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relationship: string;
  metadata?: Record<string, unknown>;
}

export interface StorageStats {
  dbSizeMb: number;
  eventCount: number;
  oldestEventDate: string;
  newestEventDate: string;
  embeddingCount: number;
}
```

### 1.3 Database Schema

**File:** `src/main/graph/schema.sql`

```sql
-- Events table: stores all received events
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL, -- JSON
    processed INTEGER DEFAULT 0,
    processed_at TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),

    -- Indexes for query performance
    INDEX idx_events_site_id (site_id),
    INDEX idx_events_type (event_type),
    INDEX idx_events_processed (processed),
    INDEX idx_events_timestamp (timestamp)
);

-- Sites table: tracks known WordPress sites
CREATE TABLE IF NOT EXISTS sites (
    site_id TEXT PRIMARY KEY,
    name TEXT,
    url TEXT,
    first_seen TEXT NOT NULL,
    last_event_at TEXT,
    event_count INTEGER DEFAULT 0,

    INDEX idx_sites_last_event (last_event_at)
);

-- Content table: tracks posts/pages
CREATE TABLE IF NOT EXISTS content (
    site_id TEXT NOT NULL,
    post_id INTEGER NOT NULL,
    post_type TEXT DEFAULT 'post',
    title TEXT,
    excerpt TEXT,
    topics TEXT, -- JSON array
    author_id INTEGER,
    published_at TEXT,
    updated_at TEXT,

    PRIMARY KEY (site_id, post_id),
    INDEX idx_content_updated (site_id, updated_at)
);

-- Plugins table: tracks installed plugins
CREATE TABLE IF NOT EXISTS plugins (
    site_id TEXT NOT NULL,
    plugin_slug TEXT NOT NULL,
    plugin_name TEXT,
    version TEXT,
    active INTEGER DEFAULT 0,
    activated_at TEXT,
    deactivated_at TEXT,
    updated_at TEXT,

    PRIMARY KEY (site_id, plugin_slug),
    INDEX idx_plugins_active (site_id, active)
);

-- Users table: tracks user activity
CREATE TABLE IF NOT EXISTS users (
    site_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    user_login TEXT,
    user_email TEXT,
    role TEXT,
    registered_at TEXT,
    last_login TEXT,

    PRIMARY KEY (site_id, user_id),
    INDEX idx_users_last_login (site_id, last_login)
);

-- Relationships table: tracks connections between entities
CREATE TABLE IF NOT EXISTS relationships (
    site_id TEXT NOT NULL,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relationship TEXT NOT NULL,
    metadata TEXT, -- JSON
    created_at TEXT DEFAULT (datetime('now')),

    PRIMARY KEY (site_id, from_type, from_id, to_type, to_id, relationship),
    INDEX idx_relationships_from (site_id, from_type, from_id),
    INDEX idx_relationships_to (site_id, to_type, to_id)
);
```

**File:** `src/main/graph/types.ts`

```typescript
/**
 * Database record types
 * These match the SQL schema exactly
 */

export interface EventRecord {
  id: number;
  site_id: string;
  event_type: string;
  timestamp: string;
  data: string; // JSON string
  processed: 0 | 1;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface SiteRecord {
  site_id: string;
  name: string | null;
  url: string | null;
  first_seen: string;
  last_event_at: string | null;
  event_count: number;
}

export interface ContentRecord {
  site_id: string;
  post_id: number;
  post_type: string;
  title: string | null;
  excerpt: string | null;
  topics: string | null; // JSON array
  author_id: number | null;
  published_at: string | null;
  updated_at: string | null;
}

export interface PluginRecord {
  site_id: string;
  plugin_slug: string;
  plugin_name: string | null;
  version: string | null;
  active: 0 | 1;
  activated_at: string | null;
  deactivated_at: string | null;
  updated_at: string | null;
}

export interface UserRecord {
  site_id: string;
  user_id: number;
  user_login: string | null;
  user_email: string | null;
  role: string | null;
  registered_at: string | null;
  last_login: string | null;
}

export interface RelationshipRecord {
  site_id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relationship: string;
  metadata: string | null; // JSON
  created_at: string;
}
```

---

## 2. Test Infrastructure

### 2.1 Test Structure (Test Pyramid)

```
tests/
├── unit/                      # Fast, isolated, mocked dependencies
│   ├── http-interface.test.ts
│   ├── event-processor.test.ts
│   ├── graph-service.test.ts
│   └── storage-pruning.test.ts
│
├── integration/               # Real dependencies, no mocks
│   ├── event-pipeline.int.test.ts
│   ├── graph-operations.int.test.ts
│   ├── embedding-pipeline.int.test.ts
│   └── storage-lifecycle.int.test.ts
│
├── e2e/                       # Full system tests
│   ├── wordpress-to-local.e2e.test.ts
│   ├── http-tool-access.e2e.test.ts
│   └── multi-site.e2e.test.ts
│
├── factories/                 # Test data generators
│   ├── event-factory.ts
│   ├── site-factory.ts
│   └── content-factory.ts
│
└── helpers/                   # Test utilities
    ├── test-server.ts
    ├── test-db.ts
    └── wait-for.ts
```

### 2.2 Factory Functions

**File:** `tests/factories/event-factory.ts`

```typescript
import { SiteEvent } from '../../src/main/mcp/contracts/types';

export class EventFactory {
  static postUpdated(overrides: Partial<SiteEvent> = {}): SiteEvent {
    return {
      site_id: 'test-site-' + Math.random().toString(36).slice(2, 9),
      event_type: 'post_updated',
      timestamp: new Date().toISOString(),
      data: {
        post_id: Math.floor(Math.random() * 10000),
        title: 'Test Post Title',
        content: 'This is test post content with some meaningful text for embedding generation.',
        author_id: 1,
        post_type: 'post',
        post_status: 'publish',
      },
      ...overrides,
    };
  }

  static pluginActivated(overrides: Partial<SiteEvent> = {}): SiteEvent {
    return {
      site_id: 'test-site-' + Math.random().toString(36).slice(2, 9),
      event_type: 'plugin_activated',
      timestamp: new Date().toISOString(),
      data: {
        plugin_slug: 'test-plugin',
        plugin_name: 'Test Plugin',
        version: '1.0.0',
        network_wide: false,
      },
      ...overrides,
    };
  }

  static batch(count: number, template: Partial<SiteEvent> = {}): SiteEvent[] {
    return Array.from({ length: count }, () =>
      this.postUpdated(template)
    );
  }
}
```

**File:** `tests/factories/site-factory.ts`

```typescript
export class SiteFactory {
  static create(overrides: Partial<any> = {}) {
    const siteId = 'site-' + Math.random().toString(36).slice(2, 9);
    return {
      site_id: siteId,
      name: `Test Site ${siteId}`,
      url: `http://${siteId}.local`,
      first_seen: new Date().toISOString(),
      ...overrides,
    };
  }
}
```

### 2.3 Test Helpers

**File:** `tests/helpers/test-db.ts`

```typescript
import path from 'path';
import fs from 'fs-extra';
import { GraphService } from '../../src/main/graph/GraphService';

export class TestDatabase {
  private dbPath: string;
  public graphService: GraphService;

  constructor() {
    // Create temp DB with unique name
    this.dbPath = path.join(
      process.cwd(),
      'tmp',
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
  }

  async setup() {
    await fs.ensureDir(path.dirname(this.dbPath));
    this.graphService = new GraphService(this.dbPath);
    await this.graphService.initialize();
  }

  async teardown() {
    await this.graphService.close();
    await fs.remove(this.dbPath);
  }

  getPath() {
    return this.dbPath;
  }
}
```

**File:** `tests/helpers/wait-for.ts`

```typescript
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await sleep(interval);
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 2.4 Coverage Configuration

**File:** `jest.config.js` (update)

```javascript
module.exports = {
  // ... existing config

  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  collectCoverageFrom: [
    'src/main/mcp/http-interface.ts',
    'src/main/event-processor/**/*.ts',
    'src/main/graph/**/*.ts',
    '!**/*.test.ts',
    '!**/*.int.test.ts',
    '!**/*.e2e.test.ts',
  ],
};
```

---

## 3. Test Development Roadmap

### Phase 1a: Write Failing Tests (RED)

**Order of test development:**

1. **Unit Tests for HttpInterface** (simplest, no dependencies)
   ```typescript
   // tests/unit/http-interface.test.ts
   describe('HttpInterface', () => {
     it('should respond to health check')
     it('should respond with server info')
     it('should accept valid events')
     it('should reject invalid events')
     it('should handle tool calls')
   });
   ```
   **Expected:** 0/5 tests passing

2. **Unit Tests for EventProcessor**
   ```typescript
   // tests/unit/event-processor.test.ts
   describe('EventProcessor', () => {
     it('should enqueue events')
     it('should process events in batches')
     it('should handle processing errors gracefully')
     it('should retry failed events')
   });
   ```
   **Expected:** 0/4 tests passing

3. **Unit Tests for GraphService**
   ```typescript
   // tests/unit/graph-service.test.ts
   describe('GraphService', () => {
     it('should insert event records')
     it('should query events by site')
     it('should create content records')
     it('should create relationships')
   });
   ```
   **Expected:** 0/4 tests passing

4. **Integration Tests** (real SQLite, real LanceDB)
   ```typescript
   // tests/integration/event-pipeline.int.test.ts
   describe('Event Pipeline Integration', () => {
     it('should process event end-to-end')
     it('should create embeddings')
     it('should update graph')
   });
   ```
   **Expected:** 0/3 tests passing

5. **E2E Tests** (full system with HTTP server)
   ```typescript
   // tests/e2e/wordpress-to-local.e2e.test.ts
   describe('WordPress → Local E2E', () => {
     it('should receive WordPress event via HTTP')
     it('should process event in background')
     it('should create searchable embedding')
   });
   ```
   **Expected:** 0/3 tests passing

**Total after Phase 1a: 0/19 tests passing ❌**

### Phase 1b: Implement to Make Tests Pass (GREEN)

**Implementation order (follows test dependency chain):**

1. **Implement GraphService** (needed by EventProcessor)
   - Create SQLite connection
   - Implement schema initialization
   - Implement CRUD operations

   **Expected:** 4/19 tests passing ✅ (graph unit tests)

2. **Implement EventProcessor** (depends on GraphService)
   - Create event queue
   - Implement processing loop
   - Wire up handlers

   **Expected:** 8/19 tests passing ✅ (graph + processor unit tests)

3. **Implement HttpInterface** (depends on EventProcessor)
   - Create Express server
   - Add endpoints
   - Store connection info

   **Expected:** 13/19 tests passing ✅ (all unit tests)

4. **Wire Integration** (connect all components)
   - Connect HttpInterface → EventProcessor → GraphService
   - Connect EventProcessor → EmbeddingService → VectorDB

   **Expected:** 16/19 tests passing ✅ (unit + integration tests)

5. **Polish E2E Flow**
   - Fix timing issues
   - Add retry logic
   - Handle edge cases

   **Expected:** 19/19 tests passing ✅✅✅ (ALL TESTS GREEN)

### Phase 1c: Achieve Coverage Threshold

**Run coverage analysis:**
```bash
npm run test:coverage
```

**Expected gaps:**
- Error handling paths (try/catch blocks)
- Edge cases (empty queues, null checks)
- Cleanup/teardown logic

**Add tests for uncovered paths:**
```typescript
// Additional tests for coverage
describe('Error Handling', () => {
  it('should handle SQLite locked errors')
  it('should handle embedding service failures')
  it('should handle malformed JSON in events')
});
```

**Target:** 80%+ coverage on all metrics ✅

---

## 4. Implementation Checklist

### HttpInterface (8 tests)

**Unit Tests:**
- [ ] GET /health returns 200 with correct schema
- [ ] GET /info returns server information
- [ ] POST /api/events with valid event returns 202
- [ ] POST /api/events with invalid event returns 400
- [ ] POST /api/tools/:toolName calls MCP tool
- [ ] POST /api/tools/:toolName with invalid tool returns 404
- [ ] Server starts on available port
- [ ] Connection info file is created

**Implementation Files:**
- `src/main/mcp/http-interface.ts` (~250 LOC)
- `src/main/mcp/connection-info.ts` (~50 LOC)

### EventProcessor (12 tests)

**Unit Tests:**
- [ ] enqueue() adds event to queue
- [ ] enqueue() persists event to database
- [ ] processQueue() processes events in batches
- [ ] processQueue() marks events as processed
- [ ] Processing loop runs at configured interval
- [ ] Failed events are retried with backoff
- [ ] Queue size is limited (FIFO eviction)
- [ ] Different event types route to correct handlers

**Integration Tests:**
- [ ] Post event → embedding created in LanceDB
- [ ] Plugin event → plugin record in SQLite
- [ ] User event → user record in SQLite
- [ ] Processing handles concurrent events correctly

**Implementation Files:**
- `src/main/event-processor/EventProcessor.ts` (~200 LOC)
- `src/main/event-processor/handlers/ContentHandler.ts` (~100 LOC)
- `src/main/event-processor/handlers/PluginHandler.ts` (~80 LOC)
- `src/main/event-processor/handlers/UserHandler.ts` (~80 LOC)

### GraphService (15 tests)

**Unit Tests:**
- [ ] initialize() creates schema
- [ ] insertEvent() creates event record
- [ ] getEvents() retrieves events by site
- [ ] markProcessed() updates processed flag
- [ ] upsertContent() creates/updates content
- [ ] upsertPlugin() creates/updates plugin
- [ ] upsertUser() creates/updates user
- [ ] createRelationship() creates relationship
- [ ] getRelationships() queries relationships
- [ ] getStorageStats() returns accurate stats

**Integration Tests:**
- [ ] Multiple concurrent writes don't conflict
- [ ] Queries use indexes (verify with EXPLAIN)
- [ ] Database file size grows reasonably
- [ ] Schema migrations work correctly
- [ ] Foreign key constraints are enforced

**Implementation Files:**
- `src/main/graph/GraphService.ts` (~300 LOC)
- `src/main/graph/migrations.ts` (~100 LOC)

### Storage Pruning (5 tests)

**Unit Tests:**
- [ ] pruneOldEvents() deletes events older than retention
- [ ] pruneOldEvents() respects max DB size
- [ ] VACUUM reclaims space after deletion
- [ ] Pruning runs on schedule
- [ ] Pruning doesn't delete unprocessed events

**Implementation Files:**
- `src/main/graph/StoragePruner.ts` (~150 LOC)

---

## 5. Success Metrics

### Test Passing Criteria

**Phase 1a Complete (RED):**
- 0/40 tests passing
- All tests fail with clear error messages
- Tests validate API contracts

**Phase 1b Complete (GREEN):**
- 40/40 tests passing
- All unit tests green
- All integration tests green
- All E2E tests green

**Phase 1c Complete (DONE):**
- 40/40 tests passing
- 80%+ code coverage on branches, functions, lines, statements
- Coverage report generated

### Time Estimates

- **Phase 1a (Write Tests):** 2-3 days
  - Day 1: API contracts + unit tests
  - Day 2: Integration tests + E2E tests
  - Day 3: Factories, helpers, coverage config

- **Phase 1b (Implement):** 4-5 days
  - Day 1: GraphService
  - Day 2: EventProcessor
  - Day 3: HttpInterface
  - Day 4: Integration wiring
  - Day 5: E2E polish

- **Phase 1c (Coverage):** 1 day
  - Analyze coverage gaps
  - Add missing tests
  - Verify 80% threshold

**Total: 7-9 days**

---

## 6. Next Steps

1. **Review this plan** - Any questions or adjustments needed?

2. **Start Phase 1a** - Create API contracts and write failing tests
   - Create `contracts/` directory
   - Write OpenAPI spec
   - Write TypeScript interfaces
   - Write SQL schema
   - Write test factories
   - Write first batch of unit tests

3. **Validate RED phase** - Ensure all tests fail for the right reasons

4. **Begin Phase 1b** - Implement to make tests pass (GREEN)

**Ready to start?** Should I begin with creating the contracts and first test files?
