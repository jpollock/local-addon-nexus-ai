import type {
  AgentDefinition, CronTrigger, EventTrigger,
  StreamTrigger, WebhookTrigger,
} from './types';

export function defineAgent(def: AgentDefinition): AgentDefinition {
  if (!def.name || def.name.trim() === '') throw new Error('Agent name is required');
  if (!def.triggers || def.triggers.length === 0) throw new Error('Agent must have at least one trigger');
  return def;
}

export function cron(expression: string): CronTrigger {
  return { type: 'cron', expression };
}

export function on(pattern: string, filter?: Record<string, string>): EventTrigger {
  return { type: 'event', pattern, filter };
}

export function stream(pattern: string): StreamTrigger {
  return { type: 'stream', pattern };
}

export function webhook(path: string): WebhookTrigger {
  return { type: 'webhook', path };
}
