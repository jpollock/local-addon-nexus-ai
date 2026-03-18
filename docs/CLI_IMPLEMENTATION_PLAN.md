# CLI Implementation Plan

**Date:** 2026-03-18
**Branch:** `mvp-v1`
**Goal:** Add CLI interface alongside existing MCP server, following local-addon-cli-mcp pattern

---

## TL;DR

**Current State:** 71 MCP tools, no CLI
**Target State:** 71 MCP tools + CLI wrapper via GraphQL
**Architecture:** Addon provides MCP + GraphQL → CLI calls GraphQL → User gets `nexus` command

**Effort Estimate:** 3-5 days (Medium complexity)
- Day 1: Monorepo setup, GraphQL mutations (20 tools)
- Day 2: GraphQL mutations (51 more tools)
- Day 3: CLI package, Commander setup, core commands
- Day 4: CLI commands for all 71 tools
- Day 5: Testing, docs, polish

---

## Architecture Comparison

### Reference: local-addon-cli-mcp

```
local-addon-cli-mcp/
├── packages/
│   ├── addon/              # Local addon (main + renderer)
│   │   ├── package.json    # "bin": { "local-mcp": "./bin/mcp-stdio.js" }
│   │   ├── src/
│   │   │   ├── main.ts     # Provides GraphQL mutations + MCP server
│   │   │   └── mcp/        # MCP tools
│   │   └── bin/
│   │       └── mcp-stdio.js  # MCP stdio transport for Claude Desktop
│   └── cli/                # Standalone CLI
│       ├── package.json    # "bin": { "lwp": "./bin/lwp.js" }
│       └── src/
│           └── index.ts    # Commander.js CLI → GraphQL client
├── package.json            # Workspace root
└── README.md
```

**Key Points:**
- **Monorepo** with workspaces (addon + cli)
- **Addon** provides BOTH MCP server and GraphQL mutations
- **CLI** communicates via GraphQL (not MCP)
- **Two binaries:** `local-mcp` (MCP stdio) and `lwp` (CLI)

**GraphQL Communication:**
```javascript
// packages/cli/src/index.ts
const client = new GraphQLClient(
  'graphql://localhost:50450/graphql',
  {
    headers: {
      'X-Local-Token': process.env.LOCAL_GRAPHQL_TOKEN || '',
    },
  }
);

const result = await client.request(gql`
  mutation DeleteSite($id: ID!) {
    deleteSite(siteId: $id) {
      id
    }
  }
`, { id: siteId });
```

**Example Commands:**
```bash
lwp sites list                    # List all sites
lwp sites start my-site           # Start a site
lwp wp my-site plugin list        # Run WP-CLI on site
lwp wpe push my-site staging      # Push to WPE
```

---

### Current: nexus-ai

```
local-addon-nexus-ai/
├── src/
│   ├── main/
│   │   ├── index.ts          # Addon entry, registers services
│   │   ├── mcp/              # MCP server + 71 tools
│   │   │   ├── McpServer.ts  # HTTP/SSE MCP server
│   │   │   ├── tool-registry.ts
│   │   │   └── modules/      # 10 tool modules
│   │   ├── services/         # All infrastructure
│   │   └── ipc-handlers.ts   # IPC for renderer ↔ main
│   └── renderer/             # UI components
├── package.json              # Single package (no workspaces)
└── README.md
```

**Key Points:**
- **Single package** (not monorepo)
- **MCP server only** (no GraphQL)
- **71 tools** across 10 modules
- **No CLI** interface

---

## Implementation Strategy

### ✅ VALIDATED: Single Package with GraphQL Extension

**Findings from Local Source Code:**
- Local provides a GraphQL service (`GraphQLService.ts`) that addons can extend
- Addons register GraphQL schemas via `graphql.registerGraphQLService(serviceId, typeDefs, resolvers)`
- Local merges all addon schemas and serves them on `http://127.0.0.1:<port>/graphql`
- Connection info stored in userData: `{ url, subscriptionUrl, authToken, port }`

