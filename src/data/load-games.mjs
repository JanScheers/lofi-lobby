/**
 * Load games catalog from games.yaml at build time.
 * Used by Astro pages; scripts read/write games.yaml directly.
 * Resolve from project root (cwd) so the file is found in both dev and build;
 * when Vite bundles for build, __dirname can point into dist/ and miss the file.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const projectRoot = process.cwd();
const GAMES_FILE = path.join(projectRoot, 'src', 'data', 'games.yaml');

function load() {
  if (!fs.existsSync(GAMES_FILE)) {
    return { games: [] };
  }
  const raw = fs.readFileSync(GAMES_FILE, 'utf-8');
  return yaml.parse(raw) || { games: [] };
}

export const gamesData = load();
