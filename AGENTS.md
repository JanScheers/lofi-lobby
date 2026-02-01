# Agent instructions

## Verify Code changes

- **Run the tests**

  ```bash
  npm run test
  ```

If you change `scripts/update-game.mjs`, `scripts/remove-game.mjs`, or `scripts/install-renpy.mjs`, run this test and fix any failures before committing.

## Ren'Py SDK

The Ren'Py SDK is optional. It is not installed by default. To install it (e.g. for building Ren'Py games for web), run:

```bash
npm run install:renpy
```

The SDK is placed in `vendor/renpy/` (gitignored).
