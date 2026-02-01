#!/usr/bin/env node

/**
 * add-game.mjs
 * 
 * Adds or updates a game in the portfolio by extracting a zip file or copying
 * a directory, then updating the games.yaml metadata.
 * 
 * Usage:
 *   npm run add-game -- <game-id> <path-to-zip-or-dir> [--version <version>] [--dry-run]
 * 
 * Examples:
 *   npm run add-game -- my-game ./incoming/my-game-v1.0.0.zip
 *   npm run add-game -- my-game ./incoming/WTS
 *   npm run add-game -- my-game ./incoming/my-game.zip --version 1.2.0 --dry-run
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';
import readline from 'readline';
import yaml from 'yaml';
import {
  getSdkRoot,
  getRenpyLauncher,
  getRenpyCwd,
  hasWebSupport,
  findRenpyProjectRoot,
  findRenpyDistributionRoot,
  dirContainsRpy,
  dirContainsRpyc,
} from './renpy-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT_DIR, 'public', 'play');
const THUMBNAILS_DIR = path.join(ROOT_DIR, 'public', 'images', 'games');
const METADATA_FILE = path.join(ROOT_DIR, 'src', 'data', 'games.yaml');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const THUMBNAIL_NAME_HINTS = ['thumbnail', 'icon', 'screenshot', 'preview', 'banner', 'cover', 'logo', 'splash', 'poster', 'title', 'keyart'];

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  console.error(`${colors.red}Error: ${message}${colors.reset}`);
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    gameId: null,
    zipPath: null,
    version: null,
    dryRun: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--version' && i + 1 < args.length) {
      parsed.version = args[++i];
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  parsed.gameId = positional[0];
  parsed.zipPath = positional[1];

  return parsed;
}

function extractVersionFromFilename(filename) {
  // Try to extract version from patterns like: game-v1.0.0.zip, game_1.2.3.zip, game-1.0.zip, WTS-1.49.2
  const patterns = [
    /[_-]v?(\d+\.\d+\.\d+)\.zip$/i,
    /[_-]v?(\d+\.\d+)\.\d*\.zip$/i,
    /[_-]v?(\d+)\.zip$/i,
    /[_-]v?(\d+\.\d+\.\d+)$/i,
    /[_-]v?(\d+\.\d+)$/i,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Determine how to unpack a directory: flatten from a single root folder, or use as-is.
 */
function getUnpackStructureFromDir(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return { flatten: false };
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1 && entries.length === 1) {
    return { flatten: true, rootFolder: dirs[0].name };
  }
  return { flatten: false };
}

/**
 * Check if directory would yield a Ren'Py project (game/ with .rpy anywhere) after copy.
 */
function dirWouldYieldRenpyProject(dirPath, unpackStructure) {
  const root = unpackStructure.flatten && unpackStructure.rootFolder
    ? path.join(dirPath, unpackStructure.rootFolder)
    : dirPath;
  const gameDir = path.join(root, 'game');
  if (!fs.existsSync(gameDir) || !fs.statSync(gameDir).isDirectory()) return false;
  return dirContainsRpy(gameDir);
}

/**
 * Check if directory would yield a Ren'Py PC distribution (game/ with .rpyc, no .rpy).
 */
function dirWouldYieldRenpyDistribution(dirPath, unpackStructure) {
  const root = unpackStructure.flatten && unpackStructure.rootFolder
    ? path.join(dirPath, unpackStructure.rootFolder)
    : dirPath;
  const gameDir = path.join(root, 'game');
  if (!fs.existsSync(gameDir) || !fs.statSync(gameDir).isDirectory()) return false;
  return dirContainsRpyc(gameDir) && !dirContainsRpy(gameDir);
}

/**
 * Check if zip would yield a Ren'Py project after extraction (for dry-run message).
 * Looks for game/*.rpy or single top-level dir containing game/*.rpy.
 */
function zipWouldYieldRenpyProject(zip, unpackStructure) {
  const entries = zip.getEntries();
  const hasGameRpy = (prefix) => {
    const prefixSlash = prefix ? `${prefix}/` : '';
    return entries.some((e) => {
      const name = e.entryName;
      if (!name.startsWith(prefixSlash)) return false;
      const rest = prefix ? name.slice(prefixSlash.length) : name;
      return rest.startsWith('game/') && rest.toLowerCase().endsWith('.rpy');
    });
  };
  if (unpackStructure.flatten && unpackStructure.rootFolder) {
    return hasGameRpy(unpackStructure.rootFolder);
  }
  if (hasGameRpy('')) return true;
  const topLevel = new Set();
  for (const e of entries) {
    const parts = e.entryName.split('/').filter(Boolean);
    if (parts.length >= 1) topLevel.add(parts[0]);
  }
  if (topLevel.size !== 1) return false;
  const root = [...topLevel][0];
  return hasGameRpy(root);
}

