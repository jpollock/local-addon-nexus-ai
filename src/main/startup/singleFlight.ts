/**
 * Coalesce concurrent calls to an async operation into a single in-flight execution (P1-7).
 *
 * The refresh / content-index schedulers fire their cycle on a setInterval AND expose it publicly
 * (manual runs). The interval only guards start(); the cycle itself had no re-entrancy guard, so a
 * cycle that runs longer than the interval — a hung SSH, or a short interval set via restart() —
 * would re-enter and run two cycles against the same production hosts at once, doubling remote SSH
 * load (and racing on the same rows). A single-flight guard makes an overlapping call await the
 * running cycle and share its result instead of starting a second one; once it settles, the next
 * call runs fresh.
 */
export function makeSingleFlight<T>(): (fn: () => Promise<T>) => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return (fn) => {
    if (inFlight) return inFlight;
    // Promise.resolve().then(fn) so a synchronous throw in fn becomes a rejection that still
    // clears inFlight via finally, rather than escaping before the guard is armed.
    inFlight = Promise.resolve()
      .then(fn)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
