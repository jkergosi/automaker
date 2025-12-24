/**
 * PUT /api/settings/credentials - Update API credentials
 *
 * Updates API keys for Anthropic. Partial updates supported.
 * Returns masked credentials for verification without exposing full keys.
 *
 * Request body: `Partial<Credentials>` (usually just apiKeys)
 * Response: `{ "success": true, "credentials": { anthropic } }`
 */

import type { Request, Response } from 'express';
import type { SettingsService } from '../../../services/settings-service.js';
import type { Credentials } from '../../../types/settings.js';
import { logError } from '../common.js';

/** Maximum allowed length for API keys to prevent abuse */
const MAX_API_KEY_LENGTH = 512;

/** Known API key provider names that are valid */
const VALID_API_KEY_PROVIDERS = ['anthropic', 'google', 'openai'] as const;

/**
 * Validates that the provided updates object has the correct structure
 * and all apiKeys values are strings within acceptable length limits.
 *
 * @param updates - The partial credentials update object to validate
 * @returns An error message if validation fails, or null if valid
 */
function validateCredentialsUpdate(updates: unknown): string | null {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return 'Invalid request body - expected credentials object';
  }

  const obj = updates as Record<string, unknown>;

  // If apiKeys is provided, validate its structure
  if ('apiKeys' in obj) {
    const apiKeys = obj.apiKeys;

    if (apiKeys === null || apiKeys === undefined) {
      // Allow null/undefined to clear
      return null;
    }

    if (typeof apiKeys !== 'object' || Array.isArray(apiKeys)) {
      return 'Invalid apiKeys - expected object';
    }

    const keysObj = apiKeys as Record<string, unknown>;

    // Validate each provided API key
    for (const [provider, value] of Object.entries(keysObj)) {
      // Check provider name is valid
      if (!VALID_API_KEY_PROVIDERS.includes(provider as (typeof VALID_API_KEY_PROVIDERS)[number])) {
        return `Invalid API key provider: ${provider}. Valid providers: ${VALID_API_KEY_PROVIDERS.join(', ')}`;
      }

      // Check value is a string
      if (typeof value !== 'string') {
        return `Invalid API key for ${provider} - expected string`;
      }

      // Check length limit
      if (value.length > MAX_API_KEY_LENGTH) {
        return `API key for ${provider} exceeds maximum length of ${MAX_API_KEY_LENGTH} characters`;
      }
    }
  }

  // Validate version if provided
  if ('version' in obj && obj.version !== undefined) {
    if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 0) {
      return 'Invalid version - expected non-negative integer';
    }
  }

  return null;
}

/**
 * Create handler factory for PUT /api/settings/credentials
 *
 * @param settingsService - Instance of SettingsService for file I/O
 * @returns Express request handler
 */
export function createUpdateCredentialsHandler(settingsService: SettingsService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate the request body before type assertion
      const validationError = validateCredentialsUpdate(req.body);
      if (validationError) {
        res.status(400).json({
          success: false,
          error: validationError,
        });
        return;
      }

      // Safe to cast after validation
      const updates = req.body as Partial<Credentials>;

      await settingsService.updateCredentials(updates);

      // Return masked credentials for confirmation
      const masked = await settingsService.getMaskedCredentials();

      res.json({
        success: true,
        credentials: masked,
      });
    } catch (error) {
      logError(error, 'Update credentials failed');
      res.status(500).json({ success: false, error: 'Failed to update credentials' });
    }
  };
}
