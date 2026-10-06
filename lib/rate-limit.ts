/**
 * Small fixed-window rate limiter for the public Gemini proxy.
 *
 * State lives in process memory. On Vercel each warm function instance keeps
 * its own counters, so this is a best-effort brake against a single client
 * hammering the endpoint, not a global quota.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
}

export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, { count: number; windowStart: number }>();

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      // Drop expired windows so the map cannot grow without bound.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) {
          if (now - v.windowStart >= windowMs) hits.delete(k);
        }
      }

      const entry = hits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        hits.set(key, { count: 1, windowStart: now });
        return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
      }

      if (entry.count >= max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000));
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }

      entry.count += 1;
      return { allowed: true, remaining: max - entry.count, retryAfterSeconds: 0 };
    },
  };
}

/** Client identifier from proxy headers (Vercel sets x-forwarded-for), else the socket address. */
export function clientKey(headers: Record<string, string | string[] | undefined>, fallback = "unknown"): string {
  const raw = headers["x-forwarded-for"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const first = value?.split(",")[0]?.trim();
  return first || fallback;
}

/** Shared limits: 20 Gemini calls and 10 key checks per client per minute. */
export const geminiLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
export const verifyLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

export function rateLimitedBody(retryAfterSeconds: number) {
  return { error: `Too many requests. Wait ${retryAfterSeconds}s and try again.` };
}
