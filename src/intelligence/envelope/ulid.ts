/**
 * Minimal ULID (ADR-6): 48-bit ms timestamp + 80 bits randomness,
 * Crockford base32, lexicographically sortable. No external dependency.
 */
import { randomBytes } from 'crypto';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(timeMs: number = Date.now()): string {
  let t = timeMs;
  const time = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = B32[t % 32];
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(10); // 80 bits
  let out = time.join('');
  // 80 bits -> 16 chars of 5 bits
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < rand.length; i++) {
    acc = (acc << 8) | rand[i];
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
