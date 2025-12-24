import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockExpressContext } from '../../utils/mocks.js';

/**
 * Creates a mock Express context with socket properties for rate limiter support
 */
function createMockExpressContextWithSocket() {
  const ctx = createMockExpressContext();
  ctx.req.socket = { remoteAddress: '127.0.0.1' } as any;
  ctx.res.setHeader = vi.fn().mockReturnThis();
  return ctx;
}

/**
 * Note: auth.ts reads AUTOMAKER_API_KEY at module load time.
 * We need to reset modules and reimport for each test to get fresh state.
 */
describe('auth.ts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('authMiddleware - no API key', () => {
    it('should call next() when no API key is set', async () => {
      delete process.env.AUTOMAKER_API_KEY;

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContext();

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('authMiddleware - with API key', () => {
    it('should reject request without API key header', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required. Provide X-API-Key header.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request with invalid API key', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = 'wrong-key';

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid API key.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() with valid API key', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = 'test-secret-key';

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('isAuthEnabled', () => {
    it('should return false when no API key is set', async () => {
      delete process.env.AUTOMAKER_API_KEY;

      const { isAuthEnabled } = await import('@/lib/auth.js');
      expect(isAuthEnabled()).toBe(false);
    });

    it('should return true when API key is set', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-key';

      const { isAuthEnabled } = await import('@/lib/auth.js');
      expect(isAuthEnabled()).toBe(true);
    });
  });

  describe('getAuthStatus', () => {
    it('should return disabled status when no API key', async () => {
      delete process.env.AUTOMAKER_API_KEY;

      const { getAuthStatus } = await import('@/lib/auth.js');
      const status = getAuthStatus();

      expect(status).toEqual({
        enabled: false,
        method: 'none',
      });
    });

    it('should return enabled status when API key is set', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-key';

      const { getAuthStatus } = await import('@/lib/auth.js');
      const status = getAuthStatus();

      expect(status).toEqual({
        enabled: true,
        method: 'api_key',
      });
    });
  });

  describe('security - AUTOMAKER_API_KEY not set', () => {
    it('should allow requests without any authentication when API key is not configured', async () => {
      delete process.env.AUTOMAKER_API_KEY;

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContext();

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should allow requests even with invalid key header when API key is not configured', async () => {
      delete process.env.AUTOMAKER_API_KEY;

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContext();
      req.headers['x-api-key'] = 'some-random-key';

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should report auth as disabled when no API key is configured', async () => {
      delete process.env.AUTOMAKER_API_KEY;

      const { isAuthEnabled, getAuthStatus } = await import('@/lib/auth.js');

      expect(isAuthEnabled()).toBe(false);
      expect(getAuthStatus()).toEqual({
        enabled: false,
        method: 'none',
      });
    });
  });

  describe('security - authentication correctness', () => {
    it('should correctly authenticate with matching API key', async () => {
      const testKey = 'correct-secret-key-12345';
      process.env.AUTOMAKER_API_KEY = testKey;

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = testKey;

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject keys that differ by a single character', async () => {
      process.env.AUTOMAKER_API_KEY = 'correct-secret-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = 'correct-secret-keY'; // Last char uppercase

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject keys with extra characters', async () => {
      process.env.AUTOMAKER_API_KEY = 'secret-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = 'secret-key-extra';

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject keys that are a prefix of the actual key', async () => {
      process.env.AUTOMAKER_API_KEY = 'full-secret-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = 'full-secret';

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject empty string API key header', async () => {
      process.env.AUTOMAKER_API_KEY = 'secret-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = '';

      authMiddleware(req, res, next);

      // Empty string is falsy, so should get 401 (no key provided)
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle keys with special characters correctly', async () => {
      const specialKey = 'key-with-$pecial!@#chars_123';
      process.env.AUTOMAKER_API_KEY = specialKey;

      const { authMiddleware } = await import('@/lib/auth.js');
      const { req, res, next } = createMockExpressContextWithSocket();
      req.headers['x-api-key'] = specialKey;

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('security - rate limiting', () => {
    it('should block requests after multiple failed attempts', async () => {
      process.env.AUTOMAKER_API_KEY = 'correct-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { apiKeyRateLimiter } = await import('@/lib/rate-limiter.js');

      // Reset the rate limiter for this test
      apiKeyRateLimiter.reset('192.168.1.100');

      // Simulate multiple failed attempts
      for (let i = 0; i < 5; i++) {
        const { req, res, next } = createMockExpressContextWithSocket();
        req.socket.remoteAddress = '192.168.1.100';
        req.headers['x-api-key'] = 'wrong-key';
        authMiddleware(req, res, next);
      }

      // Next request should be rate limited
      const { req, res, next } = createMockExpressContextWithSocket();
      req.socket.remoteAddress = '192.168.1.100';
      req.headers['x-api-key'] = 'correct-key'; // Even with correct key

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();

      // Cleanup
      apiKeyRateLimiter.reset('192.168.1.100');
    });

    it('should reset rate limit on successful authentication', async () => {
      process.env.AUTOMAKER_API_KEY = 'correct-key';

      const { authMiddleware } = await import('@/lib/auth.js');
      const { apiKeyRateLimiter } = await import('@/lib/rate-limiter.js');

      // Reset the rate limiter for this test
      apiKeyRateLimiter.reset('192.168.1.101');

      // Simulate a few failed attempts (not enough to trigger block)
      for (let i = 0; i < 3; i++) {
        const { req, res, next } = createMockExpressContextWithSocket();
        req.socket.remoteAddress = '192.168.1.101';
        req.headers['x-api-key'] = 'wrong-key';
        authMiddleware(req, res, next);
      }

      // Successful authentication should reset the counter
      const {
        req: successReq,
        res: successRes,
        next: successNext,
      } = createMockExpressContextWithSocket();
      successReq.socket.remoteAddress = '192.168.1.101';
      successReq.headers['x-api-key'] = 'correct-key';

      authMiddleware(successReq, successRes, successNext);

      expect(successNext).toHaveBeenCalled();

      // After reset, we should have full attempts available again
      expect(apiKeyRateLimiter.getAttemptsRemaining('192.168.1.101')).toBe(5);

      // Cleanup
      apiKeyRateLimiter.reset('192.168.1.101');
    });
  });
});
