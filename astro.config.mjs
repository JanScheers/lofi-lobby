// @ts-check
import { defineConfig } from 'astro/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

/**
 * Astro integration: after build, replace dist/play with a symlink to public/play
 * so game HTML/assets are not copied into dist/ but /play/ still works when
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
        // Symlink dist/play -> public/play (relative so it's portable)
        const target = path.relative(outDir, path.join(root, 'public', 'play'));
        fs.symlinkSync(target, playLink, 'dir');
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  integrations: [symlinkPlayInDist()],
});