/**
 * Check if zip would yield a Ren'Py PC distribution (game/*.rpyc, no .rpy) after extraction.
 */
function zipWouldYieldRenpyDistribution(zip, unpackStructure) {
  const entries = zip.getEntries();
  const hasGameRpyc = (prefix) => {
    const prefixSlash = prefix ? `${prefix}/` : '';
    return entries.some((e) => {
      const name = e.entryName;
      if (!name.startsWith(prefixSlash)) return false;
      const rest = prefix ? name.slice(prefixSlash.length) : name;
      return rest.startsWith('game/') && rest.toLowerCase().endsWith('.rpyc');
    });
  };
  const hasGameRpy = (prefix) => {
    const prefixSlash = prefix ? `${prefix}/` : '';
    return entries.some((e) => {
      const name = e.entryName;
      if (!name.startsWith(prefixSlash)) return false;
      const rest = prefix ? name.slice(prefixSlash.length) : name;
      return rest.startsWith('game/') && rest.toLowerCase().endsWith('.rpy');
    });
  };
  const check = (prefix) => hasGameRpyc(prefix) && !hasGameRpy(prefix);
  if (unpackStructure.flatten && unpackStructure.rootFolder) {
    return check(unpackStructure.rootFolder);
  }
  if (check('')) return true;
  const topLevel = new Set();
  for (const e of entries) {
    const parts = e.entryName.split('/').filter(Boolean);
    if (parts.length >= 1) topLevel.add(parts[0]);
  }
  if (topLevel.size !== 1) return false;
  return check([...topLevel][0]);
}

/**
 * Ren'Py distribute (even for web) processes icon.ico when adding Windows files; invalid/truncated
 * .ico files cause IndexError in the SDK's change_icon.py. Temporarily hide project icons so
 * distribute skips icon processing; we only need the web output.
 */
function hideProjectIcons(projectPath) {
  const hidden = [];
  for (const name of ['icon.ico', 'icon.icns']) {
    const full = path.join(projectPath, name);
    const bak = full + '.bak';
    if (fs.existsSync(full)) {
      fs.renameSync(full, bak);
      hidden.push({ from: bak, to: full });
    }
  }
  return hidden;
}

function restoreProjectIcons(hidden) {
  for (const { from, to } of hidden) {
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
    }
  }
}

/**
 * Ensure update.pem exists in the Ren'Py project directory.
 * Ren'Py's distribute (web) expects this file for update signing; create a placeholder if missing.
 */
function ensureUpdatePem(projectPath) {
  const pemPath = path.join(projectPath, 'update.pem');
  if (fs.existsSync(pemPath)) return;
  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  fs.writeFileSync(pemPath, privateKey, 'utf-8');
}

/**
 * Copy directory contents from src to dest (dest must exist).
 */
