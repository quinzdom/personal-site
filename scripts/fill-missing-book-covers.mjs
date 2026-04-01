import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const CONCURRENCY = 6;
const execFileAsync = promisify(execFile);

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

function extractGoodreadsId(id) {
  const match = id.match(/^gr-(\d+)$/);
  return match ? match[1] : null;
}

function normalizeTitle(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreOpenLibraryDoc(doc, item) {
  let score = 0;
  const docTitle = normalizeTitle(doc.title || '');
  const itemTitle = normalizeTitle(item.title);
  if (docTitle === itemTitle) score += 10;
  else if (docTitle.includes(itemTitle) || itemTitle.includes(docTitle)) score += 5;

  const docAuthor = normalizeTitle(doc.author_name?.[0] || '');
  const itemAuthor = normalizeTitle(item.author);
  if (docAuthor === itemAuthor) score += 5;
  else if (docAuthor && itemAuthor && (docAuthor.includes(itemAuthor) || itemAuthor.includes(docAuthor))) score += 2;

  if (doc.cover_i) score += 3;
  if (doc.isbn?.length) score += 1;
  return score;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex book cover filler)',
      accept: 'text/html,application/xhtml+xml,application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex book cover filler)',
      accept: 'application/json,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function extractGoodreadsCoverUrl(html, goodreadsId) {
  const patterns = [
    new RegExp(`https://m\\.media-amazon\\.com/images/S/compressed\\.photo\\.goodreads\\.com/books/[^"'\\s<)]*${goodreadsId}[^"'\\s<)]*`, 'i'),
    new RegExp(`https://i\\.gr-assets\\.com/images/S/compressed\\.photo\\.goodreads\\.com/books/[^"'\\s<)]*${goodreadsId}[^"'\\s<)]*`, 'i'),
    new RegExp(`https://i\\.gr-assets\\.com/images/S/compressed\\.photo\\.goodreads\\.com/books/[^"'\\s<)]*`, 'i'),
    new RegExp(`https://m\\.media-amazon\\.com/images/S/compressed\\.photo\\.goodreads\\.com/books/[^"'\\s<)]*`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && !match[0].includes('goodreads_wide')) {
      return match[0];
    }
  }

  return null;
}

async function findOpenLibraryCover(item) {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(item.title)}&author=${encodeURIComponent(item.author)}`;
  const json = await fetchJson(url);
  const docs = (json.docs || [])
    .map((doc) => ({ doc, score: scoreOpenLibraryDoc(doc, item) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.doc);

  for (const doc of docs) {
    if (doc.cover_i) {
      return `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
    }
    if (doc.isbn?.length) {
      return `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-M.jpg`;
    }
  }

  return null;
}

async function findGoogleBooksCover(item) {
  const query = `intitle:${item.title} inauthor:${item.author}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`;
  const json = await fetchJson(url);
  const match = (json.items || []).find((entry) => entry.volumeInfo?.imageLinks?.thumbnail || entry.volumeInfo?.imageLinks?.smallThumbnail);
  if (!match) return null;

  const image = match.volumeInfo.imageLinks.thumbnail || match.volumeInfo.imageLinks.smallThumbnail;
  return image.replace(/^http:\/\//i, 'https://');
}

async function resolveCoverCandidates(item) {
  const goodreadsId = extractGoodreadsId(item.id);
  const candidates = [];

  if (goodreadsId) {
    try {
      const html = await fetchText(`https://www.goodreads.com/book/show/${goodreadsId}`);
      const goodreadsCover = extractGoodreadsCoverUrl(html, goodreadsId);
      if (goodreadsCover) candidates.push({ url: goodreadsCover, source: 'goodreads' });
    } catch {
      // Fall through to alternate cover sources when Goodreads is unavailable.
    }
  }

  try {
    const openLibraryCover = await findOpenLibraryCover(item);
    if (openLibraryCover) candidates.push({ url: openLibraryCover, source: 'openlibrary' });
  } catch {
    // Fall through to alternate cover sources when Open Library is unavailable.
  }

  try {
    const googleBooksCover = await findGoogleBooksCover(item);
    if (googleBooksCover) candidates.push({ url: googleBooksCover, source: 'googlebooks' });
  } catch {
    // Fall through and report no cover if the final fallback is unavailable.
  }

  return candidates;
}

async function downloadCover(url, targetPath) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Codex book cover filler)',
      accept: 'image/*,*/*;q=0.8',
      referer: 'https://www.goodreads.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, bytes);
}

async function getImageDimensions(filePath) {
  const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
    encoding: 'utf8',
  });
  const width = Number((stdout.match(/pixelWidth: (\d+)/) || [])[1] || 0);
  const height = Number((stdout.match(/pixelHeight: (\d+)/) || [])[1] || 0);
  return { width, height };
}

async function isPlaceholderCover(filePath) {
  const { width, height } = await getImageDimensions(filePath);
  return width <= 1 && height <= 1;
}

async function processItem(item) {
  const candidates = await resolveCoverCandidates(item);
  if (!candidates.length) {
    return { ok: false, reason: 'no-cover-found' };
  }

  const filename = `${slugifyId(item.id)}.jpg`;
  const absolutePath = path.join(coversDir, filename);
  const tempPath = `${absolutePath}.tmp`;

  for (const candidate of candidates) {
    await downloadCover(candidate.url, tempPath);
    if (await isPlaceholderCover(tempPath)) {
      await fs.rm(tempPath, { force: true });
      continue;
    }

    await fs.rename(tempPath, absolutePath);
    item.cover = path.posix.join('images', 'covers', filename);
    return { ok: true, source: candidate.source, filename };
  }

  await fs.rm(tempPath, { force: true });
  return { ok: false, reason: 'only-placeholder-covers-found' };
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

async function main() {
  await fs.mkdir(coversDir, { recursive: true });

  const source = await fs.readFile(dataFile, 'utf8');
  const items = loadItems(source);
  const repairTargets = [];

  for (const item of items) {
    if (item.type !== 'book') continue;
    if (!item.cover) {
      repairTargets.push(item);
      continue;
    }
    try {
      const absolutePath = path.join(workspaceDir, item.cover);
      if (await isPlaceholderCover(absolutePath)) {
        repairTargets.push(item);
      }
    } catch {
      repairTargets.push(item);
    }
  }

  const results = await mapLimit(repairTargets, CONCURRENCY, async (item) => {
    try {
      return { id: item.id, title: item.title, ...(await processItem(item)) };
    } catch (error) {
      return { id: item.id, title: item.title, ok: false, reason: String(error) };
    }
  });

  await fs.writeFile(dataFile, serializeItems(items));

  const summary = {
    totalTargets: repairTargets.length,
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
