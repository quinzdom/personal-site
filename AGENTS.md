# Agent Instructions

- For requests like "update the site from Bookmeter and publish", use the fast Bookmeter path.
- Run `node scripts/update-bookmeter-fast.mjs`, then commit and push `main`.
- dcdnt.xyz is served by the Cloudflare Worker `personal-site`, not GitHub Pages. Cloudflare Workers Builds deploys it on every push to `main` using `wrangler.jsonc` (static assets from the repo root; `.assetsignore` keeps dotfiles out). The GitHub Pages workflow is turned off.
- The home page `/` is the photo page (`pictures.html`), served by the Worker; the tracker is `index.html` at `/tracker`. Don't rename `index.html`: the Bookmeter scripts and Action write to it. Tracker pages link home as `/tracker`.
- Keep the default scope to `items_data.js`, new `images/covers/` files, and the `items_data.js` cache keys in `index.html` and `index-grouped-by-month.html`.
- Do not run `node scripts/build-consumption-stats.mjs`, update `stats_data.js`, update `stats.html`, or rebuild `display_metadata.js` unless the user explicitly asks for stats/metadata refreshes.
- Bookmeter answers some cloud and sandbox networks with HTTP 503 on every page. If that happens, the "Import Bookmeter & Refresh Recommendations" GitHub Actions workflow (Run workflow) does the same import from GitHub's runners.
- For Goodreads there is no live feed: shelf RSS is gone and shelves need a sign-in. Get a fresh library export from https://www.goodreads.com/review/import, save it over `data-source/goodreads/goodreads_library_export.csv`, run `node scripts/import-goodreads-export.mjs`, and commit that CSV along with the same files as the Bookmeter path.
