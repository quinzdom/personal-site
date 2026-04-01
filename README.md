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
- `images/covers/`: local cover images
- `scripts/`: maintenance scripts for covers and Goodreads date imports

## Update Goodreads book dates

```bash
node scripts/update-book-dates-from-goodreads-export.mjs '/path/to/goodreads_library_export.csv'
```
