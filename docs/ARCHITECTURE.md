# Nexus AI Architecture

## Core Principle: Shared Business Logic, Interface-Specific Safety

MCP and CLI provide near 1:1 functionality because they both call the same tool handlers. Safety enforcement happens at the **interface layer**, not in the business logic.

## Architecture Diagram

```
┌─────────────────┐                    ┌──────────────────┐
│  MCP Server     │                    │  GraphQL/CLI     │
│  (Claude chat)  │                    │  (Human CLI)     │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │ MCP Safety Layer                    │ CLI Safety Layer
         │ • Tier 3 tokens                     │ • Tier 3 prompts (sync.ts)
         │ • Audit logging                     │ • Human-readable warnings
         │ • Rate limiting (future)            │
         │                                      │
         ├──────────────────┬───────────────────┤
         ▼                  ▼                   ▼
    ┌────────────────────────────────────────────┐
    │         Tool Registry (dumb router)        │
    │  • No safety enforcement                   │
    │  • Just route name → handler               │
    │  • Prerequisite checking only              │
    └───────────────────┬────────────────────────┘
                        │
                        ▼
    ┌────────────────────────────────────────────┐
    │      Tool Handlers (pure business logic)   │
    │  • local_wpe_push, local_wpe_pull, etc     │
    │  • Workflows (multi-step operations)       │
    │  • No confirmation logic                   │
    │  • No safety checks                        │
    └───────────────────┬────────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │ Local Services│
                └───────────────┘
```

## Component Responsibilities

### Tool Registry (`tool-registry.ts`)

**Role:** Dumb router

**Responsibilities:**
- Route tool name → handler
- Check prerequisites (availability)
- Execute handler
- Return result

**NOT responsible for:**
- ❌ Safety enforcement
- ❌ Confirmation tokens
- ❌ Audit logging

### MCP Safety Wrapper (`mcp-safety-wrapper.ts`)

**Role:** MCP-specific safety enforcement

**Responsibilities:**
- Tier 3 confirmation token flow (async, chat-friendly)
- Audit logging for all tool executions
- Rate limiting (future)

**Used by:**
- ✅ MCP Server (`McpServer.ts`)
- ✅ Chat Service (`ChatService.ts`) - but with UI approval instead of tokens

**NOT used by:**
- ❌ GraphQL resolvers
- ❌ CLI commands

### CLI Safety Layer

**Location:** Individual CLI command files (e.g., `cli/commands/sync.ts`)

**Responsibilities:**
- Terminal-based confirmation prompts (synchronous)
- Human-readable warnings
- Production environment checks

**Example:**
```typescript
if (options.db || options.dbOnly) {
  console.log(`⚠️  WARNING: This will overwrite the database on ${options.to}`);

  if (wpeTarget.environment === 'production') {
    console.log('⚠️⚠️⚠️  This is a PRODUCTION environment.');
  }

  const answer = await prompt('Type "yes" to confirm: ');
  if (answer !== 'yes') {
    process.exit(0);
  }
}
```

### GraphQL Resolvers (`graphql/resolvers.ts`)

**Role:** Internal API (no safety wrapper)

**Responsibilities:**
- Validate inputs
- Call tool registry directly
- Handle errors
- Return structured results

**Safety:** None - assumes caller (CLI) has already handled confirmations.

### Chat Service (`ChatService.ts`)

**Role:** UI-based chat interface

**Responsibilities:**
- Show UI approval prompts for Tier 3 tools
- Wait for user to approve/deny
- Call tool registry directly (no confirmation tokens)

**Safety:** UI-based approval flow, not token-based.

## Safety Tiers

### Tier 1 - Read-only
- Execute immediately
- No side effects
- Examples: `local_list_sites`, `wp_plugin_list`

### Tier 2 - Modifying
- Execute and audit-log
- Changes state but is recoverable
- Examples: `local_start_site`, `wp_plugin_install`, `local_wpe_pull`

### Tier 3 - Destructive
- Requires confirmation
- Not easily reversible
- Examples: `local_delete_site`, `local_wpe_push`

**Tier 3 enforcement:**
- **MCP:** Async confirmation token flow
- **CLI:** Sync terminal prompts
- **Chat UI:** Approval/deny buttons
- **GraphQL:** No enforcement (assumes CLI handled it)

## Data Flow Examples

### Example 1: CLI Push Operation

```
User: nexus sync push site@local --to=wpe:account/install@prod

CLI (sync.ts):
  1. Parse arguments
  2. Check if --db flag present
  3. If yes, show terminal prompt: "Type 'yes' to confirm"
  4. Wait for user input
  5. If confirmed, call GraphQL mutation

GraphQL (resolvers.ts):
  6. Validate inputs
  7. Call registry.call('local_wpe_push', args, services)

Tool Registry (tool-registry.ts):
  8. Find handler for 'local_wpe_push'
  9. Check prerequisites (site running, etc)
  10. Execute handler

Tool Handler (wpe-push.ts):
  11. Call Local's wpePush service
  12. Return success result

CLI (sync.ts):
  13. Display "Push queued successfully"
```

### Example 2: MCP Push Operation (via Claude chat)

