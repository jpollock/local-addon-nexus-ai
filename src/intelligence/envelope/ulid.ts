/**
 * Monotonic ULID (ADR-6): 48-bit ms timestamp + 80 bits randomness,
 * Crockford base32, lexicographically sortable. No external dependency.
 *
 * MONOTONIC within the process: ids minted in the same millisecond increment
 * the previous random component instead of re-randomizing. This is
 * load-bearing, not cosmetic — the fold workers break equal-observed_at ties
 * by ledger id order ("arrival order"), and with pure randomness two ids in
 * one millisecond sort in coin-flip order, which made that tie-break (and a
 * test) nondeterministic. Same-ms ids now sort in emission order, always.
 */
import { randomBytes } from 'crypto';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTimeMs = -1;
let lastRand: Buffer = Buffer.alloc(10);

export function ulid(timeMs: number = Date.now()): string {
  if (timeMs <= lastTimeMs) {
    // Same (or rewound) millisecond: increment the 80-bit tail, carry rippling
    // left. Overflow of all 80 bits in one ms is not a realistic concern.
    for (let i = lastRand.length - 1; i >= 0; i--) {
      if (lastRand[i] < 0xff) {
        lastRand[i]++;
        break;
      }
      lastRand[i] = 0;
    }
    timeMs = lastTimeMs; // a rewound clock must not produce a smaller id
  } else {
    lastTimeMs = timeMs;
    lastRand = randomBytes(10); // 80 bits
  }

  let t = timeMs;
  const time = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = B32[t % 32];
    t = Math.floor(t / 32);
  }
  let out = time.join('');
  // 80 bits -> 16 chars of 5 bits
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < lastRand.length; i++) {
    acc = (acc << 8) | lastRand[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(acc >> bits) & 31];
    }
  }
  return out; // 26 chars
}

export const eventId = (timeMs?: number): string => `evt_${ulid(timeMs)}`;
export const taskId = (timeMs?: number): string => `task_${ulid(timeMs)}`;