**Reference Implementation (`local-addon-cli-mcp`):**
```typescript
// packages/addon/src/main/index.ts (line 4092)
export default function (_context: LocalMain.AddonMainContext): void {
  const services = LocalMain.getServiceContainer().cradle as any;
  const { localLogger, graphql } = services;

  // Register GraphQL extensions (for local-cli and MCP)
  const resolvers = createResolvers(services);
  graphql.registerGraphQLService('mcp-server', typeDefs, resolvers);
  localLogger.info(`[${ADDON_NAME}] Registered GraphQL: 29 tools`);

  // ... MCP server also runs separately ...
}
```

**Architecture for Nexus AI:**
```
local-addon-nexus-ai/
├── src/
│   ├── main/
│   │   ├── index.ts             # Register GraphQL + start MCP server
│   │   ├── mcp/                 # Existing MCP tools (71 tools)
│   │   ├── graphql/             # NEW: GraphQL schema + resolvers
│   │   │   ├── schema.ts        # GraphQL type definitions
│   │   │   └── resolvers.ts     # Mutations that call MCP tools
│   │   └── services/            # Existing services
│   ├── renderer/                # Existing UI
│   └── cli/                     # NEW: CLI package
│       ├── index.ts             # Commander.js entry
│       ├── commands/            # Command implementations
│       │   ├── sites.ts
│       │   ├── wp.ts
│       │   ├── wpe.ts
│       │   ├── content.ts
│       │   └── fleet.ts
│       └── utils/
│           └── graphql.ts       # GraphQL client helper
├── bin/
│   └── nexus.js                 # CLI entry point (#!/usr/bin/env node)
└── package.json                 # Add "bin": { "nexus": "./bin/nexus.js" }
```

**Key Points:**
- ✅ No restructure needed - keep current single-package layout
- ✅ GraphQL uses Local's existing server (no new port needed)
- ✅ MCP and GraphQL run side-by-side (AI gets MCP, CLI gets GraphQL)
- ✅ CLI connects to `http://localhost:<port>/graphql` using auth token from userData
- ✅ Both interfaces share the same ToolRegistry backend

**Recommendation: Single Package (No Monorepo)**

Rationale:
- Local's GraphQL service handles multi-addon schema merging
- No need for separate packages - addons extend Local's GraphQL
- Simpler build, easier to maintain
- Can still publish CLI separately later if needed

---

## Implementation Plan (Option B)

### Phase 1: Add GraphQL Mutations to Addon

**Goal:** Expose all 71 MCP tools via GraphQL mutations

**Location:** `src/main/graphql/` (new directory)

**Files to Create:**

1. **`src/main/graphql/schema.ts`** - GraphQL type definitions
2. **`src/main/graphql/resolvers.ts`** - Mutation resolvers
3. **`src/main/graphql/client.ts`** - GraphQL client helper (for CLI)

**Pattern:**

Each MCP tool gets a GraphQL mutation:

