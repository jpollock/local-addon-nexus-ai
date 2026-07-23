export interface CronTrigger {
  type: 'cron';
  expression: string;
}

export interface EventTrigger {
  type: 'event';
  pattern: string;
  filter?: Record<string, string>;
}

export interface StreamTrigger {
  type: 'stream';
  pattern: string;
}

export interface WebhookTrigger {
  type: 'webhook';
  path: string;
}

export type Trigger = CronTrigger | EventTrigger | StreamTrigger | WebhookTrigger;

export interface NexusEvent {
  id?: number;
  namespace: string;         // 'wp', 'wpe', 'local', 'webhook'
  type: string;              // 'post.published', 'deploy.completed', etc.
  key: string;               // `${namespace}:${type}` — derived field for matching
  siteId?: string;
  payload: Record<string, unknown>;
  createdAt: number;         // unix ms
}

export type AgentAutonomy = 'suggest' | 'ask' | 'auto';

export interface ToolProvider {
  invoke(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Register a sandbox site ID so wp_eval may target it. Call once after sandbox creation. */
  registerSandbox?(siteId: string): void;
}

export interface AgentStateHandle {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  scratch: Record<string, unknown>;
  // Cooldown helpers — new
  isCoolingDown(key: string, durationMs: number): boolean;
  setCooldown(key: string): void;
}

export interface AgentLogger {
  // Freeform — existing, keep
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  // Structured events — new
  finding(finding: Finding): void;
  action(action: AgentAction): void;
  phase(name: string, description?: string): void;
  siteStatus(site: string, status: 'running' | 'clean' | 'findings' | 'escalated' | 'error' | string): void;
}

export interface AIClient {
  run(prompt: string, opts?: { maxTurns?: number; model?: string }): Promise<string>;
  generateObject<T>(opts: {
    prompt: string;
    system?: string;
    schema: Record<string, unknown>;  // JSON Schema object describing T
    schemaName?: string;
    noTools?: boolean;
  }): Promise<T>;
}

export class AgentAILoopError extends Error {
  constructor(public readonly turns: number) {
    super(`Agent AI loop exceeded ${turns} turns without a final response`);
    this.name = 'AgentAILoopError';
  }
}

export interface AgentContext {
  trigger: Trigger;
  event?: NexusEvent;
  tools: ToolProvider;
  state: AgentStateHandle;
  ai: AIClient;
  log: AgentLogger;
  /** User's autonomy preference for this agent. 'ask' = wait before executing; 'auto' = execute freely; 'suggest' = report only. */
  autonomy: AgentAutonomy;
  /** OAuth credential access for this agent+site. Never exposes refresh tokens or OAuth internals. */
  credentials: AgentCredentials;
  /** Platform-managed SQLite databases scoped to this agent. */
  db: AgentDbHandle;
  /** True when the user explicitly requested a full (non-incremental) run from the Run Now modal. */
  fullRun: boolean;
}

export interface AgentDefinition {
  name: string;
  version: string;
  description?: string;
  triggers: Trigger[];
  tools?: string[];           // declared tool names; undefined/empty = no tool access
  model?: string;             // default: inherits from Nexus settings
  timeoutMs?: number;         // default: 300_000 (5 min)
  contributes?: AgentContributes;  // contributed tools for function/daemon dispatch
  /** OAuth credential declarations. Agent developers list what they need; the runtime handles everything else. */
  credentials?: import('../credentials/types').CredentialDeclaration[];
  run: (ctx: AgentContext) => Promise<Partial<AgentResult> | void>;
  onError?: (err: Error, ctx: AgentContext) => Promise<void>;
  /** When true, the Run Now modal shows an "Always do full run" toggle. */
  supportsFullRun?: boolean;
}

export interface AgentResult {
  agentName: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
  // Domain output — populated by agents that conform to SDK v1
  verdict?: 'clean' | 'findings' | 'escalated' | 'plan_ready' | 'error';
  findings?: Finding[];
  plan?: RemediationPlan;
  sites?: Record<string, { status: string; findings: Finding[]; plan?: RemediationPlan }>;
  /** Free-text report from the agent — rendered in RunDrawer completion section. */
  summary?: string;
  /** Absolute path to this run's log file. Stored in agent_runs for the Log chip. */
  logFile?: string;
}

// ─── Domain output types ──────────────────────────────────────────────────────

export interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category?: 'active-compromise' | 'pre-breach' | 'misconfiguration' | 'informational';
  title: string;
  description?: string;
  site?: string;
  evidence?: Record<string, unknown>;
  remediated?: boolean;
}

