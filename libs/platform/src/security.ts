/**
 * Security utilities for path validation
 * Enforces ALLOWED_ROOT_DIRECTORY constraint with appData exception
 *
 * Security considerations:
 * - Symlink resolution: validatePathWithSymlinkCheck() resolves symlinks to prevent
 *   escaping the allowed directory via symbolic links
 * - TOCTOU: There is an inherent race condition between path validation and file
 *   operation. Callers should use the resolved realpath for operations when possible.
 */

import path from 'path';
import fs from 'fs';

/**
 * Security mode: 'strict' fails closed when ALLOWED_ROOT_DIRECTORY is not set,
 * 'permissive' allows all paths (legacy behavior, not recommended for production)
 */
let securityMode: 'strict' | 'permissive' = 'strict';

/**
 * Error thrown when a path is not allowed by security policy
 */
export class PathNotAllowedError extends Error {
  constructor(filePath: string) {
    super(`Path not allowed: ${filePath}. Must be within ALLOWED_ROOT_DIRECTORY or DATA_DIR.`);
    this.name = 'PathNotAllowedError';
  }
}

// Allowed root directory - main security boundary
let allowedRootDirectory: string | null = null;

// Data directory - always allowed for settings/credentials
let dataDirectory: string | null = null;

/**
 * Initialize security settings from environment variables
 * - ALLOWED_ROOT_DIRECTORY: main security boundary
 * - DATA_DIR: appData exception, always allowed
 * - SECURITY_MODE: 'strict' (default, fail-closed) or 'permissive' (legacy, fail-open)
 */
export function initAllowedPaths(): void {
  // Load security mode
  const mode = process.env.SECURITY_MODE?.toLowerCase();
  if (mode === 'permissive') {
    securityMode = 'permissive';
    console.warn(
      '[Security] WARNING: Running in PERMISSIVE mode - all paths allowed when ALLOWED_ROOT_DIRECTORY is not set. ' +
        'This is not recommended for production environments.'
    );
  } else {
    securityMode = 'strict';
  }

  // Load ALLOWED_ROOT_DIRECTORY
  const rootDir = process.env.ALLOWED_ROOT_DIRECTORY;
  if (rootDir) {
    allowedRootDirectory = path.resolve(rootDir);
    console.log(`[Security] ALLOWED_ROOT_DIRECTORY configured: ${allowedRootDirectory}`);
  } else if (securityMode === 'strict') {
    console.error(
      '[Security] CRITICAL: ALLOWED_ROOT_DIRECTORY not set in strict mode. ' +
        'All file operations outside DATA_DIR will be denied. ' +
        'Set ALLOWED_ROOT_DIRECTORY or use SECURITY_MODE=permissive to allow all paths.'
    );
  } else {
    console.warn(
      '[Security] WARNING: ALLOWED_ROOT_DIRECTORY not set - allowing access to all paths'
    );
  }

  // Load DATA_DIR (appData exception - always allowed)
  const dataDir = process.env.DATA_DIR;
  if (dataDir) {
    dataDirectory = path.resolve(dataDir);
    console.log(`[Security] DATA_DIR configured: ${dataDirectory}`);
  }
}

/**
 * Check if a path is allowed based on ALLOWED_ROOT_DIRECTORY
 * Returns true if:
 * - Path is within ALLOWED_ROOT_DIRECTORY, OR
 * - Path is within DATA_DIR (appData exception), OR
 * - No restrictions are configured AND security mode is 'permissive'
 *
 * In strict mode (default), paths are denied if ALLOWED_ROOT_DIRECTORY is not set,
 * unless they are within DATA_DIR.
 */
export function isPathAllowed(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);

  // Always allow appData directory (settings, credentials)
  if (dataDirectory && isPathWithinDirectory(resolvedPath, dataDirectory)) {
    return true;
  }

  // If no ALLOWED_ROOT_DIRECTORY restriction is configured:
  // - In strict mode: deny (fail-closed)
  // - In permissive mode: allow all paths (legacy behavior)
  if (!allowedRootDirectory) {
    return securityMode === 'permissive';
  }

  // Allow if within ALLOWED_ROOT_DIRECTORY
  if (isPathWithinDirectory(resolvedPath, allowedRootDirectory)) {
    return true;
  }

  // Path doesn't match any allowed directory, deny
  return false;
}

