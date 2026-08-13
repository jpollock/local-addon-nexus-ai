import {
  isOverBudget,
  SpendTracker,
  DailyBudgetGuard,
  BudgetExceededError,
} from '../../../src/main/budget/spendTracker';

function memStore() {
  const m: Record<string, unknown> = {};
  return { get: (k: string) => m[k] ?? null, set: (k: string, v: unknown) => { m[k] = v; }, _m: m };
}

describe('isOverBudget (T-BUDGETS)', () => {
  it('no budget set (undefined / 0 / negative) is never over', () => {
    expect(isOverBudget(9999, undefined)).toBe(false);
    expect(isOverBudget(9999, 0)).toBe(false);
    expect(isOverBudget(9999, -5)).toBe(false);
  });
  it('under budget is not over; at-or-over budget is over', () => {
    expect(isOverBudget(4.99, 5)).toBe(false);
    expect(isOverBudget(5, 5)).toBe(true);
    expect(isOverBudget(5.01, 5)).toBe(true);
  });
});

describe('SpendTracker (T-BUDGETS)', () => {
  it('accumulates spend within the same local day', () => {
    const s = memStore();
    const t = new SpendTracker(s, () => '2026-08-13');
    t.record(1.25);
    t.record(0.75);
    expect(t.spentTodayUsd()).toBe(2);
  });

  it('rolls over at local midnight — a prior day reads as 0', () => {
    const s = memStore();
    let day = '2026-08-13';
    const t = new SpendTracker(s, () => day);
    t.record(3);
    expect(t.spentTodayUsd()).toBe(3);
    day = '2026-08-14';
    expect(t.spentTodayUsd()).toBe(0); // yesterday's total does not carry over
    t.record(1);
    expect(t.spentTodayUsd()).toBe(1);
  });

  it('ignores zero/negative/undefined records', () => {
    const s = memStore();
    const t = new SpendTracker(s, () => '2026-08-13');
    t.record(0);
    t.record(-1);
    t.record(undefined);
    expect(t.spentTodayUsd()).toBe(0);
  });

  it('isOver reflects today\'s spend against the budget', () => {
    const s = memStore();
    const t = new SpendTracker(s, () => '2026-08-13');
    t.record(4);
    expect(t.isOver(5)).toBe(false);
    t.record(1);
    expect(t.isOver(5)).toBe(true);
    expect(t.isOver(undefined)).toBe(false); // no budget → never over
  });
});

describe('DailyBudgetGuard (T-BUDGETS)', () => {
  it('does not throw while under budget, and records cost', () => {
    const s = memStore();
    const tracker = new SpendTracker(s, () => '2026-08-13');
    const guard = new DailyBudgetGuard(tracker, () => 5);
    expect(() => guard.assertWithinBudget()).not.toThrow();
    guard.record(4.5);
    expect(() => guard.assertWithinBudget()).not.toThrow(); // 4.5 < 5
  });

  it('throws BudgetExceededError once the ceiling is reached', () => {
    const s = memStore();
    const tracker = new SpendTracker(s, () => '2026-08-13');
    const guard = new DailyBudgetGuard(tracker, () => 5);
    guard.record(5);
    expect(() => guard.assertWithinBudget()).toThrow(BudgetExceededError);
    expect(() => guard.assertWithinBudget()).toThrow(/budget reached/i);
  });

  it('never throws when no budget is configured (opt-in, default off)', () => {
    const s = memStore();
    const tracker = new SpendTracker(s, () => '2026-08-13');
    const guard = new DailyBudgetGuard(tracker, () => undefined);
    guard.record(9999);
    expect(() => guard.assertWithinBudget()).not.toThrow();
  });
});