```
Claude: "I'll push your local site to production"

MCP Server (McpServer.ts):
  1. Receive tools/call request
  2. Call safetyWrapper.callWithSafety('local_wpe_push', args, services)

MCP Safety Wrapper (mcp-safety-wrapper.ts):
  3. Check tool safety tier → Tier 3
  4. No _confirmationToken in args
  5. Generate confirmation token
  6. Return {requiresConfirmation: true, token: "abc123", ...}

Claude:
  7. Show confirmation message to user
  8. Ask user to confirm
  9. User confirms
  10. Claude calls tool again with _confirmationToken: "abc123"

MCP Safety Wrapper:
  11. Validate token
  12. Call registry.call('local_wpe_push', args, services)

Tool Registry:
  13. Route to handler (same as CLI example, steps 8-12)
```

### Example 3: Chat UI Push Operation

```
User: Types "push to production" in chat panel

Chat Service (ChatService.ts):
  1. LLM returns tool call: local_wpe_push
  2. Check safety tier → Tier 3
  3. Emit 'tool_call_approval_needed' event
  4. Show approval UI with warning message
  5. Wait for user to click Approve/Deny
  6. If approved, call registry.call('local_wpe_push', args, services)

Tool Registry:
  7. Route to handler (same as CLI example, steps 8-12)
```

## Why This Architecture?

### Problem with Previous Architecture

CLI and MCP had different safety needs but shared enforcement:

```
CLI → GraphQL → Tool Registry (enforces Tier 3 tokens) → Handler
                     ↑
                   BLOCKS CLI with token prompt
```

This forced us to downgrade `local_wpe_push` from Tier 3 to Tier 2 as a workaround.

### Solution: Separate Safety Layers

Each interface handles confirmations appropriately:

```
MCP → Safety Wrapper (tokens) → Registry → Handler
CLI → Terminal Prompts → GraphQL → Registry → Handler
```

### Benefits

1. **1:1 functionality** - Both interfaces call same handlers
2. **Workflows** - Multi-step operations work identically in both
3. **No duplication** - Business logic written once
4. **Proper safety** - Each interface uses appropriate confirmation UX
5. **Keep Tier 3** - Restore proper safety classification

## Adding New Tools

### 1. Write the Tool Handler

```typescript
// src/main/mcp/modules/example/my-tool.ts
export const myToolHandler: McpToolHandler = {
  definition: {
    name: 'my_tool',
    description: 'Does something',
    inputSchema: { /* ... */ },
    isAvailable: (services) => services.localServices !== null,
  },

  async execute(args, services) {
    // Pure business logic - no safety checks
    const result = await services.localServices.doSomething(args);
    return ok(JSON.stringify(result));
  },
};
```

### 2. Register the Handler

```typescript
// src/main/mcp/modules/example/index.ts
export function registerExampleTools(registry: ToolRegistry) {
  registry.register(myToolHandler);
}
```

### 3. Set Safety Tier

```typescript
// src/main/mcp/safety.ts
export const TIER_OVERRIDES: Record<string, SafetyTier> = {
  // ...
  my_tool: 2, // or 3 if destructive
};
```

### 4. Add CLI Command (if needed)

```typescript
// src/cli/commands/my-command.ts
myCommand
  .command('do-thing')
  .action(async (options) => {
    // CLI-level confirmation if Tier 3
    if (destructive) {
      const answer = await prompt('Type "yes" to confirm: ');
      if (answer !== 'yes') process.exit(0);
    }

    // Call GraphQL mutation
    const result = await client.mutate(`
      mutation {
        myMutation(input: $input) { success error }
      }
    `, { input: options });
  });
```

### 5. Add GraphQL Resolver (if needed)

```typescript
// src/main/graphql/resolvers.ts
myMutation: async (_parent, { input }) => {
  // Call registry directly (CLI already confirmed)
  const result = await registry.call('my_tool', input, services);

  if (result.isError) {
    return { success: false, error: result.content[0].text };
  }

  return { success: true };
}
```

## Testing Strategy

### Unit Tests
- Test tool handlers in isolation
- Mock Local services
- No safety wrapper needed

### Integration Tests
- Test MCP Server with safety wrapper
- Verify Tier 3 confirmation flow
- Test GraphQL resolvers calling registry

### E2E Tests
- Test CLI commands end-to-end
- Verify terminal prompts work
- Test actual Local service integration

## Future Enhancements

### Rate Limiting
Add to MCP Safety Wrapper:
```typescript
class McpSafetyWrapper {
  private rateLimiter = new RateLimiter();

  async callWithSafety(name, args, services) {
    // Check rate limits
    if (!this.rateLimiter.allow(name)) {
      return error('Rate limit exceeded');
    }
    // ...
  }
}
```

### Workflow Support
Add workflow tools that chain multiple operations:
```typescript
export const setupProductionSiteHandler: McpToolHandler = {
  async execute(args, services) {
    // Call multiple tools in sequence
    await registry.call('local_create_site', {...}, services);
    await registry.call('local_wpe_pull', {...}, services);
    await registry.call('wp_plugin_install', {...}, services);
    // ...
  }
};
```

Both MCP and CLI get workflows for free!
