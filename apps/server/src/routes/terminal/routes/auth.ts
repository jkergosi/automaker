/**
 * POST /auth endpoint - Authenticate with password to get a session token
 * Includes rate limiting to prevent brute-force attacks.
 */

import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import {
  getTerminalEnabledConfigValue,
  getTerminalPasswordConfig,
  generateToken,
  addToken,
  getTokenExpiryMs,
  getErrorMessage,
} from '../common.js';
import { terminalAuthRateLimiter } from '../../../lib/rate-limiter.js';

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

export function createAuthHandler() {
  return (req: Request, res: Response): void => {
    if (!getTerminalEnabledConfigValue()) {
      res.status(403).json({
        success: false,
        error: 'Terminal access is disabled',
      });
      return;
    }

    const terminalPassword = getTerminalPasswordConfig();

    // If no password required, return immediate success
    if (!terminalPassword) {
      res.json({
        success: true,
        data: {
          authenticated: true,
          passwordRequired: false,
        },
      });
      return;
    }

    const clientIp = terminalAuthRateLimiter.getClientIp(req);

    // Check if client is rate limited
    if (terminalAuthRateLimiter.isBlocked(clientIp)) {
      const retryAfterMs = terminalAuthRateLimiter.getBlockTimeRemaining(clientIp);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        success: false,
        error: 'Too many failed authentication attempts. Please try again later.',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    const { password } = req.body;

    if (!password || !secureCompare(password, terminalPassword)) {
      // Record failed attempt
      terminalAuthRateLimiter.recordFailure(clientIp);

      res.status(401).json({
        success: false,
        error: 'Invalid password',
      });
      return;
    }

    // Successful authentication - reset rate limiter for this IP
    terminalAuthRateLimiter.reset(clientIp);

    // Generate session token
    const token = generateToken();
    const now = new Date();
    addToken(token, {
      createdAt: now,
      expiresAt: new Date(now.getTime() + getTokenExpiryMs()),
    });

    res.json({
      success: true,
      data: {
        authenticated: true,
        token,
        expiresIn: getTokenExpiryMs(),
      },
    });
  };
}
