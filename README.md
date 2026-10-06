# Tracking Site

Static site for browsing tracked books, movies, anime, and TV.

## Run locally

From the project root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

If you want the daily log input box to use GPT-5.4 and update the page locally, use the Node server instead:

```bash
OPENAI_API_KEY=your_key_here node scripts/local-server.mjs
```

That serves the whole site on `http://localhost:8000` and enables the AI-powered form on [`daylog-k7m2.html`](daylog-k7m2.html). GitHub Pages stays static, so the GPT-backed form only works when you run the local server with an API key.

## Files

- `index.html`: UI and client-side rendering
- `anime.html`: dedicated anime page
- `tv.html`: dedicated TV page
- `stats.html`: compact stats page
- `listening.html`: Spotify listening history (music and podcasts since 2014)
- `goals.html`: private goals dashboard (unlisted, `noindex`, not linked from any page)
- `items_data.js`: tracked books and movies
- `anime_data.js`: generated grouped anime data
- `tv_data.js`: generated TV data
- `likes_data.js`: generated Letterboxd liked-movie set used by the favorites filter
- `stats_data.js`: generated reading, watching, and wage stats shown in the header
- `listening_data.js`: generated Spotify listening aggregates used by the listening page
- `goals_data.js`: generated goal definitions and completed days
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
- `styles/listening-page.css`: listening page styling
- `styles/goals-page.css`: goals page styling
- `scripts/page-utils.js`: shared client-side helpers for page rendering
- `scripts/anime-page.js`: anime page behavior
- `scripts/tv-page.js`: TV page behavior
- `scripts/stats-page.js`: stats page behavior
- `scripts/listening-page.js`: listening page behavior
- `scripts/goals-page.js`: goals page behavior

## Source data

This repo is set up to be self-contained. The checked-in raw exports live here:

- `data-source/goodreads/goodreads_library_export.csv`
- `data-source/letterboxd/diary.csv`
- `data-source/letterboxd/ratings.csv`
- `data-source/letterboxd/watched.csv`
- `data-source/letterboxd/likes/films.csv`

Bookmeter is the only exception: those books were imported from the live Bookmeter site, not from a local export file.

Spotify is the other exception: the raw export logs the IP address of every stream, so it stays out of the repo and only the aggregates in `listening_data.js` are committed.

TV is currently sourced from:

- `data-source/tv/shows.json`

Daily log entries are currently sourced from:

- `data-source/daylog/entries.json`

Goals are currently sourced from:

- `data-source/goals/goals.json`

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

## Fast Bookmeter publish

For the default "update from Bookmeter and publish" workflow, prioritize getting the main site deployed quickly:

```bash
node scripts/update-bookmeter-fast.mjs
git add items_data.js index.html index-grouped-by-month.html images/covers/
git commit -m "Update Bookmeter reading data"
git push origin main
```

This fast path intentionally does not run `node scripts/build-consumption-stats.mjs`, rebuild `stats_data.js`, update `stats.html`, or rebuild `display_metadata.js`. Only refresh stats/metadata when explicitly requested.

## Update Spotify listening

Request the Extended Streaming History from Spotify's privacy page, unzip it, then:

```bash
node scripts/build-listening-data.mjs ~/Downloads/my_spotify_data
```

Point it at the unzipped folder that holds the `Streaming_History_Audio_*.json` files. It rewrites `listening_data.js`; bump the `?v=` cache key on that script tag in `listening.html`, then commit both files to publish.

## Update Goodreads book dates

```bash
node scripts/update-book-dates-from-goodreads-export.mjs
```

You can still pass a CSV path explicitly if you want to use a different export.
The site currently uses redistributed Goodreads dates for display, so if you want the smoothed timeline back afterward, rerun `node scripts/redistribute-goodreads-book-dates.mjs`.

## Update Letterboxd movie dates

```bash
node scripts/import-letterboxd-rss.mjs
node scripts/update-movie-dates-from-letterboxd-diary.mjs
```

## Rebuild generated support files

```bash
node scripts/build-liked-movie-data.mjs
node scripts/build-consumption-stats.mjs
node scripts/build-tv-data.mjs
node scripts/build-daylog-data.mjs
node scripts/build-goals-data.mjs
```

## Track goals

Goals are updated by hand. `data-source/goals/goals.json` is the source of truth, and
`goals.html` reads the generated `goals_data.js`.

Mark today done for a goal:

```bash
node scripts/build-goals-data.mjs --done kanji-writing
```

Undo it, or log a different day:

```bash
node scripts/build-goals-data.mjs --undo kanji-writing
node scripts/build-goals-data.mjs --done kanji-writing --date=2026-08-21
```

Both commands update `goals.json` and rebuild `goals_data.js`. You can also edit the
`done` list in `goals.json` directly and then rebuild:

```bash
node scripts/build-goals-data.mjs
```

Commit `data-source/goals/goals.json` and `goals_data.js` together to publish.

Days roll over at 4 AM, matching the Anki day used by the daily log, so a late-night
session still counts toward the day before. Streaks and completion rates are worked out
in the browser against the current date, so the page stays correct without a rebuild.

The page is deliberately unlisted: it carries a `noindex` tag and nothing links to it, so
it is only reachable by typing the URL. It is not added to `robots.txt`, because that file
is public and a `Disallow` line there would advertise the path while also stopping crawlers
from ever reading the `noindex` tag.

### Goal fields

- `id`, `title`, `startDate`: required.
- `context`, `description`, `active`: optional.
- `trackedFrom`: optional, defaults to `startDate`. Days on or after it count against the
  goal, so an unlisted day is a missed day. Days before it only count when they are listed
  in `done`; anything else renders as "no record" and stays out of the streak and rate math.
  This is what keeps a sparse backfill from turning every unrecorded day into a miss.

## Import Anki history into a goal

`scripts/import-anki-goal-history.mjs` is a one-shot backfill. It does not install anything
and does not run in the background.

Read a deck straight from the local Anki collection:

```bash
node scripts/import-anki-goal-history.mjs --goal kanji-writing --deck "漢字書き取り"
```

Add `--list-decks` to print the exact deck names, `--dry-run` to preview without writing,
`--min-reviews N` to require more than one review before a day counts, and
`--collection <path>` if the collection is not at
`~/Library/Application Support/Anki2/User 1/collection.anki2`.

Subdecks are included, cards sitting in a filtered deck count toward their home deck, and
manual reschedules are ignored. Because the Anki review log is complete, this import also
moves `trackedFrom` back to the first review day: from that day on, a day with no reviews
really was a missed day.

The fallback source is the daily log, which only holds whole-collection totals for the
handful of days it recorded:

```bash
node scripts/import-anki-goal-history.mjs --goal kanji-writing --from-daylog
```

That source is sparse and not deck-specific, so it leaves `trackedFrom` alone and the
unrecorded days stay as "no record" rather than misses.

Both modes merge into the existing `done` list rather than replacing it, so re-running is
safe. Fix an individual day afterwards with `--done` / `--undo` on
`scripts/build-goals-data.mjs`.

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
