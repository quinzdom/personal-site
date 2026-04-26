# Agent Instructions

- For requests like "update the site from Bookmeter and publish", use the fast Bookmeter path.
- Run `node scripts/update-bookmeter-fast.mjs`, then commit and push `main` so GitHub Pages deploys.
- Keep the default scope to `items_data.js`, new `images/covers/` files, and the `items_data.js` cache keys in `index.html` and `index-grouped-by-month.html`.
- Do not run `node scripts/build-consumption-stats.mjs`, update `stats_data.js`, update `stats.html`, or rebuild `display_metadata.js` unless the user explicitly asks for stats/metadata refreshes.
