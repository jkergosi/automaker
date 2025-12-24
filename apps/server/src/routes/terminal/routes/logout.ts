/**
 * POST /logout endpoint - Invalidate a session token
 *
 * Security: Only allows invalidating the token used for authentication.
 * This ensures users can only log out their own sessions.
 */

import type { Request, Response } from 'express';
import { deleteToken, extractBearerToken, validateTerminalToken } from '../common.js';

export function createLogoutHandler() {
  return (req: Request, res: Response): void => {
    const token = extractBearerToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Authorization header with Bearer token is required',
      });
      return;
    }

    if (!validateTerminalToken(token)) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
      return;
    }

    // Token is valid and belongs to the requester - safe to invalidate
    deleteToken(token);

    res.json({
      success: true,
    });
  };
}