```typescript
// src/main/graphql/schema.ts
export const typeDefs = gql`
  type Query {
    ping: String
  }

  type Mutation {
    # Site Management (11 tools)
    listSites: ListSitesResult!
    startSite(site: String!): SiteResult!
    stopSite(site: String!): SiteResult!
    restartSite(site: String!): SiteResult!
    cloneSite(site: String!, newName: String!): SiteResult!
    deleteSite(site: String!, confirmationToken: String): SiteResult!
    createSite(name: String!, options: CreateSiteInput): SiteResult!
    getSiteLogs(site: String!, lines: Int): LogsResult!
    exportSite(site: String!, path: String!): ExportResult!
    importSite(path: String!, name: String!): SiteResult!
    trustSsl(site: String!): SiteResult!

    # WP-CLI Tools (16 tools)
    wpPluginList(siteId: String, installName: String): PluginListResult!
    wpPluginInstall(siteId: String, installName: String, slug: String!): PluginResult!
    wpPluginActivate(siteId: String, installName: String, slug: String!): PluginResult!
    wpPluginDeactivate(siteId: String, installName: String, slug: String!): PluginResult!
    wpPluginUpdate(siteId: String, installName: String, slug: String, all: Boolean, dryRun: Boolean): UpdateResult!
    wpThemeList(siteId: String, installName: String): ThemeListResult!
    wpCoreVersion(siteId: String, installName: String): VersionResult!
    wpUserList(siteId: String, installName: String): UserListResult!
    wpOptionGet(siteId: String, installName: String, key: String!): OptionResult!
    wpSiteHealth(siteId: String!): HealthResult!
    wpDbExport(siteId: String!, path: String): ExportResult!
    wpSearchReplace(siteId: String!, search: String!, replace: String!, dryRun: Boolean): SearchReplaceResult!
    wpPostCreate(siteId: String, installName: String, title: String!, content: String, status: String): PostResult!
    wpPostUpdate(siteId: String, installName: String, id: Int!, title: String, content: String, status: String): PostResult!
    wpPostDelete(siteId: String, installName: String, id: Int!, force: Boolean): PostResult!
    wpEval(siteId: String, installName: String, code: String!): EvalResult!

    # WPE Tools (9 tools)
    wpeGetAccounts: WpeAccountsResult!
    wpeGetInstalls(accountId: String): WpeInstallsResult!
    wpeGetInstall(installId: String!): WpeInstallResult!
    wpeCreateBackup(installId: String!, description: String): WpeBackupResult!
    wpePurgeCache(installId: String!): WpeCacheResult!
    wpeLink(siteId: String!, installId: String!): LinkResult!
    wpePull(siteId: String!, installId: String!, includeDatabase: Boolean, includeFiles: Boolean): PullResult!
    wpePush(siteId: String!, installId: String!, includeDatabase: Boolean, includeFiles: Boolean): PushResult!
    wpeSync: WpeSyncResult!

    # Content Tools (2 tools)
    searchContent(query: String!, limit: Int, filters: SearchFilters): SearchResult!
    getIndexedSites: IndexedSitesResult!

    # Site Context Tools (4 tools)
    getSiteInfo(siteId: String!): SiteInfoResult!
    getSiteStructure(siteId: String!): SiteStructureResult!
    getSiteEvents(siteId: String!, limit: Int, types: [String]): EventsResult!
    getSiteHealth(siteId: String!): HealthResult!

    # Ollama Tools (2 tools)
    ollamaListModels: OllamaModelsResult!
    ollamaCheckStatus: OllamaStatusResult!

    # Fleet Tools (6 tools)
    fleetSummary: FleetSummaryResult!
    findSitesWithPlugin(slug: String!): SitesResult!
    findSitesWithTheme(slug: String!): SitesResult!
    findOutdatedSites: SitesResult!
    compareSites(siteIds: [String!]!): ComparisonResult!
    detectDrift: DriftResult!

    # Composite Tools (2 tools)
    setupWpAi(siteId: String!, provider: String, apiKey: String): SetupResult!
    deployToWpe(siteId: String!, installId: String!): DeployResult!

    # WP Connector Tools (11 tools)
    installAiPlugin(siteId: String!): PluginResult!
    activateAiPlugin(siteId: String!): PluginResult!
    configureAiPlugin(siteId: String!, settings: AiPluginSettings): ConfigResult!
    enableAiFeatures(siteId: String!, features: [String!]): FeaturesResult!
    syncCredentials(siteIds: [String!]): SyncResult!
    enableAcfAbilities(siteId: String!): AcfResult!
    getAiStatus(siteId: String!): AiStatusResult!
    setupAiProxy(siteId: String!): ProxyResult!
    bulkSetupAi(siteIds: [String!]!, provider: String): BulkSetupResult!
    createAiContent(siteId: String!, prompt: String!, type: String): ContentResult!
    indexSiteContent(siteId: String!, force: Boolean): IndexResult!

    # Fleet Intelligence Tools (8 tools)
    analyzePluginUsage: PluginAnalysisResult!
    recommendUpdates: UpdateRecommendationsResult!
    predictIssues: IssuePredictionsResult!
    generateSiteReport(siteId: String!): SiteReportResult!
    comparePerformance(siteIds: [String!]!): PerformanceComparisonResult!
    suggestOptimizations(siteId: String!): OptimizationsResult!
    detectSecurityRisks: SecurityRisksResult!
    fleetHealthScore: HealthScoreResult!
  }

  # ... input types, result types ...
`;
```

