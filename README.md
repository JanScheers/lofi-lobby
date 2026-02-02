# Lofi Lobby

A portfolio site for indie games built with [Astro](https://astro.build). Games are browsable in a grid; clicking a playable game opens it in the browser, and download links are available for others.

## Features

- Responsive game portfolio grid with filtering and sorting
- Game detail pages with Play and Download actions for web-playable games
- Direct links to games (no iframe); playable at `/play/<game-id>/<entry>.html`
- Download links for all games
- Low-effort game updates via a single script

## Getting Started

Requires Node.js 18+ and npm.

```bash
npm install
npm run dev      # Development
npm run build    # Production build → dist/
npm run preview  # Preview production build
```

## Adding/Updating Games

### How to add a game

1. **Run the add-game command** from the project root:

   ```bash
   npm run add-game -- <game-id> <path-to-zip>
   ```

   - `<game-id>` — URL slug for the game (e.g. `my-game`, `space-shooter`).
   - `<path-to-zip>` — Path to the game’s zip file (e.g. `./my-game.zip` or `./incoming/space-shooter-v1.0.0.zip`).

2. **Answer the prompts:**
   - **Version** — Enter a version (e.g. `1.0.0`) if it wasn’t detected from the filename.
   - **Entry HTML** — If the zip has more than one `.html` file at the root, the script lists them and asks which one is the game’s entry point. Enter the number (e.g. `1`) or the filename (e.g. `index.html`).
   - **New games only:** name, type (`html` / `renpy` / `rpgmaker` / `download-only`), and description.

3. **Thumbnail:** The script looks for an image inside the zip (e.g. `thumbnail.png`, `screenshot.jpg`, `cover.png`, or any `.png`/`.jpg`/`.webp`/`.gif`) and copies it to `public/images/games/<game-id>.<ext>`. Root-level images and filenames containing “thumbnail”, “screenshot”, “cover”, “banner”, “logo”, etc. are preferred. If none is found, add a 16:9 image manually at `public/images/games/<game-id>.png`.

4. **Build and deploy:** Run `npm run build`, then deploy `dist/`. The build does **not** copy game files into `dist/`; instead `dist/play` is a symlink to the project-root `play/` folder. When serving from `dist/` (e.g. `npm run preview` or a host that follows symlinks), keep `play/` next to `dist/` so the symlink resolves. Otherwise serve `/play/` from the project’s `play/` folder on your host.

**Optional flags:**

| Flag | Description |
|------|-------------|
| `--version <version>` | Set version without prompting (e.g. `--version 1.2.0`). |
| `--dry-run` | Show what would happen without writing files or metadata. |

**Examples:**

```bash
# Add or update a game (prompts for version and entry HTML if needed)
npm run add-game -- my-game ./incoming/my-game-v1.0.0.zip

# Set version on the command line
npm run add-game -- my-game ./my-game.zip --version 1.2.0

# Preview changes only
npm run add-game -- my-game ./my-game.zip --dry-run
```

### Removing a game

Removes the game from the portfolio: deletes the extracted files in `play/<game-id>/`, the thumbnail, and the entry in `games.yaml`. **The original zip you used with add-game is never touched.**

```bash
npm run remove-game -- <game-id> [--dry-run]
```

Examples:

```bash
npm run remove-game -- my-game
npm run remove-game -- my-game --dry-run
```

## Deploying with nginx

If you deploy only `dist/` (no symlink or host doesn’t follow symlinks), serve the lobby from `dist/` and `/play/` from the project's `play/` folder using nginx:

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/lofi-lobby/dist;   # lobby (HTML, assets, thumbnails)

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Serve games from play/ (not from dist)
    location /play/ {
        alias /var/www/lofi-lobby/play/;
    }
}
```

Replace `/var/www/lofi-lobby` with the path to your project on the server. After `npm run build`, deploy `dist/` and `play/`; thumbnails are already in `dist/images/` from the build.

## Ren'Py SDK (optional)

To build Ren'Py games for web or other platforms, you can install the Ren'Py SDK into the project:

```bash
npm run install:renpy
```

This downloads the Ren'Py SDK (and optionally Renpyweb for web builds) into `vendor/renpy/`. Use `--web` to also install web platform support, and `--force` to reinstall:

```bash
npm run install:renpy -- --web --force
```

Set `RENPY_VERSION` to use a different version (default: 8.5.2):

```bash
RENPY_VERSION=8.4.0 npm run install:renpy
```

To install the SDK automatically when running `npm install`, set the environment variable:

```bash
INSTALL_RENPY=1 npm install
```

When the SDK is installed, `npm run test` runs additional tests that verify the included "The Question" example game is present and (if Renpyweb is installed) can be built for web. These tests are skipped when the SDK is not installed.

**Zip structure:** Any zip is accepted. The script unpacks to `play/<game-id>/`. If the zip has a single top-level folder, its contents are flattened into that directory. You choose which root-level HTML file is the game entry when prompted.

## Project Structure

```
lofi-lobby/
├── play/<id>/           # Extracted web builds (gitignored)
├── public/
│   └── images/games/    # Game thumbnails
├── vendor/
│   └── renpy/          # Ren'Py SDK (optional, gitignored; npm run install:renpy)
├── scripts/
│   ├── add-game.mjs  # Add/update game from zip
│   ├── remove-game.mjs  # Remove game (keeps original zip)
│   ├── install-renpy.mjs # Install Ren'Py SDK
│   ├── game-add-remove.test.mjs # Tests for add-game / remove-game
│   └── install-renpy.test.mjs  # Tests for SDK and The Question (skipped when SDK not installed)
├── src/
│   ├── components/
│   │   ├── GameCard.astro
│   │   └── Layout.astro
│   ├── data/
│   │   └── games.yaml   # Game catalog metadata
│   └── pages/
│       ├── index.astro  # Portfolio grid
│       └── games/
│           └── [id].astro  # Game detail page
├── package.json
└── README.md
```

## Game Metadata

Games are defined in `src/data/games.yaml`:

```yaml
games:
  - id: my-game
    name: My Game
    type: html
    version: "1.0.0"
    description: A short description of the game.
    thumbnail: /images/games/my-game.png
    playable: true
    lastUpdated: "2026-02-01"
    entryPoint: index.html
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | URL slug (e.g., `my-game`) |
| `name` | string | Display name |
| `type` | string | `html`, `renpy`, `rpgmaker`, or `download-only` |
| `version` | string | Version string (e.g., `1.0.0`) |
| `description` | string | Short description for cards |
| `thumbnail` | string | Path to thumbnail image |
| `playable` | boolean | `true` if web-playable, `false` for download-only |
| `lastUpdated` | string | ISO date of last update |
| `entryPoint` | string | Root-level HTML file used as the game entry (e.g. `index.html`). Set by the add-game script. |

## License

MIT
