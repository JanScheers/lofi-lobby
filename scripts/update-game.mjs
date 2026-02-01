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
const GAMES_DIR = path.join(ROOT_DIR, 'public', 'games');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'public', 'downloads');
const METADATA_FILE = path.join(ROOT_DIR, 'src', 'data', 'games.json');

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

function validateZipStructure(zip) {
  const entries = zip.getEntries();
  
  // Check for index.html at root
  const rootIndex = entries.find(e => e.entryName === 'index.html');
  if (rootIndex) {
    return { valid: true, flatten: false };
  }

  // Check for single root folder containing index.html
  const folders = new Set();
  entries.forEach(e => {
    const parts = e.entryName.split('/');
    if (parts.length > 1 && parts[0]) {
      folders.add(parts[0]);
    }
  });

  if (folders.size === 1) {
    const rootFolder = [...folders][0];
    const nestedIndex = entries.find(e => e.entryName === `${rootFolder}/index.html`);
    if (nestedIndex) {
      return { valid: true, flatten: true, rootFolder };
    }
  }

  return { valid: false };
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

  const validation = validateZipStructure(zip);
  if (!validation.valid) {
    error('Invalid zip structure. The zip must contain index.html at the root OR have a single folder containing index.html.');
  }

  log(`Zip structure: ${validation.flatten ? `Single folder "${validation.rootFolder}" (will flatten)` : 'Root level'}`, 'green');

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
    log(`  - Copy zip to: ${path.join(DOWNLOADS_DIR, `${gameId}.zip`)}`);
    log(`  - Update metadata with version ${finalVersion}`);
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
    if (validation.flatten && validation.rootFolder) {
      // Extract only contents of the root folder
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.entryName.startsWith(`${validation.rootFolder}/`)) {
          const relativePath = entry.entryName.slice(validation.rootFolder.length + 1);
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
      thumbnail: `/images/games/${gameId}.png`,
      playable: type !== 'download-only',
      downloadUrl: `/downloads/${gameId}.zip`,
      lastUpdated: today,
    };

    metadata.games.push(newGame);
    log(`Added new game: ${name}`, 'green');
  } else {
    // Update existing game
    metadata.games[existingGameIndex].version = finalVersion;
    metadata.games[existingGameIndex].lastUpdated = today;
    metadata.games[existingGameIndex].downloadUrl = `/downloads/${gameId}.zip`;
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
  log('  1. Add a thumbnail image to: public/images/games/' + gameId + '.png');
  log('  2. Run "npm run build" to rebuild the site');
  log('  3. Deploy the updated site');
}

main().catch((err) => {
  error(err.message);
});
