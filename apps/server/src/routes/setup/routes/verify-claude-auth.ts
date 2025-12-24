/**
 * POST /verify-claude-auth endpoint - Verify Claude authentication by running a test query
 * Supports verifying either CLI auth or API key auth independently
 */

import type { Request, Response } from 'express';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createLogger } from '@automaker/utils';
import { getApiKey } from '../common.js';

const logger = createLogger('Setup');

/**
 * Simple mutex implementation to prevent race conditions when
 * modifying process.env during concurrent verification requests.
 *
 * The Claude Agent SDK reads ANTHROPIC_API_KEY from process.env,
 * so we must temporarily modify it for verification. This mutex
 * ensures only one verification runs at a time.
 */
class VerificationMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

const verificationMutex = new VerificationMutex();

// Known error patterns that indicate auth failure
const AUTH_ERROR_PATTERNS = [
  'OAuth token revoked',
  'Please run /login',
  'please run /login',
  'token revoked',
  'invalid_api_key',
  'authentication_error',
  'unauthorized',
  'not authenticated',
  'authentication failed',
  'invalid api key',
  'api key is invalid',
];

// Patterns that indicate billing/credit issues - should FAIL verification
const BILLING_ERROR_PATTERNS = [
  'credit balance is too low',
  'credit balance too low',
  'insufficient credits',
  'insufficient balance',
  'no credits',
  'out of credits',
  'billing',
  'payment required',
  'add credits',
];

// Patterns that indicate rate/usage limits - should FAIL verification
// Users need to wait or upgrade their plan
const RATE_LIMIT_PATTERNS = [
  'limit reached',
  'rate limit',
  'rate_limit',
  'resets', // Only valid if it's a temporary reset, not a billing issue
  '/upgrade',
  'extra-usage',
];

function isRateLimitError(text: string): boolean {
  const lowerText = text.toLowerCase();
  // First check if it's a billing error - billing errors are NOT rate limits
  if (isBillingError(text)) {
    return false;
  }
  return RATE_LIMIT_PATTERNS.some((pattern) => lowerText.includes(pattern.toLowerCase()));
}

function isBillingError(text: string): boolean {
  const lowerText = text.toLowerCase();
  return BILLING_ERROR_PATTERNS.some((pattern) => lowerText.includes(pattern.toLowerCase()));
}

function containsAuthError(text: string): boolean {
  const lowerText = text.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((pattern) => lowerText.includes(pattern.toLowerCase()));
}

/** Valid authentication method values */
const VALID_AUTH_METHODS = ['cli', 'api_key'] as const;
type AuthMethod = (typeof VALID_AUTH_METHODS)[number];

/**
 * Validates and extracts the authMethod from the request body.
 *
 * @param body - The request body to validate
 * @returns The validated authMethod or undefined if not provided
 * @throws Error if authMethod is provided but invalid
 */
function validateAuthMethod(body: unknown): AuthMethod | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const obj = body as Record<string, unknown>;

  if (!('authMethod' in obj) || obj.authMethod === undefined || obj.authMethod === null) {
    return undefined;
  }

  const authMethod = obj.authMethod;

  if (typeof authMethod !== 'string') {
    throw new Error(`Invalid authMethod type: expected string, got ${typeof authMethod}`);
  }

  if (!VALID_AUTH_METHODS.includes(authMethod as AuthMethod)) {
    throw new Error(
      `Invalid authMethod value: '${authMethod}'. Valid values: ${VALID_AUTH_METHODS.join(', ')}`
    );
  }

  return authMethod as AuthMethod;
}

export function createVerifyClaudeAuthHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate and extract the auth method from the request body
      let authMethod: AuthMethod | undefined;
      try {
        authMethod = validateAuthMethod(req.body);
      } catch (validationError) {
        res.status(400).json({
          success: false,
          authenticated: false,
          error: validationError instanceof Error ? validationError.message : 'Invalid request',
        });
        return;
      }

      logger.info(`[Setup] Verifying Claude authentication using method: ${authMethod || 'auto'}`);

      // Early validation before acquiring mutex - check if API key is needed but missing
      if (authMethod === 'api_key') {
        const storedApiKey = getApiKey('anthropic');
        if (!storedApiKey && !process.env.ANTHROPIC_API_KEY) {
          res.json({
            success: true,
            authenticated: false,
            error: 'No API key configured. Please enter an API key first.',
          });
          return;
        }
      }

      // Acquire mutex to prevent race conditions when modifying process.env
      // The SDK reads ANTHROPIC_API_KEY from environment, so concurrent requests
      // could interfere with each other without this lock
      await verificationMutex.acquire();

      // Create an AbortController with a 30-second timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 30000);

      let authenticated = false;
      let errorMessage = '';
      let receivedAnyContent = false;

      // Save original env values (inside mutex to ensure consistency)
      const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

      try {
        // Configure environment based on auth method
        if (authMethod === 'cli') {
          // For CLI verification, remove any API key so it uses CLI credentials only
          delete process.env.ANTHROPIC_API_KEY;
          logger.info('[Setup] Cleared API key environment for CLI verification');
        } else if (authMethod === 'api_key') {
          // For API key verification, ensure we're using the stored API key
          const storedApiKey = getApiKey('anthropic');
          if (storedApiKey) {
            process.env.ANTHROPIC_API_KEY = storedApiKey;
            logger.info('[Setup] Using stored API key for verification');
          }
          // Note: if no stored key, we use the existing env var (already validated above)
        }

        // Run a minimal query to verify authentication
        const stream = query({
          prompt: "Reply with only the word 'ok'",
          options: {
            model: 'claude-sonnet-4-20250514',
            maxTurns: 1,
            allowedTools: [],
            abortController,
          },
        });

        // Collect all messages and check for errors
        const allMessages: string[] = [];

        for await (const msg of stream) {
          const msgStr = JSON.stringify(msg);
          allMessages.push(msgStr);
          // Debug log only message type to avoid leaking sensitive data
          logger.debug('[Setup] Stream message type:', msg.type);

          // Check for billing errors FIRST - these should fail verification
          if (isBillingError(msgStr)) {
            logger.error('[Setup] Found billing error in message');
            errorMessage =
              'Credit balance is too low. Please add credits to your Anthropic account at console.anthropic.com';
            authenticated = false;
            break;
          }

          // Check if any part of the message contains auth errors
          if (containsAuthError(msgStr)) {
            logger.error('[Setup] Found auth error in message');
            if (authMethod === 'cli') {
              errorMessage =
                "CLI authentication failed. Please run 'claude login' in your terminal to authenticate.";
            } else {
              errorMessage = 'API key is invalid or has been revoked.';
            }
            break;
          }

          // Check specifically for assistant messages with text content
          if (msg.type === 'assistant' && (msg as any).message?.content) {
            const content = (msg as any).message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  const text = block.text;
                  logger.info('[Setup] Assistant text:', text);

                  if (containsAuthError(text)) {
                    if (authMethod === 'cli') {
                      errorMessage =
                        "CLI authentication failed. Please run 'claude login' in your terminal to authenticate.";
                    } else {
                      errorMessage = 'API key is invalid or has been revoked.';
                    }
                    break;
                  }

                  // Valid text response that's not an error
                  if (text.toLowerCase().includes('ok') || text.length > 0) {
                    receivedAnyContent = true;
                  }
                }
              }
            }
          }

          // Check for result messages
          if (msg.type === 'result') {
            const resultStr = JSON.stringify(msg);

            // First check for billing errors - these should FAIL verification
            if (isBillingError(resultStr)) {
              logger.error('[Setup] Billing error detected - insufficient credits');
              errorMessage =
                'Credit balance is too low. Please add credits to your Anthropic account at console.anthropic.com';
              authenticated = false;
              break;
            }
            // Check if it's a rate limit error - should FAIL verification
            else if (isRateLimitError(resultStr)) {
              logger.warn('[Setup] Rate limit detected - treating as unverified');
              errorMessage =
                'Rate limit reached. Please wait a while before trying again or upgrade your plan.';
              authenticated = false;
              break;
            } else if (containsAuthError(resultStr)) {
              if (authMethod === 'cli') {
                errorMessage =
                  "CLI authentication failed. Please run 'claude login' in your terminal to authenticate.";
              } else {
                errorMessage = 'API key is invalid or has been revoked.';
              }
            } else {
              // Got a result without errors
              receivedAnyContent = true;
            }
          }
        }

        // Determine authentication status
        if (errorMessage) {
          authenticated = false;
        } else if (receivedAnyContent) {
          authenticated = true;
        } else {
          // No content received - might be an issue
          logger.warn('[Setup] No content received from stream');
          // Log only message count to avoid leaking sensitive data
          logger.warn('[Setup] Total messages received:', allMessages.length);
          errorMessage = 'No response received from Claude. Please check your authentication.';
        }
      } catch (error: unknown) {
        const errMessage = error instanceof Error ? error.message : String(error);

        logger.error('[Setup] Claude auth verification exception:', errMessage);

        // Check for billing errors FIRST - these always fail
        if (isBillingError(errMessage)) {
          authenticated = false;
          errorMessage =
            'Credit balance is too low. Please add credits to your Anthropic account at console.anthropic.com';
        }
        // Check for rate limit in exception - should FAIL verification
        else if (isRateLimitError(errMessage)) {
          authenticated = false;
          errorMessage =
            'Rate limit reached. Please wait a while before trying again or upgrade your plan.';
          logger.warn('[Setup] Rate limit in exception - treating as unverified');
        }
        // If we already determined auth was successful, keep it
        else if (authenticated) {
          logger.info('[Setup] Auth already confirmed, ignoring exception');
        }
        // Check for auth-related errors in exception
        else if (containsAuthError(errMessage)) {
          if (authMethod === 'cli') {
            errorMessage =
              "CLI authentication failed. Please run 'claude login' in your terminal to authenticate.";
          } else {
            errorMessage = 'API key is invalid or has been revoked.';
          }
        } else if (errMessage.includes('abort') || errMessage.includes('timeout')) {
          errorMessage = 'Verification timed out. Please try again.';
        } else if (errMessage.includes('exit') && errMessage.includes('code 1')) {
          // Process exited with code 1 but we might have gotten rate limit info in the stream
          // Check if we received any content that indicated auth worked
          if (receivedAnyContent && !errorMessage) {
            authenticated = true;
            logger.info('[Setup] Process exit 1 but content received - auth valid');
          } else if (!errorMessage) {
            errorMessage = errMessage;
          }
        } else if (!errorMessage) {
          errorMessage = errMessage;
        }
      } finally {
        clearTimeout(timeoutId);
        // Restore original environment
        if (originalAnthropicKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
        } else if (authMethod === 'cli') {
          // If we cleared it and there was no original, keep it cleared
          delete process.env.ANTHROPIC_API_KEY;
        }
        // Release the mutex so other verification requests can proceed
        verificationMutex.release();
      }

      logger.info('[Setup] Verification result:', {
        authenticated,
        errorMessage,
        authMethod,
      });

      res.json({
        success: true,
        authenticated,
        error: errorMessage || undefined,
      });
    } catch (error) {
      logger.error('[Setup] Verify Claude auth endpoint error:', error);
      res.status(500).json({
        success: false,
        authenticated: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      });
    }
  };
}
