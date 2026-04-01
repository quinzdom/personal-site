import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const CONCURRENCY = 6;

function loadItems(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__items__ = items;`, context);
  return context.__items__;
}

function escapeString(value) {
  return JSON.stringify(value);
}

function slugifyId(id) {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function serializeItems(items) {
  const rows = items.map((item) => {
    return `{title:${escapeString(item.title)},author:${escapeString(item.author)},type:${escapeString(item.type)},date_read:${escapeString(item.date_read)},rating:${item.rating},cover:${escapeString(item.cover)},id:${escapeString(item.id)},ya:${item.ya}}`;
  });

  return `const items = [\n${rows.join(',\n')}\n];\n`;
}

function extractBoxdCode(id) {
  const match = id.match(/boxd\.it\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

function extractFilmId(html) {
  const match = html.match(/data-film-id="(\d+)"/);
  return match ? match[1] : null;
}

function extractPosterUrl(html, filmId) {
  if (filmId) {
    const escapedFilmId = filmId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filmPosterPattern = new RegExp(`https://a\\.ltrbxd\\.com/resized/film-poster/[^"'\\s<]*?/${escapedFilmId}-[^"'\\s<]*`, 'i');
    const filmPosterMatch = html.match(filmPosterPattern);
    if (filmPosterMatch) return filmPosterMatch[0];
  }

  const genericPosterMatches = [...html.matchAll(/https:\/\/a\.ltrbxd\.com\/[^"'\s<]*?-0-230-0-345-crop[^"'\s<]*/gi)]
    .map((match) => match[0])
    .filter((url) => !url.includes('/avatar/'));
  return genericPosterMatches[0] || null;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex letterboxd poster refresher)',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex letterboxd poster refresher)',
      accept: 'image/*,*/*;q=0.8',
      referer: 'https://letterboxd.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, bytes);
}

async function processItem(item) {
  const code = extractBoxdCode(item.id);
  if (!code) {
    return { ok: false, reason: 'missing-boxd-code' };
  }

  const html = await fetchText(`https://boxd.it/${code}`);
  const filmId = extractFilmId(html);
  const posterUrl = extractPosterUrl(html, filmId);
  if (!posterUrl) {
    return { ok: false, reason: 'missing-poster-url' };
  }

  const filename = `${slugifyId(item.id)}.jpg`;
  const absolutePath = path.join(coversDir, filename);
  await downloadFile(posterUrl, absolutePath);
  item.cover = path.posix.join('images', 'covers', filename);

  return { ok: true, posterUrl, filename };
}

async function mapLimit(values, limit, iteratee) {
  const results = new Array(values.length);
  let index = 0;

  async function worker() {
    while (index < values.length) {
      const current = index;
      index += 1;
      results[current] = await iteratee(values[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, values.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function removeExistingMovieCovers() {
  const names = await fs.readdir(coversDir).catch(() => []);
  const removals = names
    .filter((name) => name.startsWith('lb-'))
    .map((name) => fs.rm(path.join(coversDir, name), { force: true }));
  await Promise.all(removals);
  return removals.length;
}

async function main() {
  await fs.mkdir(coversDir, { recursive: true });

  const source = await fs.readFile(dataFile, 'utf8');
  const items = loadItems(source);
  const movies = items.filter((item) => item.type === 'movie');

  const removed = await removeExistingMovieCovers();
  const results = await mapLimit(movies, CONCURRENCY, async (item) => {
    try {
      return { id: item.id, title: item.title, ...(await processItem(item)) };
    } catch (error) {
      return { id: item.id, title: item.title, ok: false, reason: String(error) };
    }
  });

  await fs.writeFile(dataFile, serializeItems(items));

  const summary = {
    removed,
    processed: movies.length,
    downloaded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    failures: results.filter((result) => !result.ok).slice(0, 20),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
