/**
 * Authentication middleware for API security
 *
 * Supports API key authentication via header or environment variable.
 * Includes rate limiting to prevent brute-force attacks.
 */

import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { apiKeyRateLimiter } from './rate-limiter.js';

/**
 * Performs a constant-time string comparison to prevent timing attacks.
 * Uses crypto.timingSafeEqual with proper buffer handling.
 */
function secureCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // If lengths differ, we still need to do a constant-time comparison
  // to avoid leaking length information. We compare against bufferA twice.
  if (bufferA.length !== bufferB.length) {
    crypto.timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

// API key from environment (optional - if not set, auth is disabled)
const API_KEY = process.env.AUTOMAKER_API_KEY;

/**
 * Authentication middleware
 *
 * If AUTOMAKER_API_KEY is set, requires matching key in X-API-Key header.
 * If not set, allows all requests (development mode).
 * Includes rate limiting to prevent brute-force attacks.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // If no API key is configured, allow all requests
  if (!API_KEY) {
    next();
    return;
  }

  const clientIp = apiKeyRateLimiter.getClientIp(req);

  // Check if client is rate limited
  if (apiKeyRateLimiter.isBlocked(clientIp)) {
    const retryAfterMs = apiKeyRateLimiter.getBlockTimeRemaining(clientIp);
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      success: false,
      error: 'Too many failed authentication attempts. Please try again later.',
      retryAfter: retryAfterSeconds,
    });
    return;
  }

  // Check for API key in header
  const providedKey = req.headers['x-api-key'] as string | undefined;

  if (!providedKey) {
    res.status(401).json({
      success: false,
      error: 'Authentication required. Provide X-API-Key header.',
    });
    return;
  }

  if (!secureCompare(providedKey, API_KEY)) {
    // Record failed attempt
    apiKeyRateLimiter.recordFailure(clientIp);

    res.status(403).json({
      success: false,
      error: 'Invalid API key.',
    });
    return;
  }

  // Successful authentication - reset rate limiter for this IP
  apiKeyRateLimiter.reset(clientIp);

  next();
}

/**
 * Check if authentication is enabled
 */
export function isAuthEnabled(): boolean {
  return !!API_KEY;
}

/**
 * Get authentication status for health endpoint
 */
export function getAuthStatus(): { enabled: boolean; method: string } {
  return {
    enabled: !!API_KEY,
    method: API_KEY ? 'api_key' : 'none',
  };
}