export interface RemediationStep {
  id: string;
  label: string;
  command: string;
  description?: string;
  tier: 1 | 2 | 3;
  requiresApproval: boolean;
  verificationResult?: 'ok' | 'failed' | 'skipped';
  verificationOutput?: string;
}

export interface RemediationPlan {
  site: string;
  sandbox?: string;
  verified: boolean;
  verdict: 'ready' | 'blocked';
  summary?: string;
  entryPoint?: string;
  blindSpots?: string[];
  attackerItems?: Array<{
    type: string; name: string; confidence: string; reasoning: string; action: string;
  }>;
  steps: RemediationStep[];
}

export interface AgentAction {
  label: string;
  command?: string;
  site?: string;
  result?: 'ok' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}

export type Unsubscribe = () => void;
export type EventHandler = (event: NexusEvent) => void | Promise<void>;

// ─── Credential types (re-exported for agent authors) ────────────────────────

export type { CredentialDeclaration } from '../credentials/types';
export type { AccessToken } from '../credentials/types';
export {
  NotConnectedError,
  RevokedError,
  ScopeInsufficientError,
  SafeStorageUnavailableError,
  TemporarilyUnavailableError,
} from '../credentials/types';

export interface AgentCredentials {
  /** Get a fresh access token. Never opens UI. Rejects with typed error if not connected. */
  getToken(provider: string): Promise<import('../credentials/types').AccessToken>;
  /** Cheap status check for tier-gating logic. */
  getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'>;
  /** Ask the SDK to surface the connect flow to the user. Returns immediately. */
  requestConnection(provider: string): Promise<void>;
  /** api_key credential extension — feature-detected at runtime. Not all credential backends implement this. */
  getSecret?(provider: string): Promise<Record<string, string>>;
  /** Signal to the platform that stored credentials for this provider are invalid.
   *  Marks the connection revoked in the credential store. Best-effort; never throws. */
  revokeCredential?(provider: string): Promise<void>;
}

export interface AgentStatement {
  run(...args: unknown[]): { changes: number };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

export interface AgentDatabase {
  prepare(sql: string): AgentStatement;
  exec(sql: string): void;
  pragma(pragma: string): unknown;
}

export interface AgentDbHandle {
  /** Open (or return cached) a SQLite database scoped to this agent.
   *  Platform resolves path to <agentsDir>/<agentName>/<name>.sqlite.
   *  Connection is cached — repeated calls return the same instance. */
  open(name: string): AgentDatabase;
}

// ─── Contributed-tool types (SDK v2) ─────────────────────────────────────────

export type ExecutionMode = 'function' | 'run' | 'daemon';

export type AgentToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type ContributedToolDefinition<TArgs = unknown> = {
  description: string;
  inputSchema?: Record<string, unknown>;
  executionMode?: ExecutionMode;
  /** Tier 2 = modifying (requires user acknowledgement); Tier 3 = destructive (requires confirmation token). Default: 1. */
  permissionTier?: 1 | 2 | 3;
  handler: (args: TArgs, ctx: AgentContext) => Promise<AgentToolResult>;
};

export type AgentContributes = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: Record<string, ContributedToolDefinition<any>>;
};
