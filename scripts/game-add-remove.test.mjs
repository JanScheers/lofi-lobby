/**
 * Tests adding and removing the example game via update-game and remove-game scripts.
 * Run: node --test scripts/game-add-remove.test.mjs
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test } from 'node:test';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'public', 'play');
const DOWNLOADS_DIR = path.join(ROOT, 'public', 'downloads');
const THUMBNAILS_DIR = path.join(ROOT, 'public', 'images', 'games');
const METADATA_FILE = path.join(ROOT, 'src', 'data', 'games.json');
const GAME_ID = 'example-game';
const ZIP_PATH = path.join(ROOT, 'example-game.zip');

function runUpdateGame() {
  const cmd = `node scripts/update-game.mjs ${GAME_ID} "${ZIP_PATH}" --version 1.0.0`;
  execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GAME_NAME: 'Example Game',
      GAME_TYPE: 'html',
      GAME_DESCRIPTION: 'A sample game for testing.',
    },
  });
}

function runRemoveGame() {
  execSync(`node scripts/remove-game.mjs ${GAME_ID}`, {
    cwd: ROOT,
    encoding: 'utf-8',
  });
}

function readMetadata() {
  return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
}

function gameDir() {
  return path.join(GAMES_DIR, GAME_ID);
}

function downloadZip() {
  return path.join(DOWNLOADS_DIR, `${GAME_ID}.zip`);
}

test('add example game then remove it', async () => {
  // Ensure clean state: remove if already present from a previous failed run
  const metaBefore = readMetadata();
  const hadGame = metaBefore.games.some((g) => g.id === GAME_ID);
  if (hadGame) {
    runRemoveGame();
  }

  runUpdateGame();

  assert.ok(fs.existsSync(gameDir()), 'public/play/example-game/ should exist');
  assert.ok(
    fs.existsSync(path.join(gameDir(), 'index.html')),
    'index.html should exist in game dir'
  );
  assert.ok(fs.existsSync(downloadZip()), 'public/downloads/example-game.zip should exist');

  const thumbPath = path.join(THUMBNAILS_DIR, `${GAME_ID}.png`);
  assert.ok(fs.existsSync(thumbPath), 'thumbnail public/images/games/example-game.png should exist');

  const metaAfterAdd = readMetadata();
  const entry = metaAfterAdd.games.find((g) => g.id === GAME_ID);
  assert.ok(entry, 'games.json should contain example-game');
  assert.strictEqual(entry.entryPoint, 'index.html');
  assert.strictEqual(entry.version, '1.0.0');

  runRemoveGame();

  assert.ok(!fs.existsSync(gameDir()), 'public/play/example-game/ should be removed');
  assert.ok(!fs.existsSync(downloadZip()), 'public/downloads/example-game.zip should be removed');
  assert.ok(!fs.existsSync(thumbPath), 'thumbnail should be removed');

  const metaAfterRemove = readMetadata();
  const stillThere = metaAfterRemove.games.some((g) => g.id === GAME_ID);
  assert.ok(!stillThere, 'games.json should no longer contain example-game');
});
