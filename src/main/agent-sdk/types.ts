/**
 * The Agent SDK's public type surface.
 *
 * WP-59 added the one import in this file. It is `import type` and erases at
 * compile, so the SDK gains no runtime dependency on the intelligence layer —
 * an agent that never reads `ctx.contextBundle` is unaffected in every way.
 */
import type { ContextBundle } from '../../intelligence';

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
  /**
   * A change this agent made to a site, with what it changed from and to.
   *
   * Logging the intent ("ran wp plugin update") does not answer "what did it change?". The
   * before/after pair is what makes an unexpected modification auditable from the log alone.
   */
  mutation(m: { op: string; target: string; before?: string; after?: string; ok?: boolean }): void;
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
  /**
   * This agent's persisted settings, read-only, exactly as written by the agent settings panel.
   *
   * Use for agent-specific configuration the runtime has no reason to know about — scan scope,
   * thresholds, per-agent allowlists. `enabled` / `scheduleEnabled` / `eventsEnabled` /
   * `autonomy` are here too, but the runtime has already acted on the first three before `run`
   * is called and `autonomy` is surfaced above; do not re-implement gating from them.
   *
   * `{}` when nothing has been persisted. That is genuinely "unknown", not "default to on" —
   * treat a missing setting as the *safe* value, not the permissive one. A permissive fallback
   * on exactly this data is why security-sentinel swept the whole fleet every 15 minutes with
   * nothing configured.
   */
  settings: Readonly<Record<string, unknown>>;
  /** True when the user explicitly requested a full (non-incremental) run from the Run Now modal. */
  fullRun: boolean;
  /**
   * WP-57 · this run's identity ON THE LEDGER.
   *
   * Distinct from the log's run id and neither replaces the other: the log id
   * correlates LOG LINES (`grep run=<id>`), this correlates EVENTS
   * (`WHERE correlation = <id>`). Two records, two questions.
   *
   * Absent when the intelligence core was unavailable. An unframed run is
   * honest, not an error, and an agent must treat this as optional.
   */
  task?: { id: string; actor: { id: string; kind: 'agent' } };
  /**
   * WP-59 · what the intelligence layer knew about this run when it started.
   *
   * The same `ContextBundle` the chat surface gets, assembled for the agent as
   * its own actor. Until this packet, `assemble()` had exactly one caller and
   * every agent ran with nothing — the design note's §1.1 point in one field.
   *
   * **Nothing consumes it yet, and that is deliberate.** An agent hand-rolls
   * its prompt in `AgentAIClient`; feeding the bundle's prose into every one
   * of them is a real behaviour change with real token cost, and it wants
   * evidence rather than a default. This packet is additive: the bundle is
   * assembled, recorded, and offered. Reading it is opt-in per agent.
   *
   * Absent when the intelligence core was unavailable or assembly faulted —
   * an unassembled run is honest, and an agent must treat this as optional
   * exactly as it treats `task`.
   */
  contextBundle?: ContextBundle;
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
  /**
   * Whether this agent may ever be scoped to production sites. Default true (unrestricted).
   * Set false for an agent whose manifest declares it must never touch production — e.g. one
   * that runs destructive or exploratory operations unsuited to a live site. When false, the
   * site scope picker locks production rows (non-interactive, checkbox shows an em-dash) in
   * every placement — settings, Run Now, and any future bulk-actions menu — and the same rule
   * must be enforced wherever a scope is actually applied (CLI, MCP), not just in the picker UI;
   * the UI lock is a courtesy, not the boundary.
   */
  allowsProduction?: boolean;
  /**
   * What this agent does to the sites it runs on. Drives the production-warning verb in the
   * site scope picker ("N live production sites will be scanned" vs "...will be modified").
   * Default 'writes' — the conservative assumption for an agent that hasn't declared otherwise.
   * Must reflect what the agent's `run()` actually does; a 'readonly' agent that later gains a
   * remediation action must update this at the same time.
   */
  effect?: 'readonly' | 'writes';
  /**
   * Whether this agent ever creates review-status activity — a finding or action the user must
   * explicitly approve, dismiss, or act on. Default false: the safer failure mode is an agent
   * with something to show missing its Approvals tab (rare, quickly noticed) rather than every
   * agent getting a tab that's permanently empty (the status quo before this field existed).
   * This is a capability declaration, not a live prediction — an agent set to fully-autonomous
   * ('auto') might not actually pause for approval on a given run even with this true.
   */
  producesApprovals?: boolean;
  /**
   * Whether this agent produces a standalone report/artifact meant to be read on its own —
   * e.g. seo-insights' Site Content Report — as opposed to a terse pass/fail activity line.
   * Default false. Distinct from producesApprovals: a report needs no sign-off, just a place to
   * read it. Today reports are folded into AgentResult.summary on a regular activity entry, with
   * no dedicated browsing surface — a real "Reports" tab / artifact viewer is a separate,
   * deliberately deferred piece of work (see SDK_requirements.md's artifact-model item). This
   * field only distinguishes "this agent produces browsable reports" from "it doesn't" for
   * whenever that surface exists; it does not build the surface itself.
   */
  producesReports?: boolean;
  /**
   * Whether this agent's work is per-site. Default **true** — the conservative assumption,
   * matching `effect`'s default of 'writes'.
   *
   * Set false for an agent whose `run()` ignores site scope entirely: it reads neither the site
   * on `ctx.event` nor `settings.scope.siteIds`, and does the same thing regardless of which
   * sites are selected. `auth-probe` is the worked example — a fleet-wide auth diagnostic making
   * three fixed calls, for which the picker offered 404 sites and Run Now would have fired 166
   * identical runs.
   *
   * When false: no surface offers a site picker, and Run Now performs exactly ONE run with no
   * scoped event. Declaring false while actually reading a site from `ctx.event` means the agent
   * silently receives `undefined` — the declaration must match what `run()` does.
   */
  siteScoped?: boolean;
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
  /** Absolute path to this run's report file (AgentResult.summary written to disk). */
  reportFile?: string;
  /** Correlation id for this run — brackets every line this run produced with run.start/run.end. */
  runId?: string;
  /**
   * WP-57 · this run's identity ON THE LEDGER — the `correlation` every event
   * the run produced carries, so `WHERE correlation = <taskId>` returns the
   * assembly, every gated act, every outcome and the findings as one thread.
   *
   * Deliberately NOT the same value as `runId`, and neither replaces the
   * other: `runId` correlates LOG LINES (`grep run=<id>`, a documented
   * workflow), this correlates EVENTS. Two records, two questions.
   *
   * Absent when the intelligence core was unavailable — an unframed run is
   * honest, not an error.
   */
  taskId?: string;
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
  /**
   * Multiple connected accounts (2026-08-26) — feature-detected like getSecret:
   * the accounts this agent was granted, and a token pinned to a named one.
   * `getToken` remains the single-account path (the first grant) so agents
   * that never enumerate keep working unchanged.
   */
  listConnections?(provider: string): Promise<Array<{ connectionId: string; accountLabel: string; status: string }>>;
  getTokenFor?(provider: string, connectionId: string): Promise<import('../credentials/types').AccessToken>;
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
