# Tracking Site

Static site for browsing tracked books and movies.

## Run locally

From the project root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Files

- `index.html`: UI and client-side rendering
- `items_data.js`: tracked books and movies
- `likes_data.js`: generated Letterboxd liked-movie set used by the favorites filter
- `stats_data.js`: generated reading, watching, and wage stats shown in the header
- `images/covers/`: local cover images
- `data-source/`: raw source exports kept in the repo for reproducible rebuilds
- `scripts/`: maintenance scripts for imports, covers, and derived data

## Source data

This repo is set up to be self-contained. The checked-in raw exports live here:

- `data-source/goodreads/goodreads_library_export.csv`
- `data-source/letterboxd/diary.csv`
- `data-source/letterboxd/ratings.csv`
- `data-source/letterboxd/watched.csv`
- `data-source/letterboxd/likes/films.csv`

Bookmeter is the only exception: those books were imported from the live Bookmeter site, not from a local export file.

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
```
