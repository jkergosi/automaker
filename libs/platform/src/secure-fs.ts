/**
 * Secure File System Adapter
 *
 * All file I/O operations must go through this adapter to enforce
 * ALLOWED_ROOT_DIRECTORY restrictions at the actual access point,
 * not just at the API layer. This provides defense-in-depth security.
 *
 * Security features:
 * - Path validation: All paths are validated against allowed directories
 * - Symlink protection: Operations on existing files resolve symlinks before validation
 *   to prevent directory escape attacks via symbolic links
 *
 * TOCTOU (Time-of-check to time-of-use) note:
 * There is an inherent race condition between path validation and the actual file
 * operation. To mitigate this, we use the validated realpath (symlinks resolved)
 * for the actual operation wherever possible. However, this cannot fully prevent
 * race conditions in a multi-process environment. For maximum security in
 * high-risk scenarios, consider using file descriptor-based operations or
 * additional locking mechanisms.
 */

import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { validatePath, validatePathWithSymlinkCheck } from './security.js';

/**
 * Wrapper around fs.access that validates path first
 * Uses symlink-aware validation to prevent directory escape attacks
 */
export async function access(filePath: string, mode?: number): Promise<void> {
  // Use symlink check since we're checking an existing path
  const validatedPath = validatePathWithSymlinkCheck(filePath);
  return fs.access(validatedPath, mode);
}

/**
 * Wrapper around fs.readFile that validates path first
 * Uses symlink-aware validation to prevent reading files outside allowed directories
 */
export async function readFile(
  filePath: string,
  encoding?: BufferEncoding
): Promise<string | Buffer> {
  // Use symlink check since we're reading an existing file
  const validatedPath = validatePathWithSymlinkCheck(filePath);
  if (encoding) {
    return fs.readFile(validatedPath, encoding);
  }
  return fs.readFile(validatedPath);
}

/**
 * Wrapper around fs.writeFile that validates path first
 * Uses symlink-aware validation for existing files, or validates parent for new files
 */
export async function writeFile(
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding
): Promise<void> {
  // Use symlink check with requireExists=false to handle both new and existing files
  const validatedPath = validatePathWithSymlinkCheck(filePath, { requireExists: false });
  return fs.writeFile(validatedPath, data, encoding);
}

/**
 * Wrapper around fs.mkdir that validates path first
 * Uses symlink-aware validation for parent directory to prevent creating dirs via symlink escape
 */
export async function mkdir(
  dirPath: string,
  options?: { recursive?: boolean; mode?: number }
): Promise<string | undefined> {
  // Use symlink check with requireExists=false since directory may not exist yet
  const validatedPath = validatePathWithSymlinkCheck(dirPath, { requireExists: false });
  return fs.mkdir(validatedPath, options);
}

/**
 * Wrapper around fs.readdir that validates path first
 * Uses symlink-aware validation to prevent listing directories outside allowed paths
 */
export async function readdir(
  dirPath: string,
  options?: { withFileTypes?: false; encoding?: BufferEncoding }
): Promise<string[]>;
export async function readdir(
  dirPath: string,
  options: { withFileTypes: true; encoding?: BufferEncoding }
): Promise<Dirent[]>;
export async function readdir(
  dirPath: string,
  options?: { withFileTypes?: boolean; encoding?: BufferEncoding }
): Promise<string[] | Dirent[]> {
  // Use symlink check since we're reading an existing directory
  const validatedPath = validatePathWithSymlinkCheck(dirPath);
  if (options?.withFileTypes === true) {
    return fs.readdir(validatedPath, { withFileTypes: true });
  }
  return fs.readdir(validatedPath);
}

/**
 * Wrapper around fs.stat that validates path first
 * Uses symlink-aware validation to prevent stat on files outside allowed paths
 */
export async function stat(filePath: string): Promise<any> {
  // Use symlink check since we're getting info about an existing file
  const validatedPath = validatePathWithSymlinkCheck(filePath);
  return fs.stat(validatedPath);
}

/**
 * Wrapper around fs.rm that validates path first
 * Uses symlink-aware validation to prevent deleting files/directories outside allowed paths
 */
export async function rm(
  filePath: string,
  options?: { recursive?: boolean; force?: boolean }
): Promise<void> {
  // Use symlink check since we're removing an existing file/directory
  const validatedPath = validatePathWithSymlinkCheck(filePath);
  return fs.rm(validatedPath, options);
}

/**
 * Wrapper around fs.unlink that validates path first
 * Uses symlink-aware validation to prevent unlinking files outside allowed paths
 */
export async function unlink(filePath: string): Promise<void> {
  // Use symlink check since we're unlinking an existing file
  const validatedPath = validatePathWithSymlinkCheck(filePath);
  return fs.unlink(validatedPath);
}

/**
 * Wrapper around fs.copyFile that validates both paths first
 * Uses symlink-aware validation for source, and parent validation for destination
 */
export async function copyFile(src: string, dest: string, mode?: number): Promise<void> {
  // Source must exist, use symlink check
  const validatedSrc = validatePathWithSymlinkCheck(src);
  // Destination may not exist, validate with parent fallback
  const validatedDest = validatePathWithSymlinkCheck(dest, { requireExists: false });
  return fs.copyFile(validatedSrc, validatedDest, mode);
}

/**
 * Wrapper around fs.appendFile that validates path first
 * Uses symlink-aware validation for existing files, or validates parent for new files
 */
export async function appendFile(
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding
): Promise<void> {
  // File may or may not exist, use symlink check with parent fallback
  const validatedPath = validatePathWithSymlinkCheck(filePath, { requireExists: false });
  return fs.appendFile(validatedPath, data, encoding);
}

/**
 * Wrapper around fs.rename that validates both paths first
 * Uses symlink-aware validation for source, and parent validation for destination
 */
export async function rename(oldPath: string, newPath: string): Promise<void> {
  // Source must exist, use symlink check
  const validatedOldPath = validatePathWithSymlinkCheck(oldPath);
  // Destination may not exist, validate with parent fallback
  const validatedNewPath = validatePathWithSymlinkCheck(newPath, { requireExists: false });
  return fs.rename(validatedOldPath, validatedNewPath);
}

/**
 * Wrapper around fs.lstat that validates path first
 * Returns file stats without following symbolic links
 *
 * Note: This intentionally uses validatePath (not validatePathWithSymlinkCheck)
 * because lstat is used to inspect symlinks themselves. Using realpathSync
 * would defeat the purpose of lstat.
 */
export async function lstat(filePath: string): Promise<any> {
  // Use basic validation since lstat is for inspecting symlinks
  const validatedPath = validatePath(filePath);
  return fs.lstat(validatedPath);
}

/**
 * Wrapper around path.join that returns resolved path
 * Does NOT validate - use this for path construction, then pass to other operations
 */
export function joinPath(...pathSegments: string[]): string {
  return path.join(...pathSegments);
}

/**
 * Wrapper around path.resolve that returns resolved path
 * Does NOT validate - use this for path construction, then pass to other operations
 */
export function resolvePath(...pathSegments: string[]): string {
  return path.resolve(...pathSegments);
}
