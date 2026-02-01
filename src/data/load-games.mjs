/**
 * Load games catalog from games.yaml at build time.
 * Used by Astro pages; scripts read/write games.yaml directly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_FILE = path.join(__dirname, 'games.yaml');

function load() {
  if (!fs.existsSync(GAMES_FILE)) {
    return { games: [] };
  }
  const raw = fs.readFileSync(GAMES_FILE, 'utf-8');
  return yaml.parse(raw) || { games: [] };
}

export const gamesData = load();