function copyDirContents(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirContents(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Determine how to unpack the zip: flatten from a single root folder, or extract all.
 * Accepts any zip structure.
 */
function getUnpackStructure(zip) {
  const entries = zip.getEntries();
  const topLevel = new Set();
  for (const e of entries) {
    const parts = e.entryName.split('/').filter(Boolean);
    if (parts.length > 0) {
      topLevel.add(parts[0]);
    }
  }
  if (topLevel.size === 1) {
    const rootFolder = [...topLevel][0];
    return { flatten: true, rootFolder };
  }
  return { flatten: false };
}

function getRootHtmlFiles(gameDir) {
  if (!fs.existsSync(gameDir)) return [];
  return fs.readdirSync(gameDir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.html'))
    .map(d => d.name)
    .sort();
}

/**
 * If gameDir has no HTML at root but exactly one immediate subdirectory that contains
 * .html files, move that subdirectory's contents up to gameDir root (for Ren'Py web
 * builds that nest output one level deep).
 */
function flattenHtmlSubdirIfNeeded(gameDir) {
  if (getRootHtmlFiles(gameDir).length > 0) return;
  if (!fs.existsSync(gameDir)) return;
  const entries = fs.readdirSync(gameDir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const htmlContainingSubdirs = subdirs.filter((subName) => {
    const subPath = path.join(gameDir, subName);
    const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
    return subEntries.some(
      (e) => e.isFile() && e.name.toLowerCase().endsWith('.html')
    );
  });
  if (htmlContainingSubdirs.length !== 1) return;
  const subName = htmlContainingSubdirs[0];
  const subPath = path.join(gameDir, subName);
  const tmpFlat = path.join(os.tmpdir(), `renpy-flatten-${Date.now()}`);
  fs.mkdirSync(tmpFlat, { recursive: true });
  try {
    copyDirContents(subPath, tmpFlat);
    const toRemove = path.join(gameDir, subName);
    fs.rmSync(toRemove, { recursive: true });
    copyDirContents(tmpFlat, gameDir);
  } finally {
    if (fs.existsSync(tmpFlat)) fs.rmSync(tmpFlat, { recursive: true });
  }
}

/**
 * Find image files under dir (recursive). Prefer root-level; prefer names suggesting thumbnail/splash.
 * Returns { filePath, ext } for the best candidate, or null if none.
 */
function findThumbnailCandidate(gameDir) {
  const candidates = [];
  function walk(dir, isRoot = true) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(fullPath, false);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const relativePath = path.relative(gameDir, fullPath);
          const baseName = path.basename(e.name, ext).toLowerCase();
          let score = 0;
          if (isRoot) score += 100;
          for (const hint of THUMBNAIL_NAME_HINTS) {
            if (baseName.includes(hint)) {
              score += 50 - THUMBNAIL_NAME_HINTS.indexOf(hint);
              break;
            }
          }
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1000) score += 10;
            candidates.push({ filePath: fullPath, ext, score, size: stat.size });
          } catch (_) {}
        }
      }
    }
  }
  walk(gameDir);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || b.size - a.size);
  return { filePath: candidates[0].filePath, ext: candidates[0].ext };
}

function readMetadata() {
  try {
    if (!fs.existsSync(METADATA_FILE)) return { games: [] };
    const content = fs.readFileSync(METADATA_FILE, 'utf-8');
    return yaml.parse(content) || { games: [] };
  } catch (err) {
    error(`Failed to read metadata file: ${err.message}`);
  }
}

