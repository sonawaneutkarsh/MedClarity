import { describe, expect, it } from 'vitest';
import { clientKey, createRateLimiter } from '../lib/rate-limit';

describe('createRateLimiter', () => {
  it('allows up to max requests per window, then blocks with Retry-After', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    const t0 = 1_000_000;
    expect(limiter.check('ip', t0).allowed).toBe(true);
    expect(limiter.check('ip', t0 + 1).allowed).toBe(true);
    expect(limiter.check('ip', t0 + 2).remaining).toBe(0);
    const blocked = limiter.check('ip', t0 + 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
  });

  it('starts a new window after windowMs', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check('ip', 0).allowed).toBe(true);
    expect(limiter.check('ip', 999).allowed).toBe(false);
    expect(limiter.check('ip', 1000).allowed).toBe(true);
  });

  it('tracks clients independently', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
  });
});

describe('clientKey', () => {
  it('uses the first x-forwarded-for address', () => {
    expect(clientKey({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe('203.0.113.7');
    expect(clientKey({ 'x-forwarded-for': ['198.51.100.2'] })).toBe('198.51.100.2');
  });

  it('falls back when the header is missing', () => {
    expect(clientKey({}, '127.0.0.1')).toBe('127.0.0.1');
  });
});
