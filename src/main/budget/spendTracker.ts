import { localDay } from '../logging/eventLog';

export interface DailySpend {
  day: string;
  usd: number;
}

const KEY = 'nexus_daily_spend';

/**
 * True when a positive budget is set and the running total has reached it. No budget (undefined /
 * 0 / negative) is never over — the ceiling is opt-in (T-BUDGETS, default off).
 */
export function isOverBudget(spentUsd: number, budgetUsd: number | undefined | null): boolean {
  if (typeof budgetUsd !== 'number' || budgetUsd <= 0) return false;
  return spentUsd >= budgetUsd;
}

interface KeyValueStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/**
 * Per-local-day LLM spend, persisted in registryStorage, behind the optional `dailyUsdBudget`
 * ceiling (T-BUDGETS / P1-7). The agent and chat LLM paths record each call's estimated cost and
 * refuse new calls once the day's total reaches the budget. Rolls over automatically at local
 * midnight: a stored record from a previous day reads as 0 (no carry-over), so a new day starts
 * fresh without a scheduled reset.
 */
export class SpendTracker {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly today: () => string = () => localDay(new Date()),
  ) {}

  spentTodayUsd(): number {
    const rec = this.storage.get(KEY) as DailySpend | null;
    if (!rec || rec.day !== this.today() || typeof rec.usd !== 'number') return 0;
    return rec.usd;
  }

  record(usd: number | undefined): void {
    if (typeof usd !== 'number' || usd <= 0) return;
    const day = this.today();
    const rec = this.storage.get(KEY) as DailySpend | null;
    const base = rec && rec.day === day && typeof rec.usd === 'number' ? rec.usd : 0;
    this.storage.set(KEY, { day, usd: base + usd } as DailySpend);
  }

  /** True when today's spend has reached the given budget. */
  isOver(budgetUsd: number | undefined | null): boolean {
    return isOverBudget(this.spentTodayUsd(), budgetUsd);
  }
}

/** Thrown by a guard when the day's ceiling has been reached — surfaced as the run/chat error. */
export class BudgetExceededError extends Error {
  constructor(public readonly spentUsd: number, public readonly budgetUsd: number) {
    super(
      `Daily LLM spend budget reached: $${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}. ` +
      `New model calls are paused until tomorrow. Raise or clear dailyUsdBudget in Nexus AI settings to continue.`,
    );
    this.name = 'BudgetExceededError';
  }
}

/** The seam AgentAIClient / ChatService use so they need not know about SpendTracker or settings. */
export interface BudgetGuard {
  /** Throw BudgetExceededError if today's spend has already reached the ceiling. */
  assertWithinBudget(): void;
  /** Record an estimated USD cost for a completed LLM call. */
  record(costUsd: number | undefined): void;
}

/** BudgetGuard backed by the per-day tracker and a live read of the dailyUsdBudget setting. */
export class DailyBudgetGuard implements BudgetGuard {
  constructor(
    private readonly tracker: SpendTracker,
    private readonly getBudgetUsd: () => number | undefined | null,
  ) {}

  assertWithinBudget(): void {
    const budget = this.getBudgetUsd();
    if (this.tracker.isOver(budget)) {
      throw new BudgetExceededError(this.tracker.spentTodayUsd(), Number(budget));
    }
  }

  record(costUsd: number | undefined): void {
    this.tracker.record(costUsd);
  }
}