function writeMetadata(data) {
  try {
    fs.writeFileSync(METADATA_FILE, yaml.stringify(data, { indent: 2 }) + '\n');
  } catch (err) {
    error(`Failed to write metadata file: ${err.message}`);
  }
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const { gameId, zipPath, version, dryRun } = parseArgs(args);

  // Validate inputs
  if (!gameId || !zipPath) {
    log('Usage: npm run add-game -- <game-id> <path-to-zip-or-dir> [--version <version>] [--dry-run]', 'yellow');
    log('');
    log('Examples:', 'cyan');
    log('  npm run add-game -- my-game ./incoming/my-game-v1.0.0.zip');
    log('  npm run add-game -- wts ./incoming/WTS');
    log('  npm run add-game -- my-game ./incoming/my-game.zip --version 1.2.0 --dry-run');
    process.exit(1);
  }

  if (dryRun) {
    log('DRY RUN MODE - No changes will be made', 'yellow');
    log('');
  }

  const absoluteSourcePath = path.resolve(zipPath);
  if (!fs.existsSync(absoluteSourcePath)) {
    error(`Path not found: ${absoluteSourcePath}`);
  }

  const isSourceDir = fs.statSync(absoluteSourcePath).isDirectory();
  log(`Processing game: ${gameId}`, 'cyan');
  log(`Source: ${absoluteSourcePath} (${isSourceDir ? 'directory' : 'zip'})`, 'cyan');

  let unpackStructure;
  let sourceDirForCopy = null; // set when isSourceDir: the folder we copy from

  if (isSourceDir) {
    unpackStructure = getUnpackStructureFromDir(absoluteSourcePath);
    sourceDirForCopy = unpackStructure.flatten && unpackStructure.rootFolder
      ? path.join(absoluteSourcePath, unpackStructure.rootFolder)
      : absoluteSourcePath;
    log(`Directory structure: ${unpackStructure.flatten ? `Single folder "${unpackStructure.rootFolder}" (will flatten)` : 'Root level'}`, 'green');
  } else {
    let zip;
    try {
      zip = new AdmZip(absoluteSourcePath);
    } catch (err) {
      error(`Failed to open zip file: ${err.message}`);
    }
    unpackStructure = getUnpackStructure(zip);
    log(`Zip structure: ${unpackStructure.flatten ? `Single folder "${unpackStructure.rootFolder}" (will flatten)` : 'Root level'}`, 'green');
  }

  // Determine version
  let finalVersion = version;
  if (!finalVersion) {
    const nameForVersion = isSourceDir ? path.basename(sourceDirForCopy ?? absoluteSourcePath) : path.basename(zipPath);
    finalVersion = extractVersionFromFilename(nameForVersion);
  }
  if (!finalVersion) {
    if (dryRun) {
      finalVersion = '1.0.0';
      log('Would prompt for version (using 1.0.0 for dry run)', 'yellow');
    } else {
      finalVersion = await prompt('Enter version (e.g., 1.0.0): ');
      if (!finalVersion) {
        finalVersion = '1.0.0';
      }
    }
  }

  log(`Version: ${finalVersion}`, 'green');

  // Read metadata
  const metadata = readMetadata();
  const existingGameIndex = metadata.games.findIndex(g => g.id === gameId);
  const isNewGame = existingGameIndex === -1;

  if (isNewGame) {
    log(`New game detected. Will create entry for "${gameId}"`, 'yellow');
  } else {
    log(`Updating existing game: ${metadata.games[existingGameIndex].name}`, 'green');
  }

  // Prepare game directory
  const gameDir = path.join(GAMES_DIR, gameId);

  if (dryRun) {
    log('', 'reset');
    log('Would perform the following actions:', 'yellow');
    log(`  - ${isNewGame ? 'Create' : 'Clear and recreate'} directory: ${gameDir}`);
    if (isSourceDir) {
      log(`  - Copy directory ${sourceDirForCopy} to game dir`);
      if (dirWouldYieldRenpyProject(absoluteSourcePath, unpackStructure)) {
        log('  - Detect Ren\'Py project; would build to web (requires SDK + Renpyweb) then use web output as game content');
      } else if (dirWouldYieldRenpyDistribution(absoluteSourcePath, unpackStructure)) {
        log('  - Detect Ren\'Py PC distribution (compiled); would error: need project source (.rpy) or pre-built web zip');
      }
    } else {
      log(`  - Extract zip (${new AdmZip(absoluteSourcePath).getEntries().length} entries)`);
      if (zipWouldYieldRenpyProject(new AdmZip(absoluteSourcePath), unpackStructure)) {
        log('  - Detect Ren\'Py project; would build to web (requires SDK + Renpyweb) then use web output as game content');
      } else if (zipWouldYieldRenpyDistribution(new AdmZip(absoluteSourcePath), unpackStructure)) {
        log('  - Detect Ren\'Py PC distribution (compiled); would error: need project source (.rpy) or pre-built web zip');
      }
    }
    log(`  - Prompt for which root HTML file is the game entry point`);
    log(`  - Try to copy an image to public/images/games/ as thumbnail`);
    log(`  - Update metadata with version ${finalVersion} and entryPoint`);
    log('');
    log('Dry run complete. No changes were made.', 'green');
    return;
  }

  // Create/clear game directory
  if (fs.existsSync(gameDir)) {
    fs.rmSync(gameDir, { recursive: true });
    log(`Cleared existing directory: ${gameDir}`, 'yellow');
  }
  fs.mkdirSync(gameDir, { recursive: true });

  if (isSourceDir) {
    try {
      copyDirContents(sourceDirForCopy, gameDir);
      log(`Copied directory to: ${gameDir}`, 'green');
    } catch (err) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error(`Failed to copy directory: ${err.message}`);
    }
  } else {
    const zip = new AdmZip(absoluteSourcePath);
    try {
      if (unpackStructure.flatten && unpackStructure.rootFolder) {
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.entryName.startsWith(`${unpackStructure.rootFolder}/`)) {
            const relativePath = entry.entryName.slice(unpackStructure.rootFolder.length + 1);
            if (relativePath) {
              const targetPath = path.join(gameDir, relativePath);
              if (entry.isDirectory) {
                fs.mkdirSync(targetPath, { recursive: true });
              } else {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.writeFileSync(targetPath, entry.getData());
              }
            }
          }
        }
      } else {
        zip.extractAllTo(gameDir, true);
      }
      log(`Extracted to: ${gameDir}`, 'green');
    } catch (err) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error(`Failed to extract zip: ${err.message}`);
    }
  }

  let builtRenpy = false;
  const projectPath = findRenpyProjectRoot(gameDir);
  if (projectPath) {
    const sdkRoot = getSdkRoot();
    if (!sdkRoot) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error('Ren\'Py project detected but SDK not installed. Run: npm run install:renpy -- --web');
    }
    if (!hasWebSupport(sdkRoot)) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error('Ren\'Py project detected but Renpyweb not installed. Run: npm run install:renpy -- --web');
    }
    const launcher = getRenpyLauncher(sdkRoot);
    if (!launcher) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error('Ren\'Py launcher not found in SDK.');
    }
    const cwd = getRenpyCwd(sdkRoot, launcher);
    ensureUpdatePem(projectPath);
    const hiddenIcons = hideProjectIcons(projectPath);
    try {
      log('Building Ren\'Py project to web...', 'cyan');
      const args = [sdkRoot, 'distribute', '--package', 'web', projectPath].map((a) => `"${a}"`).join(' ');
      execSync(`"${launcher}" ${args}`, {
        cwd,
        encoding: 'utf-8',
        stdio: 'inherit',
        timeout: 300_000,
      });
    } catch (err) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error(`Ren'Py web build failed. Check SDK and Renpyweb, and build logs: ${err.message}`);
    } finally {
      restoreProjectIcons(hiddenIcons);
    }
    const projectParent = path.dirname(projectPath);
    const projectBaseName = path.basename(projectPath).replace(/\s+/g, '_').toLowerCase();
    const parentEntries = fs.readdirSync(projectParent);
    const distBaseDir = parentEntries.find(
      (e) => e.endsWith('-dists') && e.toLowerCase().startsWith(projectBaseName)
    );
    if (!distBaseDir) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error(`Ren'Py web build output not found under ${projectParent} (expected *-dists directory).`);
    }
    const distBase = path.join(projectParent, distBaseDir);
    const distEntries = fs.readdirSync(distBase);
    const webEntry = distEntries.find((e) => e.includes('web'));
    if (!webEntry) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error(`Ren'Py web build output (web folder or zip) not found under ${distBase}.`);
    }
    const webPath = path.join(distBase, webEntry);
    const webStat = fs.statSync(webPath);
    const tmpDir = path.join(os.tmpdir(), `renpy-web-${gameId}-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      if (webStat.isDirectory()) {
        copyDirContents(webPath, tmpDir);
      } else if (webEntry.toLowerCase().endsWith('.zip')) {
        const webZip = new AdmZip(webPath);
        webZip.extractAllTo(tmpDir, true);
      } else {
        if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
        fs.rmSync(tmpDir, { recursive: true });
        error(`Unexpected Ren'Py web build output: ${webPath}`);
      }
      fs.rmSync(gameDir, { recursive: true });
      fs.mkdirSync(gameDir, { recursive: true });
      copyDirContents(tmpDir, gameDir);
    } finally {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    }
    builtRenpy = true;
    log('Ren\'Py web build installed to game directory', 'green');
  }

  // Ren'Py web output may be one level deep (e.g. game-name-web/game-name/index.html)
  if (builtRenpy) {
    flattenHtmlSubdirIfNeeded(gameDir);
  }

  const rootHtmlFiles = getRootHtmlFiles(gameDir);
  if (rootHtmlFiles.length === 0) {
    const distRoot = findRenpyDistributionRoot(gameDir);
    if (distRoot) {
      if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
      error(
        'This looks like a Ren\'Py PC distribution (compiled game), not the project source. ' +
        'To host the game on the web we need either: (1) the Ren\'Py project with .rpy source files—then we can build for web automatically—or ' +
        '(2) a zip or folder that already contains the web build (HTML/JS files at the root). ' +
        'Install the Ren\'Py SDK and Renpyweb with: npm run install:renpy -- --web'
      );
    }
    error(
      'No HTML files found at the root of the extracted game. ' +
      'Add at least one .html file at the root of the zip or folder, or use a Ren\'Py project (with .rpy source) so we can build it for web. ' +
      `Game directory left in place for inspection: ${gameDir}`
    );
  }

  let entryPoint;
  if (rootHtmlFiles.length === 1) {
    entryPoint = rootHtmlFiles[0];
    log(`Using sole root HTML as entry: ${entryPoint}`, 'green');
  } else {
    log('', 'reset');
    log('Which HTML file at the root should be the game entry point?', 'cyan');
    rootHtmlFiles.forEach((name, i) => log(`  ${i + 1}. ${name}`));
    const raw = await prompt(`Enter number (1-${rootHtmlFiles.length}) or filename: `);
    const num = parseInt(raw, 10);
    if (Number.isInteger(num) && num >= 1 && num <= rootHtmlFiles.length) {
      entryPoint = rootHtmlFiles[num - 1];
    } else if (rootHtmlFiles.includes(raw)) {
      entryPoint = raw;
    } else {
      entryPoint = rootHtmlFiles[0];
      log(`Using first option: ${entryPoint}`, 'yellow');
    }
    log(`Entry point: ${entryPoint}`, 'green');
  }

  // Try to extract a thumbnail from the zip contents
  let thumbnailPath = `/images/games/${gameId}.png`;
  const thumbnailCandidate = findThumbnailCandidate(gameDir);
  if (thumbnailCandidate) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
    const destPath = path.join(THUMBNAILS_DIR, `${gameId}${thumbnailCandidate.ext}`);
    fs.copyFileSync(thumbnailCandidate.filePath, destPath);
    thumbnailPath = `/images/games/${gameId}${thumbnailCandidate.ext}`;
    log(`Thumbnail copied from zip: ${path.basename(thumbnailCandidate.filePath)} → public/images/games/${gameId}${thumbnailCandidate.ext}`, 'green');
  } else {
    log('No image found in zip for thumbnail. Add one manually to public/images/games/' + gameId + '.png', 'yellow');
  }

  // Update metadata
  const today = new Date().toISOString().split('T')[0];
  
  if (isNewGame) {
    // Prompt for game details (or use env for non-interactive e.g. tests)
    let name, type, description;
    if (process.env.GAME_NAME != null || process.env.GAME_TYPE != null || process.env.GAME_DESCRIPTION != null) {
      name = process.env.GAME_NAME || gameId;
      type = process.env.GAME_TYPE || (builtRenpy ? 'renpy' : 'html');
      description = process.env.GAME_DESCRIPTION || `A ${type} game.`;
      log(`Using game details from env: ${name}, ${type}`, 'cyan');
    } else {
      log('', 'reset');
      log('Please provide game details:', 'cyan');
      name = await prompt(`Game name [${gameId}]: `) || gameId;
      const typeDefault = builtRenpy ? 'renpy' : 'html';
      type = await prompt(`Type (html/renpy/rpgmaker/download-only) [${typeDefault}]: `) || typeDefault;
      description = await prompt('Description: ') || `A ${type} game.`;
    }

    const newGame = {
      id: gameId,
      name,
      type,
      version: finalVersion,
      description,
      thumbnail: thumbnailPath,
      playable: type !== 'download-only',
      lastUpdated: today,
      entryPoint,
    };

    metadata.games.push(newGame);
    log(`Added new game: ${name}`, 'green');
  } else {
    // Update existing game
    metadata.games[existingGameIndex].version = finalVersion;
    metadata.games[existingGameIndex].lastUpdated = today;
    metadata.games[existingGameIndex].entryPoint = entryPoint;
    if (thumbnailCandidate) {
      metadata.games[existingGameIndex].thumbnail = thumbnailPath;
    }
    log(`Updated game metadata`, 'green');
  }

  writeMetadata(metadata);
  log(`Saved metadata to: ${METADATA_FILE}`, 'green');

  log('', 'reset');
  log('========================================', 'green');
  log(`Game "${gameId}" updated successfully!`, 'green');
  log('========================================', 'green');
  log('');
  log('Next steps:', 'cyan');
  if (!thumbnailCandidate) {
    log('  1. Add a thumbnail image to: public/images/games/' + gameId + '.png');
  }
  log('  ' + (thumbnailCandidate ? '1' : '2') + '. Game is playable at: /play/' + gameId + '/' + (metadata.games.find(g => g.id === gameId)?.entryPoint ?? entryPoint));
  log('  ' + (thumbnailCandidate ? '2' : '3') + '. Run "npm run build" to rebuild the site');
  log('  ' + (thumbnailCandidate ? '3' : '4') + '. Deploy the updated site');
}

main().catch((err) => {
  error(err.message);
});