```typescript
// src/main/graphql/resolvers.ts
import { ToolRegistry } from '../mcp/tool-registry';

export function createResolvers(registry: ToolRegistry, services: any) {
  return {
    Query: {
      ping: () => 'pong',
    },
    Mutation: {
      // Site Management
      listSites: async () => {
        return await registry.call('list_sites', {}, services);
      },
      startSite: async (_: any, args: { site: string }) => {
        return await registry.call('start_site', { site: args.site }, services);
      },
      // ... 69 more mutations ...
    },
  };
}
```

**✅ SOLVED: GraphQL Extension Pattern**

**How it works:**
1. Local runs a GraphQL server on `http://127.0.0.1:<port>/graphql` (default port 4000)
2. Addons register their schemas via `graphql.registerGraphQLService(serviceId, typeDefs, resolvers)`
3. Local's `GraphQLService` merges all addon schemas using `@graphql-tools/merge`
4. CLI reads connection info from Local's userData (`graphql-connection-info.json`)
5. CLI connects with `Authorization: Bearer <token>` header

**Implementation in Nexus AI:**

```typescript
// src/main/index.ts
import { typeDefs } from './graphql/schema';
import { createResolvers } from './graphql/resolvers';

export default function (context: any): void {
  const services = LocalMain.getServiceContainer().cradle as any;
  const { graphql, localLogger } = services;

  // Build services object for tool registry
  const nexusServices = buildNexusServices(services);

  // Register GraphQL schema
  const resolvers = createResolvers(registry, nexusServices);
  graphql.registerGraphQLService('nexus-ai', typeDefs, resolvers);
  localLogger.info('[Nexus AI] Registered GraphQL: 71 tools');

  // Start MCP server (runs separately)
  startMcpServer(nexusServices, localLogger);
}
```

**CLI Connection:**

```typescript
// src/cli/utils/graphql.ts
import { GraphQLClient } from 'graphql-request';
import fs from 'fs';
import path from 'path';
import os from 'os';

export function getClient(): GraphQLClient {
  // Read connection info from Local's userData
  const userDataPath = process.env.LOCAL_USER_DATA_PATH ||
    path.join(os.homedir(), 'Library', 'Application Support', 'Local');

  const connectionInfoPath = path.join(userDataPath, 'graphql-connection-info.json');

  if (!fs.existsSync(connectionInfoPath)) {
    throw new Error('Local is not running. Please start Local first.');
  }

  const connectionInfo = JSON.parse(fs.readFileSync(connectionInfoPath, 'utf8'));
  const { url, authToken } = connectionInfo;

  return new GraphQLClient(url, {
    headers: {
      'Authorization': `Bearer ${authToken}`,
    },
  });
}
```

**No additional investigation needed** - pattern is proven and documented!

---

### Phase 2: Create CLI Package

**Goal:** Create `nexus` CLI command that calls GraphQL mutations

**Location:** `src/cli/` (new directory)

**Files to Create:**

1. **`src/cli/index.ts`** - Main CLI entry point
2. **`src/cli/commands/sites.ts`** - Site management commands
3. **`src/cli/commands/wp.ts`** - WP-CLI commands
4. **`src/cli/commands/wpe.ts`** - WPE commands
5. **`src/cli/commands/content.ts`** - Content search commands
6. **`src/cli/commands/fleet.ts`** - Fleet commands
7. **`src/cli/utils/graphql.ts`** - GraphQL client helper
8. **`bin/nexus.js`** - CLI executable (shebang script)

**CLI Structure (Commander.js):**

```typescript
// src/cli/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { sitesCommand } from './commands/sites';
import { wpCommand } from './commands/wp';
import { wpeCommand } from './commands/wpe';
import { contentCommand } from './commands/content';
import { fleetCommand } from './commands/fleet';

const program = new Command();

program
  .name('nexus')
  .description('Nexus AI CLI - WordPress site management with AI superpowers')
  .version('1.0.0');

// Subcommands
program.addCommand(sitesCommand);
program.addCommand(wpCommand);
program.addCommand(wpeCommand);
program.addCommand(contentCommand);
program.addCommand(fleetCommand);

program.parse();
```

