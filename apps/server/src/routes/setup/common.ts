/**
 * Common utilities and state for setup routes
 */

import { createLogger } from '@automaker/utils';
import path from 'path';
import fs from 'fs/promises';
import { getErrorMessage as getErrorMessageShared, createLogError } from '../common.js';

const logger = createLogger('Setup');

/**
 * Escapes special regex characters in a string to prevent regex injection.
 * This ensures user input can be safely used in RegExp constructors.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for use in RegExp
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Storage for API keys (in-memory cache) - private
const apiKeys: Record<string, string> = {};

/**
 * Get an API key for a provider
 */
export function getApiKey(provider: string): string | undefined {
  return apiKeys[provider];
}

/**
 * Set an API key for a provider
 */
export function setApiKey(provider: string, key: string): void {
  apiKeys[provider] = key;
}

/**
 * Get all API keys (for read-only access)
 */
export function getAllApiKeys(): Record<string, string> {
  return { ...apiKeys };
}

/**
 * Escape a value for safe inclusion in a .env file.
 * Handles special characters like quotes, newlines, dollar signs, and backslashes.
 * Returns a properly quoted string if needed.
 */
function escapeEnvValue(value: string): string {
  // Check if the value contains any characters that require quoting
  const requiresQuoting = /[\s"'$`\\#\n\r]/.test(value) || value.includes('=');

  if (!requiresQuoting) {
    return value;
  }

  // Use double quotes and escape special characters within
  // Escape backslashes first to avoid double-escaping
  let escaped = value
    .replace(/\\/g, '\\\\') // Escape backslashes
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\$/g, '\\$') // Escape dollar signs (prevents variable expansion)
    .replace(/`/g, '\\`') // Escape backticks
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r'); // Escape carriage returns

  return `"${escaped}"`;
}

/**
 * Helper to persist API keys to .env file
 */
export async function persistApiKeyToEnv(key: string, value: string): Promise<void> {
  const envPath = path.join(process.cwd(), '.env');

  try {
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch {
      // .env file doesn't exist, we'll create it
    }

    // Escape the value for safe .env file storage
    const escapedValue = escapeEnvValue(value);

    // Parse existing env content - match key with optional quoted values
    const lines = envContent.split('\n');
    const keyRegex = new RegExp(`^${escapeRegExp(key)}=`);
    let found = false;
    const newLines = lines.map((line) => {
      if (keyRegex.test(line)) {
        found = true;
        return `${key}=${escapedValue}`;
      }
      return line;
    });

    if (!found) {
      // Add the key at the end
      newLines.push(`${key}=${escapedValue}`);
    }

    await fs.writeFile(envPath, newLines.join('\n'));
    logger.info(`[Setup] Persisted ${key} to .env file`);
  } catch (error) {
    logger.error(`[Setup] Failed to persist ${key} to .env:`, error);
    throw error;
  }
}

// Re-export shared utilities
export { getErrorMessageShared as getErrorMessage };
export const logError = createLogError(logger);
