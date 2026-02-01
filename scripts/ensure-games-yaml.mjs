#!/usr/bin/env node
/**
 * Ensures src/data/games.yaml exists: copy from example, or migrate from games.json.
 * Run from project root (e.g. postinstall).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const YAML_FILE = path.join(ROOT, 'src', 'data', 'games.yaml');
const YAML_EXAMPLE = path.join(ROOT, 'src', 'data', 'games.yaml.example');
const JSON_FILE = path.join(ROOT, 'src', 'data', 'games.json');

if (fs.existsSync(YAML_FILE)) {
  process.exit(0);
}

if (fs.existsSync(JSON_FILE)) {
  const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
  fs.writeFileSync(YAML_FILE, yaml.stringify(data, { indent: 2 }) + '\n');
  console.log('Migrated src/data/games.json → src/data/games.yaml');
  process.exit(0);
}

if (fs.existsSync(YAML_EXAMPLE)) {
  fs.copyFileSync(YAML_EXAMPLE, YAML_FILE);
}
