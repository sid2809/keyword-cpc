import "server-only";

/**
 * Brute-force protection for the single-user login.
 *
 * Measured before this existed: 74 password attempts per second, none blocked.
 *
 * The limiter is deliberately GLOBAL rather than per-IP. Behind Railway's proxy
 * the only client address available is `x-forwarded-for`, which the client can
 * set to anything, so a per-IP limit is bypassed by rotating that header. There
 * is exactly one legitimate user here, so locking globally is both safe and
 * unspoofable. The trade-off is that an attacker can lock the real user out for
 * the cooldown; that is why the cooldown is minutes, not hours, and why it
 * decays.
 *
 * State is in memory. A restart clears it, which is acceptable: an attacker
 * cannot restart the server, and the legitimate user restarting to unlock
 * themselves is a feature.
 */

const MAX_FAILURES = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 5 * 60_000;
/** Failures older than this are forgotten, so honest typos never accumulate. */
const DECAY_MS = 15 * 60_000;

type State = { failures: number; lockedUntil: number; lastAttempt: number; lockCount: number };

const globalForLimit = globalThis as unknown as { __kcpcLoginLimit?: State };

function state(): State {
  if (!globalForLimit.__kcpcLoginLimit) {
    globalForLimit.__kcpcLoginLimit = { failures: 0, lockedUntil: 0, lastAttempt: 0, lockCount: 0 };
  }
  return globalForLimit.__kcpcLoginLimit;
}

export type LockStatus = { locked: true; retryAfterSeconds: number } | { locked: false };

/** Call before checking the password. */
export function checkLoginAllowed(now = Date.now()): LockStatus {
  const s = state();
  if (now < s.lockedUntil) {
    return { locked: true, retryAfterSeconds: Math.ceil((s.lockedUntil - now) / 1000) };
  }
  // A quiet spell wipes the slate, so occasional typos never build to a lock.
  if (s.lastAttempt !== 0 && now - s.lastAttempt > DECAY_MS) {
    s.failures = 0;
    s.lockCount = 0;
  }
  return { locked: false };
}

/** Call after a wrong password. Returns the lock state that now applies. */
export function recordLoginFailure(now = Date.now()): LockStatus {
  const s = state();
  s.lastAttempt = now;
  s.failures += 1;

  if (s.failures >= MAX_FAILURES) {
    // Each successive lock is longer, capped so the real user is never shut
    // out for an unreasonable time.
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** s.lockCount, MAX_LOCK_MS);
    s.lockCount += 1;
    s.failures = 0;
    s.lockedUntil = now + lockMs;
    return { locked: true, retryAfterSeconds: Math.ceil(lockMs / 1000) };
  }
  return { locked: false };
}

/** Call after a correct password. */
export function recordLoginSuccess(): void {
  const s = state();
  s.failures = 0;
  s.lockedUntil = 0;
  s.lockCount = 0;
  s.lastAttempt = 0;
}

/** Test seam — resets the limiter without restarting the process. */
export function resetLoginLimiter(): void {
  globalForLimit.__kcpcLoginLimit = { failures: 0, lockedUntil: 0, lastAttempt: 0, lockCount: 0 };
}

export function describeLock(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}
