import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';

describe('security.ts', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Reset modules to get fresh state
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('initAllowedPaths', () => {
    it('should load ALLOWED_ROOT_DIRECTORY if set', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/projects';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, getAllowedPaths } = await import('../src/security');
      initAllowedPaths();

      const allowed = getAllowedPaths();
      expect(allowed).toContain(path.resolve('/projects'));
    });

    it('should load DATA_DIR if set', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      process.env.DATA_DIR = '/data/directory';

      const { initAllowedPaths, getAllowedPaths } = await import('../src/security');
      initAllowedPaths();

      const allowed = getAllowedPaths();
      expect(allowed).toContain(path.resolve('/data/directory'));
    });

    it('should load both ALLOWED_ROOT_DIRECTORY and DATA_DIR if both set', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/projects';
      process.env.DATA_DIR = '/app/data';

      const { initAllowedPaths, getAllowedPaths } = await import('../src/security');
      initAllowedPaths();

      const allowed = getAllowedPaths();
      expect(allowed).toContain(path.resolve('/projects'));
      expect(allowed).toContain(path.resolve('/app/data'));
    });

    it('should handle missing environment variables gracefully', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      delete process.env.DATA_DIR;

      const { initAllowedPaths } = await import('../src/security');
      expect(() => initAllowedPaths()).not.toThrow();
    });
  });

  describe('isPathAllowed', () => {
    it('should allow paths within ALLOWED_ROOT_DIRECTORY', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      expect(isPathAllowed('/allowed/file.txt')).toBe(true);
      expect(isPathAllowed('/allowed/subdir/file.txt')).toBe(true);
    });

    it('should deny paths outside ALLOWED_ROOT_DIRECTORY', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      expect(isPathAllowed('/not-allowed/file.txt')).toBe(false);
      expect(isPathAllowed('/etc/passwd')).toBe(false);
    });

    it('should always allow DATA_DIR paths', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/projects';
      process.env.DATA_DIR = '/app/data';

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // DATA_DIR paths are always allowed
      expect(isPathAllowed('/app/data/settings.json')).toBe(true);
      expect(isPathAllowed('/app/data/credentials.json')).toBe(true);
    });

    it('should deny all paths in strict mode when no restrictions configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      delete process.env.DATA_DIR;
      delete process.env.SECURITY_MODE; // Default to strict

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // In strict mode, paths are denied when no ALLOWED_ROOT_DIRECTORY is set
      expect(isPathAllowed('/any/path')).toBe(false);
      expect(isPathAllowed('/etc/passwd')).toBe(false);
    });

    it('should allow all paths in permissive mode when no restrictions configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      delete process.env.DATA_DIR;
      process.env.SECURITY_MODE = 'permissive';

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // In permissive mode, all paths are allowed when no restrictions configured
      expect(isPathAllowed('/any/path')).toBe(true);
      expect(isPathAllowed('/etc/passwd')).toBe(true);
    });

    it('should deny non-DATA_DIR paths in strict mode when only DATA_DIR is configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      process.env.DATA_DIR = '/data';
      delete process.env.SECURITY_MODE; // Default to strict

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // DATA_DIR should be allowed
      expect(isPathAllowed('/data/file.txt')).toBe(true);
      // Other paths should be denied in strict mode
      expect(isPathAllowed('/any/path')).toBe(false);
    });

    it('should allow all paths in permissive mode when only DATA_DIR is configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      process.env.DATA_DIR = '/data';
      process.env.SECURITY_MODE = 'permissive';

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // DATA_DIR should be allowed
      expect(isPathAllowed('/data/file.txt')).toBe(true);
      // Other paths should also be allowed in permissive mode
      expect(isPathAllowed('/any/path')).toBe(true);
    });
  });

  describe('validatePath', () => {
    it('should return resolved path for allowed paths', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, validatePath } = await import('../src/security');
      initAllowedPaths();

      const result = validatePath('/allowed/file.txt');
      expect(result).toBe(path.resolve('/allowed/file.txt'));
    });

    it('should throw error for paths outside allowed directories', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, validatePath, PathNotAllowedError } =
        await import('../src/security');
      initAllowedPaths();

      expect(() => validatePath('/not-allowed/file.txt')).toThrow(PathNotAllowedError);
    });

    it('should resolve relative paths', async () => {
      const cwd = process.cwd();
      process.env.ALLOWED_ROOT_DIRECTORY = cwd;
      delete process.env.DATA_DIR;

      const { initAllowedPaths, validatePath } = await import('../src/security');
      initAllowedPaths();

      const result = validatePath('./file.txt');
      expect(result).toBe(path.resolve(cwd, './file.txt'));
    });

    it('should throw in strict mode when no restrictions configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      delete process.env.DATA_DIR;
      delete process.env.SECURITY_MODE; // Default to strict

      const { initAllowedPaths, validatePath, PathNotAllowedError } =
        await import('../src/security');
      initAllowedPaths();

      // In strict mode, paths are denied when no ALLOWED_ROOT_DIRECTORY is set
      expect(() => validatePath('/any/path')).toThrow(PathNotAllowedError);
    });

    it('should not throw in permissive mode when no restrictions configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      delete process.env.DATA_DIR;
      process.env.SECURITY_MODE = 'permissive';

      const { initAllowedPaths, validatePath } = await import('../src/security');
      initAllowedPaths();

      // In permissive mode, all paths are allowed when no restrictions configured
      expect(() => validatePath('/any/path')).not.toThrow();
    });
  });

  describe('getAllowedPaths', () => {
    it('should return empty array when no paths configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;
      delete process.env.DATA_DIR;

      const { initAllowedPaths, getAllowedPaths } = await import('../src/security');
      initAllowedPaths();

      const allowed = getAllowedPaths();
      expect(Array.isArray(allowed)).toBe(true);
      expect(allowed).toHaveLength(0);
    });

    it('should return configured paths', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/projects';
      process.env.DATA_DIR = '/data';

      const { initAllowedPaths, getAllowedPaths } = await import('../src/security');
      initAllowedPaths();

      const allowed = getAllowedPaths();
      expect(allowed).toContain(path.resolve('/projects'));
      expect(allowed).toContain(path.resolve('/data'));
    });
  });

  describe('getAllowedRootDirectory', () => {
    it('should return the configured root directory', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/projects';

      const { initAllowedPaths, getAllowedRootDirectory } = await import('../src/security');
      initAllowedPaths();

      expect(getAllowedRootDirectory()).toBe(path.resolve('/projects'));
    });

    it('should return null when not configured', async () => {
      delete process.env.ALLOWED_ROOT_DIRECTORY;

      const { initAllowedPaths, getAllowedRootDirectory } = await import('../src/security');
      initAllowedPaths();

      expect(getAllowedRootDirectory()).toBeNull();
    });
  });

  describe('path traversal attack prevention', () => {
    it('should block basic path traversal with ../', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      expect(isPathAllowed('/allowed/../etc/passwd')).toBe(false);
      expect(isPathAllowed('/allowed/subdir/../../etc/passwd')).toBe(false);
    });

    it('should block path traversal with multiple ../ sequences', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed/deep/nested';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      expect(isPathAllowed('/allowed/deep/nested/../../../etc/passwd')).toBe(false);
      expect(isPathAllowed('/allowed/deep/nested/../../../../root')).toBe(false);
    });

    it('should block standalone .. in path components', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      expect(isPathAllowed('/allowed/foo/..bar')).toBe(true); // This is a valid filename, not traversal
      expect(isPathAllowed('/allowed/foo/../bar')).toBe(true); // Resolves within allowed
      expect(isPathAllowed('/allowed/../notallowed')).toBe(false);
    });

    it('should handle edge case of path ending with /..', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed/subdir';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      expect(isPathAllowed('/allowed/subdir/..')).toBe(false);
      expect(isPathAllowed('/allowed/subdir/../..')).toBe(false);
    });

    it('should properly resolve and block complex traversal attempts', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/home/user/projects';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // Attempt to escape via complex path
      expect(isPathAllowed('/home/user/projects/app/../../../etc/shadow')).toBe(false);

      // Valid path that uses .. but stays within allowed
      expect(isPathAllowed('/home/user/projects/app/../lib/file.ts')).toBe(true);
    });

    it('should validate path throws on traversal attacks', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, validatePath, PathNotAllowedError } =
        await import('../src/security');
      initAllowedPaths();

      expect(() => validatePath('/allowed/../etc/passwd')).toThrow(PathNotAllowedError);
      expect(() => validatePath('/allowed/../../root/.ssh/id_rsa')).toThrow(PathNotAllowedError);
    });

    it('should handle paths with mixed separators (cross-platform)', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // Node's path.resolve handles these correctly on each platform
      const maliciousPath = path.resolve('/allowed', '..', 'etc', 'passwd');
      expect(isPathAllowed(maliciousPath)).toBe(false);
    });

    it('should correctly identify paths at the boundary', async () => {
      process.env.ALLOWED_ROOT_DIRECTORY = '/allowed';
      delete process.env.DATA_DIR;

      const { initAllowedPaths, isPathAllowed } = await import('../src/security');
      initAllowedPaths();

      // The allowed directory itself should be allowed
      expect(isPathAllowed('/allowed')).toBe(true);
      expect(isPathAllowed('/allowed/')).toBe(true);

      // Parent of allowed should not be allowed
      expect(isPathAllowed('/')).toBe(false);

      // Sibling directories should not be allowed
      expect(isPathAllowed('/allowed2')).toBe(false);
      expect(isPathAllowed('/allowedextra')).toBe(false);
    });
  });

  describe('getDataDirectory', () => {
    it('should return the configured data directory', async () => {
      process.env.DATA_DIR = '/data';

      const { initAllowedPaths, getDataDirectory } = await import('../src/security');
      initAllowedPaths();

      expect(getDataDirectory()).toBe(path.resolve('/data'));
    });

    it('should return null when not configured', async () => {
      delete process.env.DATA_DIR;

      const { initAllowedPaths, getDataDirectory } = await import('../src/security');
      initAllowedPaths();

      expect(getDataDirectory()).toBeNull();
    });
  });
});