```typescript
// src/cli/commands/sites.ts
import { Command } from 'commander';
import { gql } from 'graphql-request';
import { getClient } from '../utils/graphql';

export const sitesCommand = new Command('sites')
  .description('Manage Local sites');

// nexus sites list
sitesCommand
  .command('list')
  .description('List all sites')
  .action(async () => {
    const client = getClient();
    const result = await client.request(gql`
      mutation {
        listSites {
          sites {
            id
            name
            domain
            status
            wpVersion
          }
        }
      }
    `);
    console.table(result.listSites.sites);
  });

// nexus sites start <name>
sitesCommand
  .command('start <site>')
  .description('Start a site')
  .action(async (site: string) => {
    const client = getClient();
    const result = await client.request(gql`
      mutation StartSite($site: String!) {
        startSite(site: $site) {
          success
          message
        }
      }
    `, { site });
    console.log(result.startSite.message);
  });

// nexus sites stop <name>
sitesCommand
  .command('stop <site>')
  .description('Stop a site')
  .action(async (site: string) => {
    const client = getClient();
    const result = await client.request(gql`
      mutation StopSite($site: String!) {
        stopSite(site: $site) {
          success
          message
        }
      }
    `, { site });
    console.log(result.stopSite.message);
  });

// ... more commands ...
```

```typescript
// src/cli/commands/wp.ts
import { Command } from 'commander';
import { gql } from 'graphql-request';
import { getClient } from '../utils/graphql';

export const wpCommand = new Command('wp')
  .description('Run WP-CLI commands on sites');

// nexus wp <site> plugin list
wpCommand
  .command('plugin list <site>')
  .description('List plugins on a site')
  .action(async (site: string) => {
    const client = getClient();
    const result = await client.request(gql`
      mutation WpPluginList($siteId: String!) {
        wpPluginList(siteId: $siteId) {
          plugins {
            name
            status
            version
          }
        }
      }
    `, { siteId: site });
    console.table(result.wpPluginList.plugins);
  });

// nexus wp <site> plugin activate <slug>
wpCommand
  .command('plugin activate <site> <slug>')
  .description('Activate a plugin')
  .action(async (site: string, slug: string) => {
    const client = getClient();
    const result = await client.request(gql`
      mutation WpPluginActivate($siteId: String!, $slug: String!) {
        wpPluginActivate(siteId: $siteId, slug: $slug) {
          success
          message
        }
      }
    `, { siteId: site, slug });
    console.log(result.wpPluginActivate.message);
  });

// ... more commands ...
```

```typescript
// src/cli/utils/graphql.ts
import { GraphQLClient } from 'graphql-request';

export function getClient(): GraphQLClient {
  const endpoint = process.env.LOCAL_GRAPHQL_ENDPOINT || 'graphql://localhost:50450/graphql';
  const token = process.env.LOCAL_GRAPHQL_TOKEN || '';

  return new GraphQLClient(endpoint, {
    headers: {
      'X-Local-Token': token,
    },
  });
}
```

```javascript
// bin/nexus.js
#!/usr/bin/env node
require('../lib/cli/index.js');
```

**package.json changes:**

```json
{
  "bin": {
    "nexus": "./bin/nexus.js"
  },
  "dependencies": {
    "commander": "^11.1.0",
    "graphql-request": "^6.1.0",
    "graphql": "^16.8.1"
  }
}
```

---

### Phase 3: Example Commands

**After implementation, users can run:**

```bash
# Site management
nexus sites list
nexus sites start my-site
nexus sites stop my-site
nexus sites create new-site
nexus sites clone my-site my-site-copy

# WP-CLI
nexus wp my-site plugin list
nexus wp my-site plugin activate akismet
nexus wp my-site core version
nexus wp my-site user list

# WPE
nexus wpe accounts
nexus wpe installs
nexus wpe pull my-site staging
nexus wpe push my-site production --db

# Content search
nexus content search "homepage design"
nexus content indexed

# Fleet
nexus fleet summary
nexus fleet outdated
nexus fleet plugin-usage akismet
nexus fleet drift
```

**With AI:**

```bash
# Claude can use CLI via shell tool
User: "Activate Yoast on all my sites"
Claude: [calls nexus sites list, then nexus wp <site> plugin activate wordpress-seo for each]

User: "Which sites are outdated?"
Claude: [calls nexus fleet outdated]

User: "Pull my staging site to local"
Claude: [calls nexus wpe pull my-site staging]
```

---

