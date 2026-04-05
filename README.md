# Tracking Site

Static site for browsing tracked books, movies, anime, and TV.

## Run locally

From the project root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Files

- `index.html`: UI and client-side rendering
- `anime.html`: dedicated anime page
- `tv.html`: dedicated TV page
- `stats.html`: compact stats page
- `items_data.js`: tracked books and movies
- `anime_data.js`: generated grouped anime data
- `tv_data.js`: generated TV data
- `likes_data.js`: generated Letterboxd liked-movie set used by the favorites filter
- `stats_data.js`: generated reading, watching, and wage stats shown in the header
- `daylog-k7m2.html`: private daily log page
- `daylog_data.js`: generated daily log data used by the private log page
- `images/covers/`: local cover images
- `data-source/`: raw source exports kept in the repo for reproducible rebuilds
- `anki-addon/`: template for the local Anki exporter add-on used by the daylog sync
- `scripts/`: maintenance scripts for imports, covers, and derived data

## Structure

The project is compacted around a few shared pieces now:

- `styles/page-chrome.css`: shared page header and nav styling
- `styles/media-grid-page.css`: shared poster-grid page styling used by anime and TV
- `styles/stats-page.css`: stats page styling
- `scripts/page-utils.js`: shared client-side helpers for page rendering
- `scripts/anime-page.js`: anime page behavior
- `scripts/tv-page.js`: TV page behavior
- `scripts/stats-page.js`: stats page behavior

## Source data

This repo is set up to be self-contained. The checked-in raw exports live here:

- `data-source/goodreads/goodreads_library_export.csv`
- `data-source/letterboxd/diary.csv`
- `data-source/letterboxd/ratings.csv`
- `data-source/letterboxd/watched.csv`
- `data-source/letterboxd/likes/films.csv`

Bookmeter is the only exception: those books were imported from the live Bookmeter site, not from a local export file.

TV is currently sourced from:

- `data-source/tv/shows.json`

Daily log entries are currently sourced from:

- `data-source/daylog/entries.json`

Then generated into `tv_data.js` with:

```bash
node scripts/build-tv-data.mjs
```

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.

To publish it:

```bash
git remote add origin <your-github-repo-url>
git add .
git commit -m "Set up GitHub Pages"
git push -u origin main
```

Then in GitHub:

1. Open the repository settings.
2. Go to `Settings` -> `Pages`.
3. Set `Source` to `GitHub Actions`.

Every push to `main` will redeploy the site.

## Update Goodreads book dates

```bash
node scripts/update-book-dates-from-goodreads-export.mjs
```

You can still pass a CSV path explicitly if you want to use a different export.
The site currently uses redistributed Goodreads dates for display, so if you want the smoothed timeline back afterward, rerun `node scripts/redistribute-goodreads-book-dates.mjs`.

## Update Letterboxd movie dates

```bash
node scripts/update-movie-dates-from-letterboxd-diary.mjs
```

## Rebuild generated support files

```bash
node scripts/build-liked-movie-data.mjs
node scripts/build-consumption-stats.mjs
node scripts/build-tv-data.mjs
node scripts/build-daylog-data.mjs
```

## Sync Anki into the daily log

The Anki sync is split into two small pieces:

- a local Anki add-on that exports today's review totals to `~/Library/Application Support/Tracking Site/anki-latest.json`
- an hourly launch agent that reads that snapshot, updates the daylog files, and auto-commits/pushes only when the saved totals changed

Run a one-off sync:

```bash
node scripts/sync-anki-progress.mjs
```

Install the background refresh agent:

```bash
node scripts/install-anki-sync-launch-agent.mjs
```

That installs:

- `~/Library/LaunchAgents/com.yuta.tracking-site.anki-sync.plist`
- `~/Library/Application Support/Anki2/addons21/tracking_site_sync/__init__.py`

The launch agent runs hourly and on login, and it auto-commits/pushes the updated daylog files to `origin/main` only when the saved review totals changed. The sync uses a `4 AM` rollover, so reviews done before `4:00 AM` count toward the previous day. If Anki is already open when you install it, restart Anki once so the exporter add-on can start writing fresh snapshots.
