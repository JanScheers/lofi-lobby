#!/usr/bin/env node

/**
 * install-renpy.mjs
 *
 * Downloads and extracts the Ren'Py SDK (and optionally Renpyweb for web builds)
 * into vendor/renpy so it can be used to build games for web or other platforms.
 *
 * Usage:
 *   npm run install:renpy [-- --force] [-- --web]
 *
 * Environment:
 *   RENPY_VERSION  – Ren'Py version (default: 8.5.2)
 *   INSTALL_RENPY  – when set, postinstall runs this script
 *
 * Examples:
 *   npm run install:renpy
 *   npm run install:renpy -- --force --web
 *   RENPY_VERSION=8.4.0 npm run install:renpy
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const VENDOR_RENPY = path.join(ROOT_DIR, 'vendor', 'renpy');

const DEFAULT_VERSION = '8.5.2';
const BASE_URL = 'https://www.renpy.org/dl';

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
  const parsed = { force: false, web: false };
  for (const arg of args) {
    if (arg === '--force') parsed.force = true;
    if (arg === '--web') parsed.web = true;
  }
  return parsed;
}

function getPlatformConfig(platform) {
  const configs = {
    linux: { ext: 'tar.bz2', format: 'tar.bz2' },
    darwin: { ext: 'dmg', format: 'dmg' },
    win32: { ext: 'zip', format: 'zip' },
  };
  const c = configs[platform];
  if (!c) error(`Unsupported platform: ${platform}. Supported: linux, darwin, win32.`);
  return c;
}

function sdkDir(version) {
  return path.join(VENDOR_RENPY, `renpy-${version}`);
}

async function download(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) error(`Download failed: ${res.status} ${res.statusText} – ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
  return destPath;
}

async function extractTarBz2(archivePath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  execSync(`tar xjf "${archivePath}" -C "${outDir}"`, { stdio: 'inherit' });
}

async function extractZip(archivePath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(outDir, true);
}

async function extractDmg(archivePath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const mountPoint = path.join(outDir, 'mnt');
  await fs.mkdir(mountPoint, { recursive: true });
  try {
    execSync(`hdiutil attach "${archivePath}" -mountpoint "${mountPoint}" -nobrowse -quiet`, {
      stdio: 'inherit',
    });
    const entries = await fs.readdir(mountPoint);
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const src = path.join(mountPoint, name);
      const dest = path.join(outDir, name);
      await fs.cp(src, dest, { recursive: true });
    }
  } finally {
    try {
      execSync(`hdiutil detach "${mountPoint}" -quiet`, { stdio: 'inherit' });
    } catch (_) {
      // ignore detach errors
    }
    await fs.rm(mountPoint, { recursive: true, force: true });
  }
}

async function extractSdk(archivePath, format, outDir) {
  if (format === 'tar.bz2') await extractTarBz2(archivePath, outDir);
  else if (format === 'zip') await extractZip(archivePath, outDir);
  else if (format === 'dmg') await extractDmg(archivePath, outDir);
  else error(`Unknown format: ${format}`);
}

function findRenpyRoot(dir) {
  const entries = fsSync.readdirSync(dir, { withFileTypes: true });
  const sub = entries.find((e) => e.isDirectory() && e.name.startsWith('renpy-'));
  if (sub) return path.join(dir, sub.name);
  // macOS dmg may have different layout; use first directory that contains renpy.sh
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    try {
      fsSync.accessSync(path.join(p, 'renpy.sh'));
      return p;
    } catch (_) {}
  }
  return dir;
}

async function runVerify(sdkRoot, platform) {
  const renpySh = path.join(sdkRoot, 'renpy.sh');
  try {
    await fs.access(renpySh);
    execSync(`"${renpySh}" . --help 2>/dev/null || true`, { cwd: sdkRoot, stdio: 'pipe' });
    log('Ren\'Py SDK verified (renpy.sh found).', 'green');
  } catch (_) {
    log(`Ren'Py SDK installed at: ${sdkRoot}`, 'cyan');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = process.env.RENPY_VERSION || DEFAULT_VERSION;
  const platform = process.platform;
  const { ext, format } = getPlatformConfig(platform);

  const targetDir = sdkDir(version);
  const exists = await fs.access(targetDir).then(() => true).catch(() => false);
  if (exists && !args.force) {
    log(`Ren'Py ${version} already installed at ${targetDir}. Use --force to reinstall.`, 'green');
    if (args.web) await installRenpyweb(targetDir, version, args.force);
    return;
  }

  if (exists && args.force) {
    log(`Removing existing ${targetDir}...`, 'yellow');
    await fs.rm(targetDir, { recursive: true, force: true });
  }

  await fs.mkdir(VENDOR_RENPY, { recursive: true });
  const sdkUrl = `${BASE_URL}/${version}/renpy-${version}-sdk.${ext}`;
  const archivePath = path.join(VENDOR_RENPY, `renpy-${version}-sdk.${ext}`);

  log(`Downloading Ren'Py ${version} SDK (${platform})...`, 'cyan');
  await download(sdkUrl, archivePath);
  log('Extracting...', 'cyan');
  const extractDir = path.join(VENDOR_RENPY, `extract-${version}`);
  await extractSdk(archivePath, format, extractDir);
  const extractedRoot = findRenpyRoot(extractDir);
  await fs.rename(extractedRoot, targetDir);
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.unlink(archivePath).catch(() => {});

  if (args.web) await installRenpyweb(targetDir, version, false);
  await runVerify(targetDir, platform);
  log(`Done. SDK at: ${targetDir}`, 'green');
}

async function installRenpyweb(sdkRoot, version, force) {
  const webDir = path.join(sdkRoot, 'web');
  const exists = await fs.access(webDir).then(() => true).catch(() => false);
  if (exists && !force) {
    log('Renpyweb already present. Use --force to reinstall.', 'green');
    return;
  }
  if (exists) await fs.rm(webDir, { recursive: true, force: true });

  const url = `${BASE_URL}/${version}/renpy-${version}-web.zip`;
  const zipPath = path.join(VENDOR_RENPY, `renpy-${version}-web.zip`);
  log('Downloading Renpyweb (web platform support)...', 'cyan');
  await download(url, zipPath);
  const tempExtract = path.join(VENDOR_RENPY, `web-extract-${version}`);
  await fs.mkdir(tempExtract, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(tempExtract, true);
  const entries = await fs.readdir(tempExtract);
  const webEntry = entries.find((e) => e === 'web' || e.startsWith('renpy-'));
  const src = path.join(tempExtract, webEntry || entries[0]);
  const contents = await fs.readdir(src);
  const webSrc = contents.includes('web') ? path.join(src, 'web') : src;
  await fs.mkdir(path.dirname(webDir), { recursive: true });
  await fs.cp(webSrc, webDir, { recursive: true });
  await fs.rm(tempExtract, { recursive: true, force: true });
  await fs.unlink(zipPath).catch(() => {});
  log('Renpyweb installed.', 'green');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