## Effort Breakdown

### Day 1: GraphQL Mutations (Site Management + WP-CLI)
**Files:**
- `src/main/graphql/schema.ts` (create)
- `src/main/graphql/resolvers.ts` (create)
- `src/main/index.ts` (modify - register GraphQL with Local)

**Tasks:**
1. Research Local's GraphQL extension API
2. Create GraphQL schema for 27 tools (11 site mgmt + 16 WP-CLI)
3. Create resolvers that call ToolRegistry
4. Test with GraphQL playground

**Deliverable:** Working GraphQL mutations for site management and WP-CLI

---

### Day 2: GraphQL Mutations (WPE + Content + Fleet + Composite + Connectors + Intelligence)
**Files:**
- `src/main/graphql/schema.ts` (extend)
- `src/main/graphql/resolvers.ts` (extend)

**Tasks:**
1. Add schema for remaining 44 tools:
   - WPE: 9 tools
   - Content: 2 tools
   - Site Context: 4 tools
   - Ollama: 2 tools
   - Fleet: 6 tools
   - Composite: 2 tools
   - WP Connector: 11 tools
   - Fleet Intelligence: 8 tools
2. Create resolvers for all
3. Test with GraphQL playground

**Deliverable:** Complete GraphQL API for all 71 tools

---

### Day 3: CLI Package (Core + Sites + WP)
**Files:**
- `src/cli/index.ts` (create)
- `src/cli/commands/sites.ts` (create)
- `src/cli/commands/wp.ts` (create)
- `src/cli/utils/graphql.ts` (create)
- `bin/nexus.js` (create)
- `package.json` (modify - add bin field)

**Tasks:**
1. Setup Commander.js structure
2. Implement sites commands (list, start, stop, create, clone, delete)
3. Implement wp commands (plugin list/activate/deactivate, core version, user list)
4. Create GraphQL client helper
5. Test CLI locally with `node bin/nexus.js`

**Deliverable:** Working CLI for core commands

---

### Day 4: CLI Commands (WPE + Content + Fleet)
**Files:**
- `src/cli/commands/wpe.ts` (create)
- `src/cli/commands/content.ts` (create)
- `src/cli/commands/fleet.ts` (create)

**Tasks:**
1. Implement wpe commands (accounts, installs, pull, push, backup, cache)
2. Implement content commands (search, indexed)
3. Implement fleet commands (summary, outdated, plugin usage, drift)
4. Add pretty formatting (tables, colors)
5. Add progress indicators for long operations

**Deliverable:** Full CLI with all commands

---

### Day 5: Testing, Docs, Polish
**Files:**
- `README.md` (update)
- `docs/CLI_USAGE.md` (create)
- `src/cli/commands/*.ts` (polish)

**Tasks:**
1. Write CLI usage guide
2. Add `--help` text for all commands
3. Add error handling (GraphQL errors, network errors)
4. Add `--json` flag for machine-readable output
5. Test end-to-end workflows
6. Update README with CLI examples

**Deliverable:** Production-ready CLI

---

## Open Questions

### ✅ ANSWERED: GraphQL Integration

**Question 1:** How does Local expose GraphQL extension API?
**Answer:** `graphql.registerGraphQLService(serviceId, typeDefs, resolvers)` - documented in reference implementation.

**Question 2:** Where should GraphQL token come from?
**Answer:** Read from `~/Library/Application Support/Local/graphql-connection-info.json` (auto-detect).

**Question 3:** Should CLI work without Local running?
**Answer:** No - CLI requires Local running. Show error: "Local is not running. Please start Local first."

---

### 🤔 Remaining Questions

### 1. Should we publish CLI to npm?

**Options:**
- A. Users install globally: `npm install -g @nexus-ai/cli`
- B. Users use via addon: `npm link` in addon directory
- C. Bundle CLI with addon, add to PATH on install

**Recommendation:** Option B for MVP, Option A for production

### 2. CLI Command Structure

**Option A: Flat commands (simple)**
```bash
nexus sites-list
nexus sites-start my-site
nexus wp-plugin-list my-site
nexus wpe-pull my-site staging
```

**Option B: Nested commands (organized)**
```bash
nexus sites list
nexus sites start my-site
nexus wp my-site plugin list
nexus wpe pull my-site staging
```

