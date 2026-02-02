/**
 * renpy-utils.mjs
 *
 * Shared helpers for Ren'Py SDK: SDK path, launcher, cwd, web support,
 * and detection of a Ren'Py project directory.
 * Used by add-game.mjs and install-renpy.test.mjs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const VENDOR_RENPY = path.join(ROOT_DIR, 'vendor', 'renpy');
const DEFAULT_VERSION = process.env.RENPY_VERSION || '8.5.2';

/**
 * @param {string} [version] - Ren'Py version (default: RENPY_VERSION or 8.5.2)
 * @returns {string | null} Path to SDK root, or null if not installed
 */
export function getSdkRoot(version = DEFAULT_VERSION) {
  const dir = path.join(VENDOR_RENPY, `renpy-${version}`);
  try {
    fs.accessSync(dir);
    return dir;
  } catch {
    return null;
  }
}

/**
 * @param {string} sdkRoot
 * @returns {boolean}
 */
export function hasWebSupport(sdkRoot) {
  const webDir = path.join(sdkRoot, 'web');
  try {
    fs.accessSync(webDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} sdkRoot
 * @returns {string | null} Path to renpy launcher (renpy.sh, renpy.exe, or renpy.app on darwin)
 */
export function getRenpyLauncher(sdkRoot) {
  const platform = process.platform;
  if (platform === 'win32') {
    const exe = path.join(sdkRoot, 'renpy.exe');
    try {
      fs.accessSync(exe);
      return exe;
    } catch {
      return null;
    }
  }
  if (platform === 'darwin') {
    const appRenpy = path.join(sdkRoot, 'renpy.app', 'Contents', 'MacOS', 'renpy');
    try {
      fs.accessSync(appRenpy);
      return appRenpy;
    } catch {
      const sh = path.join(sdkRoot, 'renpy.sh');
      try {
        fs.accessSync(sh);
        return sh;
      } catch {
        return null;
      }
    }
  }
  const sh = path.join(sdkRoot, 'renpy.sh');
  try {
    fs.accessSync(sh);
    return sh;
  } catch {
    return null;
  }
}

/**
 * Working directory when invoking the launcher (Mac app must run from its MacOS dir).
 * @param {string} sdkRoot
 * @param {string | null} launcher
 * @returns {string}
 */
export function getRenpyCwd(sdkRoot, launcher) {
  if (process.platform === 'darwin' && launcher?.includes('renpy.app')) {
    return path.dirname(launcher);
  }
  return sdkRoot;
}

/**
 * Recursively check if a directory contains at least one .rpy file.
 * Exported for use in add-game.mjs (dir-would-yield checks).
 * @param {string} dir
 * @returns {boolean}
 */
export function dirContainsRpy(dir) {
  if (!fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith('.rpy')) return true;
    if (e.isDirectory() && dirContainsRpy(full)) return true;
  }
  return false;
}

/**
 * Check if dir contains game/ with at least one .rpy file (anywhere under game/).
 * @param {string} dir
 * @returns {boolean}
 */
function dirHasRenpyGame(dir) {
  const gameDir = path.join(dir, 'game');
  if (!fs.existsSync(gameDir) || !fs.statSync(gameDir).isDirectory()) return false;
  return dirContainsRpy(gameDir);
}

/**
 * Recursively check if a directory contains at least one .rpyc file.
 * Exported for use in add-game.mjs (dir-would-yield checks).
 * @param {string} dir
 * @returns {boolean}
 */
export function dirContainsRpyc(dir) {
  if (!fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith('.rpyc')) return true;
    if (e.isDirectory() && dirContainsRpyc(full)) return true;
  }
  return false;
}

/**
 * Check if dir contains game/ with .rpyc (compiled) but no .rpy (source).
 * Such a directory is a Ren'Py PC distribution; we cannot build for web from it.
 * @param {string} dir
 * @returns {boolean}
 */
function dirHasRenpyDistribution(dir) {
  const gameDir = path.join(dir, 'game');
  if (!fs.existsSync(gameDir) || !fs.statSync(gameDir).isDirectory()) return false;
  const hasRpyc = dirContainsRpyc(gameDir);
  const hasRpy = dirContainsRpy(gameDir);
  return hasRpyc && !hasRpy;
}

/**
 * Find the Ren'Py project root under gameDir (either gameDir itself or its single directory child).
 * @param {string} gameDir - e.g. play/<gameId>
 * @returns {string | null} Project root path, or null if not a Ren'Py project
 */
export function findRenpyProjectRoot(gameDir) {
  if (!fs.existsSync(gameDir)) return null;
  if (dirHasRenpyGame(gameDir)) return gameDir;
  const entries = fs.readdirSync(gameDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) {
    const child = path.join(gameDir, dirs[0].name);
    if (dirHasRenpyGame(child)) return child;
  }
  return null;
}

/**
 * Find a Ren'Py distribution root (game/ with .rpyc, no .rpy) under gameDir.
 * Used to give a clear error when the user provides a PC build zip instead of source.
 * @param {string} gameDir - e.g. play/<gameId>
 * @returns {string | null} Path to the distribution root, or null
 */
export function findRenpyDistributionRoot(gameDir) {
  if (!fs.existsSync(gameDir)) return null;
  if (dirHasRenpyDistribution(gameDir)) return gameDir;
  const entries = fs.readdirSync(gameDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) {
    const child = path.join(gameDir, dirs[0].name);
    if (dirHasRenpyDistribution(child)) return child;
  }
  return null;
}
