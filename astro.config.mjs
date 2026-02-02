// @ts-check
import { defineConfig } from 'astro/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PLAY_DIR = path.join(ROOT, 'play');

/**
 * Vite plugin: in dev, serve project-root play/ at /play/ so "Play Game" links work.
 * (Build/preview use dist/play -> play/ symlink from symlinkPlayInDist.)
 */
function servePlayInDev() {
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.webp': 'image/webp',
  };
  return {
    name: 'serve-play-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/play', (req, res, next) => {
        let urlPath = (req.url || '/').replace(/^\//, '').split('?')[0];
        if (!urlPath || urlPath === 'play') urlPath = 'index.html';
        const filePath = path.join(PLAY_DIR, decodeURIComponent(urlPath));
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(PLAY_DIR))) return next();
        fs.stat(resolved, (err, stat) => {
          if (err || !stat) return next();
          if (stat.isDirectory()) {
            const index = path.join(resolved, 'index.html');
            fs.access(index, (err) => {
              if (err) return next();
              res.setHeader('Content-Type', 'text/html');
              fs.createReadStream(index).pipe(res);
            });
            return;
          }
          const ext = path.extname(resolved).toLowerCase();
          res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
          fs.createReadStream(resolved).pipe(res);
        });
      });
    },
  };
}

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
  vite: {
    plugins: [servePlayInDev()],
  },
});