**Recommendation:** Option B (matches reference, better organization)

### 3. How to handle async operations?

GraphQL mutations return immediately, but some operations (clone, pull, push) take minutes.

**Options:**
- A. CLI polls mutation result until complete
- B. CLI shows progress bar with status updates
- C. CLI returns job ID, user checks status with `nexus status <job-id>`

**Recommendation:** Option A for MVP (simple), Option B for production

---

## Success Metrics

**Before:** 71 MCP tools, usable only by Claude via MCP
**After:** 71 MCP tools + 71 CLI commands, usable by humans AND AI

**User Value:**
- Developers can use CLI for quick tasks without opening Claude
- AI can use CLI commands via shell tool (alternative to MCP)
- Scripts/automation can call CLI (e.g., CI/CD pipelines)
- Power users get both worlds: MCP for chat, CLI for terminal

**Example Workflows:**

1. **Developer workflow:**
   ```bash
   nexus sites list
   nexus sites start my-site
   nexus wp my-site plugin list
   nexus wp my-site plugin update --all
   ```

2. **AI workflow (via Claude shell tool):**
   ```
   User: "Start all my sites"
   Claude: [calls `nexus sites list` → parses → calls `nexus sites start <name>` for each]
   ```

3. **CI/CD workflow:**
   ```bash
   # In GitHub Actions
   - name: Deploy to WPE
     run: |
       nexus wpe push my-site production --db
       nexus wpe purge-cache production
   ```

---

## Next Steps

1. **Investigate Local's GraphQL API** (30 min)
   - Examine `/Users/jeremy.pollock/development/wpengine/flywheel-local`
   - Find GraphQL schema extension hooks
   - Document how addons register mutations

2. **Create POC** (2 hours)
   - Implement 3 GraphQL mutations (listSites, startSite, stopSite)
   - Create minimal CLI with 3 commands
   - Test end-to-end
   - Validate architecture decisions

3. **Execute Plan** (3-5 days)
   - Follow day-by-day plan above
   - Create PR for each phase
   - Test incrementally

4. **Document** (1 day)
   - Write CLI usage guide
   - Update README
   - Create screencasts/demos

---

## Alternative: Skip GraphQL, Use MCP Directly

**Crazy Idea:** What if CLI called MCP server instead of GraphQL?

**Architecture:**
```
nexus CLI → HTTP POST to MCP server → MCP tool → Result → CLI
```

**Pros:**
- No GraphQL layer needed
- Simpler (one interface, not two)
- CLI and Claude Code use same server

**Cons:**
- MCP is meant for AI, not humans
- MCP requires bearer token auth
- MCP uses JSON-RPC 2.0 (more complex than GraphQL)
- Doesn't match reference pattern

**Verdict:** Interesting but not recommended. GraphQL is better UX for CLI.

---

## Conclusion

**✅ Architecture Validated:**
- Local provides GraphQL service that addons can extend via `registerGraphQLService()`
- Reference implementation (`local-addon-cli-mcp`) proves this pattern works
- No need for separate GraphQL server or monorepo restructure
- CLI reads connection info from Local's userData and connects with Bearer token

**The Plan:**
1. Create GraphQL schema (`src/main/graphql/schema.ts`) - 71 mutations mirroring MCP tools
2. Create resolvers (`src/main/graphql/resolvers.ts`) - call ToolRegistry for each mutation
3. Register schema in `src/main/index.ts` via `graphql.registerGraphQLService()`
4. Create CLI package (`src/cli/`) with Commander.js structure
5. Implement GraphQL client helper that reads Local's connection info
6. Build CLI commands for all 71 tools
7. Test end-to-end
8. Ship

**Effort:** 3-5 days for MVP
**Value:** Developers get CLI, AI gets more options, power users get both worlds

**Philosophy:**
- **MCP** is for AI conversations (rich context, tool composition, semantic understanding)
- **CLI** is for humans (fast iteration, scripting, CI/CD, automation)
- **Both interfaces, one backend** - ToolRegistry powers everything
- **Maximum value** - Users choose their interface, capabilities are the same

---

## Summary of Key Findings

### What We Learned from Local Source Code

