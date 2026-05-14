// CommonJS shim for p-limit v6+ (ESM-only) — for Jest test environments.
// Returns a limiter that calls through immediately with no concurrency cap.
// Behaviour is identical for sequential tests; real concurrency is enforced at runtime.
module.exports = function pLimit(_concurrency) {
  const limit = function (fn) {
    return fn();
  };
  limit.activeCount = 0;
  limit.pendingCount = 0;
  limit.clearQueue = function () {};
  return limit;
};
