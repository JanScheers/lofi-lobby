#!/usr/bin/env node

/**
 * update-game.mjs
 * 
 * Updates or adds a game to the portfolio by extracting a zip file
 * and updating the games.json metadata.
 * 
 * Usage:
 *   npm run update-game -- <game-id> <path-to-zip> [--version <version>] [--dry-run]
 * 
 * Examples:
 *   npm run update-game -- my-game ./incoming/my-game-v1.0.0.zip
 *   npm run update-game -- my-game ./incoming/my-game.zip --version 1.2.0
 *   npm run update-game -- my-game ./incoming/my-game.zip --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT_DIR, 'public', 'play');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'public', 'downloads');
const THUMBNAILS_DIR = path.join(ROOT_DIR, 'public', 'images', 'games');
const METADATA_FILE = path.join(ROOT_DIR, 'src', 'data', 'games.json');

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
  // Try to extract version from patterns like: game-v1.0.0.zip, game_1.2.3.zip, game-1.0.zip
  const patterns = [
    /[_-]v?(\d+\.\d+\.\d+)\.zip$/i,
    /[_-]v?(\d+\.\d+)\.zip$/i,
    /[_-]v?(\d+)\.zip$/i,
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
    const content = fs.readFileSync(METADATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    error(`Failed to read metadata file: ${err.message}`);
  }
}

function writeMetadata(data) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2) + '\n');
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
    log('Usage: npm run update-game -- <game-id> <path-to-zip> [--version <version>] [--dry-run]', 'yellow');
    log('');
    log('Examples:', 'cyan');
    log('  npm run update-game -- my-game ./incoming/my-game-v1.0.0.zip');
    log('  npm run update-game -- my-game ./incoming/my-game.zip --version 1.2.0');
    log('  npm run update-game -- my-game ./incoming/my-game.zip --dry-run');
    process.exit(1);
  }

  if (dryRun) {
    log('DRY RUN MODE - No changes will be made', 'yellow');
    log('');
  }

  // Validate zip file exists
  const absoluteZipPath = path.resolve(zipPath);
  if (!fs.existsSync(absoluteZipPath)) {
    error(`Zip file not found: ${absoluteZipPath}`);
  }

  log(`Processing game: ${gameId}`, 'cyan');
  log(`Zip file: ${absoluteZipPath}`, 'cyan');

  // Load and validate zip
  let zip;
  try {
    zip = new AdmZip(absoluteZipPath);
  } catch (err) {
    error(`Failed to open zip file: ${err.message}`);
  }

  const unpackStructure = getUnpackStructure(zip);
  log(`Zip structure: ${unpackStructure.flatten ? `Single folder "${unpackStructure.rootFolder}" (will flatten)` : 'Root level'}`, 'green');

  // Determine version
  let finalVersion = version;
  if (!finalVersion) {
    finalVersion = extractVersionFromFilename(path.basename(zipPath));
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
    log(`  - Extract ${zip.getEntries().length} files from zip`);
    log(`  - Prompt for which root HTML file is the game entry point`);
    log(`  - Try to copy an image from zip to public/images/games/ as thumbnail`);
    log(`  - Copy zip to: ${path.join(DOWNLOADS_DIR, `${gameId}.zip`)}`);
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

  // Extract zip
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
    // Clean up on failure
    if (fs.existsSync(gameDir)) {
      fs.rmSync(gameDir, { recursive: true });
    }
    error(`Failed to extract zip: ${err.message}`);
  }

  const rootHtmlFiles = getRootHtmlFiles(gameDir);
  if (rootHtmlFiles.length === 0) {
    if (fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true });
    error('No HTML files found at the root of the extracted game. Add at least one .html file at the root of the zip.');
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

  // Copy zip to downloads
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  const downloadPath = path.join(DOWNLOADS_DIR, `${gameId}.zip`);
  fs.copyFileSync(absoluteZipPath, downloadPath);
  log(`Copied zip to: ${downloadPath}`, 'green');

  // Update metadata
  const today = new Date().toISOString().split('T')[0];
  
  if (isNewGame) {
    // Prompt for game details
    log('', 'reset');
    log('Please provide game details:', 'cyan');
    
    const name = await prompt(`Game name [${gameId}]: `) || gameId;
    const type = await prompt('Type (html/renpy/rpgmaker/download-only) [html]: ') || 'html';
    const description = await prompt('Description: ') || `A ${type} game.`;

    const newGame = {
      id: gameId,
      name,
      type,
      version: finalVersion,
      description,
      thumbnail: thumbnailPath,
      playable: type !== 'download-only',
      downloadUrl: `/downloads/${gameId}.zip`,
      lastUpdated: today,
      entryPoint,
    };

    metadata.games.push(newGame);
    log(`Added new game: ${name}`, 'green');
  } else {
    // Update existing game
    metadata.games[existingGameIndex].version = finalVersion;
    metadata.games[existingGameIndex].lastUpdated = today;
    metadata.games[existingGameIndex].downloadUrl = `/downloads/${gameId}.zip`;
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