/**
 * Validate a path - resolves it and checks permissions
 * Throws PathNotAllowedError if path is not allowed
 *
 * NOTE: This function uses path.resolve() which does NOT resolve symbolic links.
 * For operations on existing files where symlink attacks are a concern, use
 * validatePathWithSymlinkCheck() instead.
 */
export function validatePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);

  if (!isPathAllowed(resolvedPath)) {
    throw new PathNotAllowedError(filePath);
  }

  return resolvedPath;
}

/**
 * Validate a path with symlink resolution for existing files
 * This prevents symlink-based directory escape attacks by resolving the
 * actual filesystem path before validation.
 *
 * @param filePath - The path to validate
 * @param options.requireExists - If true (default), throws if path doesn't exist.
 *                                If false, falls back to validatePath for non-existent paths.
 * @returns The real path (symlinks resolved) if file exists, or resolved path if not
 * @throws PathNotAllowedError if the real path escapes allowed directories
 *
 * Security note: There is still a TOCTOU race between this check and the actual
 * file operation. For maximum security, callers should use the returned realpath
 * for the subsequent operation, not the original path.
 */
export function validatePathWithSymlinkCheck(
  filePath: string,
  options: { requireExists?: boolean } = {}
): string {
  const { requireExists = true } = options;
  const resolvedPath = path.resolve(filePath);

  try {
    // Check if path exists and get info without following symlinks
    const lstats = fs.lstatSync(resolvedPath);

    // Get the real path (resolves all symlinks)
    const realPath = fs.realpathSync(resolvedPath);

    // Validate the real path, not the symlink path
    if (!isPathAllowed(realPath)) {
      throw new PathNotAllowedError(`${filePath} (resolves to ${realPath} via symlink)`);
    }

    // If it's a symlink, log for security auditing
    if (lstats.isSymbolicLink()) {
      console.log(`[Security] Symlink detected: ${resolvedPath} -> ${realPath}`);
    }

    return realPath;
  } catch (error) {
    // Handle file not found
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (requireExists) {
        throw error;
      }
      // For new files, validate the parent directory with symlink check if it exists
      const parentDir = path.dirname(resolvedPath);
      try {
        const realParentPath = fs.realpathSync(parentDir);
        if (!isPathAllowed(realParentPath)) {
          throw new PathNotAllowedError(`${filePath} (parent resolves to ${realParentPath})`);
        }
        // Return the path within the real parent
        return path.join(realParentPath, path.basename(resolvedPath));
      } catch (parentError) {
        // Parent doesn't exist either, fall back to basic validation
        if ((parentError as NodeJS.ErrnoException).code === 'ENOENT') {
          return validatePath(filePath);
        }
        throw parentError;
      }
    }
    // Re-throw PathNotAllowedError and other errors
    throw error;
  }
}

/**
 * Check if a path is within a directory, with protection against path traversal
 * Returns true only if resolvedPath is within directoryPath
 */
export function isPathWithinDirectory(resolvedPath: string, directoryPath: string): boolean {
  // Get the relative path from directory to the target
  const relativePath = path.relative(directoryPath, resolvedPath);

  // If relative path starts with "..", it's outside the directory
  // If relative path is absolute, it's outside the directory
  // If relative path is empty or ".", it's the directory itself
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/**
 * Get the configured allowed root directory
 */
export function getAllowedRootDirectory(): string | null {
  return allowedRootDirectory;
}

/**
 * Get the configured data directory
 */
export function getDataDirectory(): string | null {
  return dataDirectory;
}

/**
 * Get list of allowed paths (for debugging)
 */
export function getAllowedPaths(): string[] {
  const paths: string[] = [];
  if (allowedRootDirectory) {
    paths.push(allowedRootDirectory);
  }
  if (dataDirectory) {
    paths.push(dataDirectory);
  }
  return paths;
}
