#!/usr/bin/env node

/**
 * add-example-game.mjs
 *
 * Adds the example game from example-game.zip with the same metadata as the test.
 * Usage: npm run add-example-game
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ZIP_PATH = path.join(ROOT, 'example-game.zip');

execSync(`node scripts/add-game.mjs example-game "${ZIP_PATH}" --version 1.0.0`, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    GAME_NAME: 'Example Game',
    GAME_TYPE: 'html',
    GAME_DESCRIPTION: 'A sample game for testing.',
  },
});
