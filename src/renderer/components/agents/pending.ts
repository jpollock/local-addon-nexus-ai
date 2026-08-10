// src/renderer/components/agents/pending.ts

import type { ActivityEvent } from './AgentStore';

/** Open inbox items per agent id, from GET_INBOX. */
export type PendingCounts = Record<string, number>;

export function pendingForAgent(counts: PendingCounts, agentId: string): number {
  return counts[agentId] ?? 0;
}

export function totalPending(counts: PendingCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

export function agentsWithPending(counts: PendingCounts): number {
  return Object.values(counts).filter(n => n > 0).length;
}

const REVIEW_STATUS = 'review' as const;

export function isReviewStatus(event: ActivityEvent): boolean {
  return event.status === REVIEW_STATUS;
}
