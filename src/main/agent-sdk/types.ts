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

export interface ToolProvider {
  invoke(name: string, args: Record<string, unknown>): Promise<unknown>;
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
  siteStatus(site: string, status: 'running' | 'clean' | 'findings' | 'escalated' | 'error'): void;
}

export interface AIClient {
  run(prompt: string, opts?: { maxTurns?: number; model?: string }): Promise<string>;
  generateObject<T>(opts: {
    prompt: string;
    system?: string;
    schema: Record<string, unknown>;  // JSON Schema object describing T
    schemaName?: string;
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
}

export interface AgentDefinition {
  name: string;
  version: string;
  description?: string;
  triggers: Trigger[];
  tools?: string[];           // declared tool names; undefined/empty = no tool access
  model?: string;             // default: inherits from Nexus settings
  timeoutMs?: number;         // default: 300_000 (5 min)
  run: (ctx: AgentContext) => Promise<void>;
  onError?: (err: Error, ctx: AgentContext) => Promise<void>;
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
