# Lofi Lobby

A portfolio site for indie games built with [Astro](https://astro.build). Games are browsable in a grid, with playable web builds embedded in iframes and download links for others.

## Features

- Responsive game portfolio grid with filtering and sorting
- Game detail pages with embedded iframe for web-playable games
- Full-screen mode for immersive gameplay
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

```bash
npm run update-game -- <game-id> <path-to-zip> [--version <version>] [--dry-run]
```

**Examples:**

```bash
npm run update-game -- my-game ./incoming/my-game-v1.0.0.zip
npm run update-game -- my-game ./incoming/my-game.zip --version 1.2.0
npm run update-game -- my-game ./incoming/my-game.zip --dry-run
```

**Zip structure:** Either `index.html` at the root, or one folder containing `index.html` (flattened automatically).

**After updating:** Add a thumbnail at `public/images/games/<game-id>.png` (16:9 recommended), then `npm run build` and deploy `dist/`.

## Project Structure

```
lofi-lobby/
├── public/
│   ├── games/<id>/      # Extracted web builds (gitignored)
│   ├── downloads/       # Game zips for download (gitignored)
│   └── images/games/    # Game thumbnails
├── scripts/
│   └── update-game.mjs  # Game update script
├── src/
│   ├── components/
│   │   ├── GameCard.astro
│   │   └── Layout.astro
│   ├── data/
│   │   └── games.json   # Game catalog metadata
│   └── pages/
│       ├── index.astro  # Portfolio grid
│       └── games/
│           └── [id].astro  # Game detail page
├── package.json
└── README.md
```

## Game Metadata

Games are defined in `src/data/games.json`:

```json
{
  "games": [
    {
      "id": "my-game",
      "name": "My Game",
      "type": "html",
      "version": "1.0.0",
      "description": "A short description of the game.",
      "thumbnail": "/images/games/my-game.png",
      "playable": true,
      "downloadUrl": "/downloads/my-game.zip",
      "lastUpdated": "2026-02-01"
    }
  ]
}
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
| `downloadUrl` | string | Path to download zip (or external URL) |
| `lastUpdated` | string | ISO date of last update |

## License

MIT
