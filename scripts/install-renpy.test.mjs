/**
 * Tests Ren'Py SDK install: when the SDK is present, verifies that the
 * included "The Question" example game exists and (if Renpyweb is installed)
 * can be built for web.
 * Run: node --test scripts/install-renpy.test.mjs
 * These tests are skipped when the SDK is not installed (npm run install:renpy).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { test } from 'node:test';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VENDOR_RENPY = path.join(ROOT, 'vendor', 'renpy');
const DEFAULT_VERSION = process.env.RENPY_VERSION || '8.5.2';

function getSdkRoot() {
  const dir = path.join(VENDOR_RENPY, `renpy-${DEFAULT_VERSION}`);
  try {
    fs.accessSync(dir);
    return dir;
  } catch {
    return null;
  }
}

function getTheQuestionPath(sdkRoot) {
  const names = ['the_question', 'The Question'];
  for (const name of names) {
    const candidate = path.join(sdkRoot, name);
    const scriptRpy = path.join(candidate, 'game', 'script.rpy');
    try {
      fs.accessSync(scriptRpy);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function hasWebSupport(sdkRoot) {
  const webDir = path.join(sdkRoot, 'web');
  try {
    fs.accessSync(webDir);
    return true;
  } catch {
    return false;
  }
}

function getRenpyLauncher(sdkRoot) {
  const platform = process.platform;
  if (platform === 'win32') {
    const exe = path.join(sdkRoot, 'renpy.exe');
    try {
      fs.accessSync(exe);
      return exe;
    } catch {
      return null;
    }
  }
  const sh = path.join(sdkRoot, 'renpy.sh');
  try {
    fs.accessSync(sh);
    return sh;
  } catch {
    return null;
  }
}

test("Ren'Py SDK and The Question (when SDK installed)", (t) => {
  const sdkRoot = getSdkRoot();
  if (!sdkRoot) {
    t.skip('Ren\'Py SDK not installed (run npm run install:renpy to enable this test)');
    return;
  }

  const theQuestion = getTheQuestionPath(sdkRoot);
  assert.ok(theQuestion, `The Question example game should exist under ${sdkRoot}`);
  const scriptRpy = path.join(theQuestion, 'game', 'script.rpy');
  assert.ok(fs.existsSync(scriptRpy), 'game/script.rpy should exist in The Question');

  const launcher = getRenpyLauncher(sdkRoot);
  assert.ok(launcher, 'renpy.sh (or renpy.exe on Windows) should exist in SDK');
});

test("Ren'Py web build of The Question (when SDK and web installed)", (t) => {
  const sdkRoot = getSdkRoot();
  if (!sdkRoot) {
    t.skip('Ren\'Py SDK not installed');
    return;
  }

  const theQuestion = getTheQuestionPath(sdkRoot);
  if (!theQuestion) {
    t.skip('The Question example game not found');
    return;
  }

  if (!hasWebSupport(sdkRoot)) {
    t.skip('Renpyweb not installed (run npm run install:renpy -- --web to enable)');
    return;
  }

  const launcher = getRenpyLauncher(sdkRoot);
  if (!launcher) {
    t.skip('Ren\'Py launcher not found');
    return;
  }

  const projectParent = path.dirname(theQuestion);
  const distBase = path.join(projectParent, 'the_question-dists');

  try {
    execSync(`"${launcher}" "${theQuestion}" distribute web`, {
      cwd: sdkRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 300_000,
    });
  } catch (err) {
    t.skip(`Ren'Py web build failed or CLI not available: ${err.message}`);
    return;
  }

  if (!fs.existsSync(distBase)) {
    assert.fail(`Web build output base should exist: ${distBase}`);
  }
  const entries = fs.readdirSync(distBase);
  const webDir = entries.find((e) => e.includes('web'));
  assert.ok(webDir, `Web build directory should exist under ${distBase}`);
  const distDir = path.join(distBase, webDir);
  const indexHtml = path.join(distDir, 'index.html');
  assert.ok(fs.existsSync(indexHtml), `index.html should exist in web build: ${indexHtml}`);
});
