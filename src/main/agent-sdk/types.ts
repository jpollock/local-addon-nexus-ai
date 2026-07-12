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
}

export interface AgentLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

// Minimal AIClient interface — fulfilled by existing chat providers
export interface AIClient {
  complete(prompt: string): Promise<string>;
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
}

export type Unsubscribe = () => void;
export type EventHandler = (event: NexusEvent) => void | Promise<void>;
