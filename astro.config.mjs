// @ts-check
import { defineConfig } from 'astro/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

/**
 * Astro integration: after build, create dist/play as a symlink to project-root play/
 * so game HTML/assets are never copied into dist/ but /play/ still works when
 * serving from dist/ (e.g. local preview or a host that follows symlinks).
 */
function symlinkPlayInDist() {
  return {
    name: 'symlink-play-in-dist',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const outDir = fileURLToPath(dir);
        const root = path.resolve(outDir, '..');
        const playLink = path.join(outDir, 'play');
        if (fs.existsSync(playLink)) {
          fs.rmSync(playLink, { recursive: true });
        }
        // Symlink dist/play -> play/ at project root (relative so it's portable)
        const target = path.relative(outDir, path.join(root, 'play'));
        fs.symlinkSync(target, playLink, 'dir');
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  integrations: [symlinkPlayInDist()],
});
