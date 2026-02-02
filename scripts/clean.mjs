#!/usr/bin/env node

/**
 * clean.mjs
 *
 * Removes all generated and game-related output, leaving the repo in a
 * minimal state. The incoming/ folder is never touched (incoming zips
 * stay for re-adding games).
 *
 * Removes:
 *   - dist/ (Astro build output)
 *   - .astro/ (Astro cache)
 *   - play/ (extracted games)
 *   - public/images/ (game thumbnails)
 *   - src/data/games.yaml → reset to games: []
 *   - vendor/renpy/ (Ren'Py SDK, if present)
 *
 * Usage:
 *   npm run clean
 *   npm run clean -- --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PATHS_TO_REMOVE = [
  path.join(ROOT_DIR, 'dist'),
  path.join(ROOT_DIR, '.astro'),
  path.join(ROOT_DIR, 'play'),
  path.join(ROOT_DIR, 'public', 'images'),
  path.join(ROOT_DIR, 'vendor', 'renpy'),
];

const METADATA_FILE = path.join(ROOT_DIR, 'src', 'data', 'games.yaml');
const EMPTY_METADATA = { games: [] };

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

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    log('DRY RUN – no files or dirs will be removed', 'yellow');
    log('');
  }

  for (const dir of PATHS_TO_REMOVE) {
    if (fs.existsSync(dir)) {
      if (dryRun) {
        log(`Would remove: ${path.relative(ROOT_DIR, dir)}`, 'cyan');
      } else {
        fs.rmSync(dir, { recursive: true });
        log(`Removed: ${path.relative(ROOT_DIR, dir)}`, 'green');
      }
    }
  }

  if (fs.existsSync(METADATA_FILE)) {
    if (dryRun) {
      log(`Would reset: ${path.relative(ROOT_DIR, METADATA_FILE)} to games: []`, 'cyan');
    } else {
      fs.writeFileSync(METADATA_FILE, yaml.stringify(EMPTY_METADATA, { indent: 2 }) + '\n');
      log(`Reset: ${path.relative(ROOT_DIR, METADATA_FILE)}`, 'green');
    }
  }

  log('');
  log('Clean complete. incoming/ was not modified.', 'green');
}

main();
