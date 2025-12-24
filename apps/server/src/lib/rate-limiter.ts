/**
 * In-memory rate limiter for authentication endpoints
 *
 * Provides brute-force protection by tracking failed attempts per IP address.
 * Blocks requests after exceeding the maximum number of failures within a time window.
 */

import type { Request, Response, NextFunction } from 'express';

interface AttemptRecord {
  count: number;
  firstAttempt: number;
  blockedUntil: number | null;
}

interface RateLimiterConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  blockDurationMs: 15 * 60 * 1000, // 15 minutes
};

/**
 * Rate limiter instance that tracks attempts by a key (typically IP address)
 */
export class RateLimiter {
  private attempts: Map<string, AttemptRecord> = new Map();
  private config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract client IP address from request
   * Handles proxied requests via X-Forwarded-For header
   */
  getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return forwardedIp.trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Check if a key is currently rate limited
   */
  isBlocked(key: string): boolean {
    const record = this.attempts.get(key);
    if (!record) return false;

    const now = Date.now();

    // Check if currently blocked
    if (record.blockedUntil && now < record.blockedUntil) {
      return true;
    }

    // Clear expired block
    if (record.blockedUntil && now >= record.blockedUntil) {
      this.attempts.delete(key);
      return false;
    }

    return false;
  }

  /**
   * Get remaining time until block expires (in milliseconds)
   */
  getBlockTimeRemaining(key: string): number {
    const record = this.attempts.get(key);
    if (!record?.blockedUntil) return 0;

    const remaining = record.blockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Record a failed authentication attempt
   * Returns true if the key is now blocked
   */
  recordFailure(key: string): boolean {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record) {
      this.attempts.set(key, {
        count: 1,
        firstAttempt: now,
        blockedUntil: null,
      });
      return false;
    }

    // If window has expired, reset the counter
    if (now - record.firstAttempt > this.config.windowMs) {
      this.attempts.set(key, {
        count: 1,
        firstAttempt: now,
        blockedUntil: null,
      });
      return false;
    }

    // Increment counter
    record.count += 1;

    // Check if should be blocked
    if (record.count >= this.config.maxAttempts) {
      record.blockedUntil = now + this.config.blockDurationMs;
      return true;
    }

    return false;
  }

  /**
   * Clear a key's record (e.g., on successful authentication)
   */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /**
   * Get the number of attempts remaining before block
   */
  getAttemptsRemaining(key: string): number {
    const record = this.attempts.get(key);
    if (!record) return this.config.maxAttempts;

    const now = Date.now();

    // If window expired, full attempts available
    if (now - record.firstAttempt > this.config.windowMs) {
      return this.config.maxAttempts;
    }

    return Math.max(0, this.config.maxAttempts - record.count);
  }

  /**
   * Clean up expired records to prevent memory leaks
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.attempts.forEach((record, key) => {
      // Mark for deletion if block has expired
      if (record.blockedUntil && now >= record.blockedUntil) {
        keysToDelete.push(key);
        return;
      }
      // Mark for deletion if window has expired and not blocked
      if (!record.blockedUntil && now - record.firstAttempt > this.config.windowMs) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.attempts.delete(key));
  }
}

// Shared rate limiter instances for authentication endpoints
export const apiKeyRateLimiter = new RateLimiter();
export const terminalAuthRateLimiter = new RateLimiter();

// Clean up expired records periodically (every 5 minutes)
setInterval(
  () => {
    apiKeyRateLimiter.cleanup();
    terminalAuthRateLimiter.cleanup();
  },
  5 * 60 * 1000
);

/**
 * Create rate limiting middleware for authentication endpoints
 * This middleware checks if the request is rate limited before processing
 */
export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = rateLimiter.getClientIp(req);

    if (rateLimiter.isBlocked(clientIp)) {
      const retryAfterMs = rateLimiter.getBlockTimeRemaining(clientIp);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        success: false,
        error: 'Too many failed authentication attempts. Please try again later.',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}