1. **GraphQL Service Architecture** (`app/main/graphql/GraphQLService.ts`):
   - Local runs ApolloServer with Express middleware on `http://127.0.0.1:<port>/graphql`
   - Uses Bearer token auth (read from `Authorization` header)
   - Stores connection info in userData: `graphql-connection-info.json`
   - Merges schemas from all addons using `@graphql-tools/merge`

2. **Addon Extension Pattern**:
   - Addons get `graphql` service from service container
   - Call `graphql.registerGraphQLService(serviceId, typeDefs, resolvers)`
   - Local merges addon schema with root schema
   - All mutations available at `/graphql` endpoint

3. **Reference Implementation Pattern** (`local-addon-cli-mcp`):
   - Addon registers GraphQL mutations for site management + WP-CLI
   - CLI package uses `graphql-request` to call mutations
   - Connection info read from userData JSON file
   - Bearer token included in request headers
   - Works seamlessly with Local's security model

### What This Means for Nexus AI

**No blockers!** Everything we need is already provided by Local:
- ✅ GraphQL server (no new port needed)
- ✅ Auth system (Bearer tokens)
- ✅ Schema merging (supports multiple addons)
- ✅ Connection discovery (userData JSON)
- ✅ Proven pattern (reference implementation)

**Architecture is simple:**
1. Addon registers GraphQL schema → Local serves it
2. CLI reads connection info → Connects to Local
3. CLI calls mutations → Resolvers call ToolRegistry → Same backend as MCP

**No refactoring needed:**
- Keep current file structure
- Add `src/main/graphql/` for schema + resolvers
- Add `src/cli/` for CLI commands
- Update `src/main/index.ts` to register GraphQL
- Add `bin/nexus.js` for CLI entry point

---

## Next Steps (Prioritized)

### Immediate (Validate Pattern)
1. **Create POC** (2 hours)
   - Implement 3 GraphQL mutations (`listSites`, `startSite`, `stopSite`)
   - Create minimal CLI with 3 commands
   - Test: `nexus sites list`, `nexus sites start my-site`
   - Validate end-to-end flow

### Phase 1 (Core Infrastructure)
1. **GraphQL Schema** (4 hours)
   - Define all 71 mutations in `src/main/graphql/schema.ts`
   - Follow reference implementation patterns
   - Use proper input types and result types

2. **GraphQL Resolvers** (6 hours)
   - Implement resolvers in `src/main/graphql/resolvers.ts`
   - Each resolver calls `registry.call(toolName, args, services)`
   - Handle errors and return structured results

3. **Register with Local** (1 hour)
   - Update `src/main/index.ts` to call `registerGraphQLService()`
   - Test that schema appears in Local's GraphQL playground
   - Verify mutations are callable

### Phase 2 (CLI Package)
1. **CLI Structure** (2 hours)
   - Create `src/cli/index.ts` with Commander.js
   - Create `src/cli/utils/graphql.ts` client helper
   - Create empty command files

2. **Site Commands** (4 hours)
   - `nexus sites list`, `start`, `stop`, `create`, `clone`, `delete`
   - Pretty table formatting
   - Error handling

3. **WP Commands** (4 hours)
   - `nexus wp <site> plugin list/activate/deactivate/update`
   - `nexus wp <site> core version`
   - `nexus wp <site> user list`

4. **WPE Commands** (3 hours)
   - `nexus wpe accounts`, `installs`
   - `nexus wpe pull <site> <install>`
   - `nexus wpe push <site> <install>`

5. **Content Commands** (2 hours)
   - `nexus content search <query>`
   - `nexus content indexed`

6. **Fleet Commands** (2 hours)
   - `nexus fleet summary`, `outdated`, `drift`

### Phase 3 (Polish)
1. **Testing** (4 hours)
   - Test all 71 commands
   - Verify error messages
   - Check auth flow

2. **Documentation** (3 hours)
   - Write CLI usage guide
   - Add examples for each command
   - Document troubleshooting

3. **User Experience** (2 hours)
   - Add progress indicators
   - Improve error messages
   - Add `--json` flag for all commands

**Total Estimated Time:** 35-40 hours (4-5 days)

**First Action:** Create POC with 3 mutations to validate the pattern before building all 71.
