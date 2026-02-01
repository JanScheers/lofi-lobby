#!/usr/bin/env node

/**
 * remove-game.mjs
 *
 * Removes a game from the portfolio: deletes extracted files, the download
 * copy in public/downloads/, the thumbnail, and the metadata entry. The
 * original zip file you used with add-game is never touched.
 *
 * Usage:
 *   npm run remove-game -- <game-id> [--dry-run]
 *
 * Examples:
 *   npm run remove-game -- my-game
 *   npm run remove-game -- my-game --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT_DIR, 'public', 'play');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'public', 'downloads');
const THUMBNAILS_DIR = path.join(ROOT_DIR, 'public', 'images', 'games');
const METADATA_FILE = path.join(ROOT_DIR, 'src', 'data', 'games.json');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
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
  const gameId = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  return { gameId, dryRun };
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

function main() {
  const args = process.argv.slice(2);
  const { gameId, dryRun } = parseArgs(args);

  if (!gameId) {
    log('Usage: npm run remove-game -- <game-id> [--dry-run]', 'yellow');
    log('');
    log('Examples:', 'cyan');
    log('  npm run remove-game -- my-game');
    log('  npm run remove-game -- my-game --dry-run');
    process.exit(1);
  }

  if (dryRun) {
    log('DRY RUN MODE - No changes will be made', 'yellow');
    log('');
  }

  const metadata = readMetadata();
  const index = metadata.games.findIndex((g) => g.id === gameId);
  if (index === -1) {
    error(`Game not found: ${gameId}`);
  }

  const game = metadata.games[index];
  log(`Removing game: ${game.name} (${gameId})`, 'cyan');

  const gameDir = path.join(GAMES_DIR, gameId);
  const downloadZip = path.join(DOWNLOADS_DIR, `${gameId}.zip`);
  const thumbnailPath = game.thumbnail
    ? path.join(ROOT_DIR, 'public', game.thumbnail.replace(/^\//, ''))
    : path.join(THUMBNAILS_DIR, `${gameId}.png`);

  if (dryRun) {
    log('', 'reset');
    log('Would remove:', 'yellow');
    if (fs.existsSync(gameDir)) log(`  - ${gameDir}`);
    if (fs.existsSync(downloadZip)) log(`  - ${downloadZip}`);
    if (fs.existsSync(thumbnailPath)) log(`  - ${thumbnailPath}`);
    log(`  - metadata entry for "${gameId}"`);
    log('');
    log('Dry run complete. No changes were made.', 'green');
    return;
  }

  if (fs.existsSync(gameDir)) {
    fs.rmSync(gameDir, { recursive: true });
    log(`Removed: ${gameDir}`, 'green');
  }
  if (fs.existsSync(downloadZip)) {
    fs.unlinkSync(downloadZip);
    log(`Removed: ${downloadZip}`, 'green');
  }
  if (fs.existsSync(thumbnailPath)) {
    fs.unlinkSync(thumbnailPath);
    log(`Removed: ${thumbnailPath}`, 'green');
  }

  metadata.games.splice(index, 1);
  writeMetadata(metadata);
  log(`Removed "${gameId}" from ${METADATA_FILE}`, 'green');

  log('', 'reset');
  log('========================================', 'green');
  log(`Game "${gameId}" removed. Original zip was not touched.`, 'green');
  log('========================================', 'green');
}

main();
