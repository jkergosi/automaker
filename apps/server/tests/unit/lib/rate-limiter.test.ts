import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../../src/lib/rate-limiter.js';
import type { Request } from 'express';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxAttempts: 3,
      windowMs: 60000, // 1 minute
      blockDurationMs: 60000, // 1 minute
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getClientIp', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const req = {
        headers: { 'x-forwarded-for': '192.168.1.100' },
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;

      expect(rateLimiter.getClientIp(req)).toBe('192.168.1.100');
    });

    it('should use first IP from x-forwarded-for with multiple IPs', () => {
      const req = {
        headers: { 'x-forwarded-for': '192.168.1.100, 10.0.0.1, 172.16.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;

      expect(rateLimiter.getClientIp(req)).toBe('192.168.1.100');
    });

    it('should fall back to socket remoteAddress when no x-forwarded-for', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;

      expect(rateLimiter.getClientIp(req)).toBe('127.0.0.1');
    });

    it('should return "unknown" when no IP can be determined', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: undefined },
      } as unknown as Request;

      expect(rateLimiter.getClientIp(req)).toBe('unknown');
    });
  });

  describe('isBlocked', () => {
    it('should return false for unknown keys', () => {
      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(false);
    });

    it('should return false after recording fewer failures than max', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(false);
    });

    it('should return true after reaching max failures', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(true);
    });

    it('should return false after block expires', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(true);

      // Advance time past block duration
      vi.advanceTimersByTime(60001);

      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(false);
    });
  });

  describe('recordFailure', () => {
    it('should return false when not yet blocked', () => {
      expect(rateLimiter.recordFailure('192.168.1.1')).toBe(false);
      expect(rateLimiter.recordFailure('192.168.1.1')).toBe(false);
    });

    it('should return true when threshold is reached', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      expect(rateLimiter.recordFailure('192.168.1.1')).toBe(true);
    });

    it('should reset counter after window expires', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      // Advance time past window
      vi.advanceTimersByTime(60001);

      // Should start fresh
      expect(rateLimiter.recordFailure('192.168.1.1')).toBe(false);
      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(2);
    });

    it('should track different IPs independently', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      rateLimiter.recordFailure('192.168.1.2');

      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(true);
      expect(rateLimiter.isBlocked('192.168.1.2')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear record for a key', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      rateLimiter.reset('192.168.1.1');

      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(3);
    });

    it('should clear blocked status', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(true);

      rateLimiter.reset('192.168.1.1');

      expect(rateLimiter.isBlocked('192.168.1.1')).toBe(false);
    });
  });

  describe('getAttemptsRemaining', () => {
    it('should return max attempts for unknown key', () => {
      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(3);
    });

    it('should decrease as failures are recorded', () => {
      rateLimiter.recordFailure('192.168.1.1');
      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(2);

      rateLimiter.recordFailure('192.168.1.1');
      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(1);

      rateLimiter.recordFailure('192.168.1.1');
      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(0);
    });

    it('should return max attempts after window expires', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      vi.advanceTimersByTime(60001);

      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(3);
    });
  });

  describe('getBlockTimeRemaining', () => {
    it('should return 0 for non-blocked key', () => {
      expect(rateLimiter.getBlockTimeRemaining('192.168.1.1')).toBe(0);
    });

    it('should return remaining block time for blocked key', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      vi.advanceTimersByTime(30000); // Advance 30 seconds

      const remaining = rateLimiter.getBlockTimeRemaining('192.168.1.1');
      expect(remaining).toBeGreaterThan(29000);
      expect(remaining).toBeLessThanOrEqual(30000);
    });

    it('should return 0 after block expires', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      vi.advanceTimersByTime(60001);

      expect(rateLimiter.getBlockTimeRemaining('192.168.1.1')).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove expired blocks', () => {
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');
      rateLimiter.recordFailure('192.168.1.1');

      vi.advanceTimersByTime(60001);

      rateLimiter.cleanup();

      // After cleanup, the record should be gone
      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(3);
    });

    it('should remove expired windows', () => {
      rateLimiter.recordFailure('192.168.1.1');

      vi.advanceTimersByTime(60001);

      rateLimiter.cleanup();

      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(3);
    });

    it('should preserve active records', () => {
      rateLimiter.recordFailure('192.168.1.1');

      vi.advanceTimersByTime(30000); // Half the window

      rateLimiter.cleanup();

      expect(rateLimiter.getAttemptsRemaining('192.168.1.1')).toBe(2);
    });
  });

  describe('default configuration', () => {
    it('should use sensible defaults', () => {
      const defaultLimiter = new RateLimiter();

      // Should have 5 max attempts by default
      expect(defaultLimiter.getAttemptsRemaining('test')).toBe(5);
    });
  });
});
