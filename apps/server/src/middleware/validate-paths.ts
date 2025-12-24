/**
 * Middleware for validating path parameters against ALLOWED_ROOT_DIRECTORY
 * Provides a clean, reusable way to validate paths without repeating the same
 * try-catch block in every route handler
 */

import type { Request, Response, NextFunction } from 'express';
import { validatePath, PathNotAllowedError } from '@automaker/platform';

/**
 * Custom error for invalid path type
 */
class InvalidPathTypeError extends Error {
  constructor(paramName: string, expectedType: string, actualType: string) {
    super(`Invalid type for '${paramName}': expected ${expectedType}, got ${actualType}`);
    this.name = 'InvalidPathTypeError';
  }
}

/**
 * Validates that a value is a non-empty string suitable for path validation
 *
 * @param value - The value to check
 * @param paramName - The parameter name for error messages
 * @throws InvalidPathTypeError if value is not a valid string
 */
function assertValidPathString(value: unknown, paramName: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new InvalidPathTypeError(paramName, 'string', typeof value);
  }
}

/**
 * Creates a middleware that validates specified path parameters in req.body
 * @param paramNames - Names of parameters to validate (e.g., 'projectPath', 'worktreePath')
 * @example
 * router.post('/create', validatePathParams('projectPath'), handler);
 * router.post('/delete', validatePathParams('projectPath', 'worktreePath'), handler);
 * router.post('/send', validatePathParams('workingDirectory?', 'imagePaths[]'), handler);
 *
 * Special syntax:
 * - 'paramName?' - Optional parameter (only validated if present)
 * - 'paramName[]' - Array parameter (validates each element)
 */
export function validatePathParams(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      for (const paramName of paramNames) {
        // Handle optional parameters (paramName?)
        if (paramName.endsWith('?')) {
          const actualName = paramName.slice(0, -1);
          const value = req.body[actualName];
          if (value !== undefined && value !== null) {
            assertValidPathString(value, actualName);
            validatePath(value);
          }
          continue;
        }

        // Handle array parameters (paramName[])
        if (paramName.endsWith('[]')) {
          const actualName = paramName.slice(0, -2);
          const values = req.body[actualName];

          // Skip if not provided or empty
          if (values === undefined || values === null) {
            continue;
          }

          // Validate that it's actually an array
          if (!Array.isArray(values)) {
            throw new InvalidPathTypeError(actualName, 'array', typeof values);
          }

          // Validate each element in the array
          for (let i = 0; i < values.length; i++) {
            const value = values[i];
            assertValidPathString(value, `${actualName}[${i}]`);
            validatePath(value);
          }
          continue;
        }

        // Handle regular parameters
        const value = req.body[paramName];
        if (value !== undefined && value !== null) {
          assertValidPathString(value, paramName);
          validatePath(value);
        }
      }

      next();
    } catch (error) {
      if (error instanceof PathNotAllowedError) {
        res.status(403).json({
          success: false,
          error: error.message,
        });
        return;
      }

      if (error instanceof InvalidPathTypeError) {
        res.status(400).json({
          success: false,
          error: error.message,
        });
        return;
      }

      // Re-throw unexpected errors
      throw error;
    }
  };
}
