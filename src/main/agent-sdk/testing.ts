/**
 * Agent SDK testing helpers.
 *
 * mockContext() — build a minimal AgentContext backed by in-memory mocks so agent
 *                 tool handlers can be unit-tested without spinning up Local.
 *
 * testTool()    — invoke a single contributed tool handler by name from a definition.
 */
import { NotConnectedError } from '../credentials/types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
import type {
  AgentDefinition,
  AgentContext,
  AgentToolResult,
  NexusEvent,
  ToolProvider,
  AIClient,
  AgentStateHandle,
  AgentLogger,
  AgentAutonomy,
  Trigger,
  Finding,
  AgentAction,
  AgentDbHandle,
  AgentDatabase,
} from './types'

type ToolMocks = Record<string, (args: unknown) => Promise<unknown>>

type MockContextOverrides = {
  /** Per-tool mock functions — keyed by tool name. */
  tools?: ToolMocks
  /** Synthetic event to set on the context (null = no event). */
  event?: NexusEvent | null
  /** Autonomy level (default: 'auto'). */
  autonomy?: AgentAutonomy
  /** Trigger to use (default: a synthetic cron trigger). */
  trigger?: Trigger
  /** Whether this is a full (non-incremental) run (default: false). */
  fullRun?: boolean
  /**
   * The agent's persisted settings (default: {}).
   *
   * The default is empty on purpose. An agent must behave safely when nothing is configured —
   * that is precisely the state a test should exercise, and defaulting to a populated object
   * would hide the case that matters.
   */
  settings?: Record<string, unknown>
}

function makeMockToolProvider(mocks: ToolMocks = {}): ToolProvider {
  return {
    invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
      const fn = mocks[name]
      if (!fn) throw new Error(`Mock: tool '${name}' not configured — pass it in mockContext({ tools: { ${name}: jest.fn() } })`)
      return fn(args)
    },
  }
}

function makeMockAIClient(): AIClient {
  return {
    async run(_prompt: string): Promise<string> {
      return 'mock AI response'
    },
    async generateObject<T>(_opts: {
      prompt: string
      system?: string
      schema: Record<string, unknown>
      schemaName?: string
      noTools?: boolean
    }): Promise<T> {
      return {} as T
    },
  }
}

function makeMockStateStore(): AgentStateHandle {
  const store = new Map<string, unknown>()
  const cooldownExpiry = new Map<string, number>()
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined
    },
    set(key: string, value: unknown): void {
      store.set(key, value)
    },
    delete(key: string): void {
      store.delete(key)
    },
    scratch: {},
    isCoolingDown(key: string, durationMs: number): boolean {
      const exp = cooldownExpiry.get(key)
      if (exp === undefined) return false
      if (Date.now() < exp) return true
      cooldownExpiry.delete(key)
      // Reset the expiry on first check after cooling — callers pass durationMs on each check
      void durationMs
      return false
    },
    setCooldown(key: string): void {
      // durationMs is not part of the signature in the current interface — just mark as cooling
      cooldownExpiry.set(key, Date.now() + 60_000)
    },
  }
}

function makeMockLogger(): AgentLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    finding: (_f: Finding) => {},
    action: (_a: AgentAction) => {},
    phase: (_name: string, _description?: string) => {},
    siteStatus: (_site: string, _status: 'running' | 'clean' | 'findings' | 'escalated' | 'error') => {},
    mutation: (_m: { op: string; target: string; before?: string; after?: string; ok?: boolean }) => {},
  }
}

const DEFAULT_TRIGGER: Trigger = { type: 'cron', expression: '0 * * * *' }

function makeMockDbHandle(): AgentDbHandle {
  const dbs = new Map<string, InstanceType<typeof BetterSqlite3>>();
  return {
    open(name: string): AgentDatabase {
      if (!dbs.has(name)) {
        const db = new BetterSqlite3(':memory:');
        db.pragma('journal_mode = WAL');
        dbs.set(name, db);
      }
      return dbs.get(name)! as unknown as AgentDatabase;
    },
  };
}

/**
 * Build an AgentContext backed entirely by in-memory mocks.
 *
 * @example
 * const ctx = mockContext({ tools: { nexus_list_sites: async () => [] } })
 * await myAgent.run(ctx)
 */
export function mockContext(overrides: MockContextOverrides = {}): AgentContext {
  return {
    trigger: overrides.trigger ?? DEFAULT_TRIGGER,
    event: overrides.event !== undefined ? (overrides.event ?? undefined) : undefined,
    tools: makeMockToolProvider(overrides.tools),
    ai: makeMockAIClient(),
    state: makeMockStateStore(),
    log: makeMockLogger(),
    autonomy: overrides.autonomy ?? 'auto',
    settings: overrides.settings ?? {},
    credentials: {
      getToken: async (provider: string) => { throw new NotConnectedError(provider); },
      getStatus: async () => 'not_connected' as const,
      requestConnection: async () => {},
      // getSecret intentionally absent — tests that exercise the connected path must provide a mock
    },
    db: makeMockDbHandle(),
    fullRun: overrides.fullRun ?? false,
  }
}

/**
 * Invoke a single contributed tool handler by name from an AgentDefinition.
 *
 * @example
 * const result = await testTool(myAgent, 'my_tool', { siteId: 'abc' }, ctx)
 * expect(result.isError).toBe(false)
 */
export async function testTool(
  def: AgentDefinition,
  toolName: string,
  args: unknown,
  ctx: AgentContext,
): Promise<AgentToolResult> {
  const tools = def.contributes?.tools
  if (!tools) throw new Error(`Agent '${def.name}' has no contributes.tools`)
  const tool = tools[toolName]
  if (!tool) throw new Error(`Tool '${toolName}' not found in agent '${def.name}' contributes.tools`)
  return tool.handler(args, ctx)
}
