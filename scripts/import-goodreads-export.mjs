import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

// Adds books from a Goodreads library export (the "read" shelf) that are not on the site yet.
//
//   node scripts/import-goodreads-export.mjs [path/to/goodreads_library_export.csv] [--dry-run]
//
// Goodreads no longer serves shelf RSS feeds and shelves need a signed-in session, so the
// export from https://www.goodreads.com/review/import ("Export Library") is the source.
// Existing books are left alone, including their smoothed dates. New books get the
// export's Date Read (or Date Added when no read date was set), the star rating, and a
// cover from the book's Goodreads page.

const workspaceDir = process.cwd();
const dataFile = path.join(workspaceDir, 'items_data.js');
const coversDir = path.join(workspaceDir, 'images', 'covers');
const defaultCsvPath = path.join(workspaceDir, 'data-source', 'goodreads', 'goodreads_library_export.csv');
const htmlFiles = [
  path.join(workspaceDir, 'index.html'),
  path.join(workspaceDir, 'index-grouped-by-month.html'),
];
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function loadItems(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__items__ = items;`, context);
  return context.__items__;
}

function escapeString(value) {
  return JSON.stringify(value);
}

function serializeItems(items) {
  const rows = items.map((item) => {
    return `{title:${escapeString(item.title)},author:${escapeString(item.author)},type:${escapeString(item.type)},date_read:${escapeString(item.date_read)},rating:${item.rating},cover:${escapeString(item.cover)},id:${escapeString(item.id)},ya:${item.ya}}`;
  });

  return `const items = [\n${rows.join(',\n')}\n];\n`;
}

// RFC 4180 parser: quoted fields may hold commas, doubled quotes and line breaks
// (Goodreads reviews and private notes often do).
function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^﻿/, '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }

  const [headers, ...rows] = records.filter((row) => row.some((value) => value !== ''));
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

// Matches the site's existing titles: series and edition notes in a trailing
// parenthetical are dropped ("Swann’s Way (In Search of Lost Time, #1)" -> "Swann’s Way").
function cleanTitle(raw) {
  let title = raw.trim();
  const bracketed = title.match(/^\[\s*(.+?)\s+By\s+.+\]$/);
  if (bracketed) title = bracketed[1];
  const stripped = title.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, '').trim();
  return stripped || title;
}

function normalizeDate(value) {
  const match = (value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'user-agent': USER_AGENT, accept: 'image/*,*/*;q=0.8', referer: 'https://www.goodreads.com/' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  // Covers are saved as .jpg, so anything that is not a real JPEG counts as no cover.
  if (bytes.length < 1000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`Not a JPEG cover (${bytes.length} bytes) at ${url}`);
  }
  await fs.writeFile(destination, bytes);
}

async function fetchCover(bookId, destination) {
  const html = await fetchText(`https://www.goodreads.com/book/show/${bookId}`);
  const coverUrl = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || [])[1];
  // Unknown IDs still return 200 with the generic Goodreads share image, and books
  // without art use a "nophoto" placeholder: only a real cover lives under /books/.
  if (!coverUrl || !/\/books\//.test(coverUrl) || /nophoto/i.test(coverUrl)) {
    throw new Error(`No cover on the Goodreads page for ${bookId}`);
  }
  await downloadFile(coverUrl.replace(/&amp;/g, '&'), destination);
}

function todayStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function nextSuffix(suffix) {
  if (!suffix) return 'a';
  const code = suffix.charCodeAt(0);
  return code >= 97 && code < 122 ? String.fromCharCode(code + 1) : 'a';
}

// Same cache-key scheme as scripts/update-bookmeter-fast.mjs (items_data.js?v=YYYYMMDDx).
async function bumpItemsCacheKeys() {
  const versions = [];
  for (const file of htmlFiles) {
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(/items_data\.js\?v=(\d{8})([a-z]?)/g)) {
      versions.push({ date: match[1], suffix: match[2] || '' });
    }
  }

  const today = todayStamp();
  const latest = versions
    .sort((left, right) => left.date.localeCompare(right.date) || left.suffix.localeCompare(right.suffix))
    .at(-1);
  const version = !latest || latest.date < today ? `${today}a` : `${latest.date}${nextSuffix(latest.suffix)}`;

  for (const file of htmlFiles) {
    const source = await fs.readFile(file, 'utf8');
    const updated = source.replace(/items_data\.js\?v=\d{8}[a-z]?/g, `items_data.js?v=${version}`);
    if (updated !== source) await fs.writeFile(file, updated);
  }

  return version;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvPath = args.find((arg) => !arg.startsWith('--')) || defaultCsvPath;

  const [dataSource, csvSource] = await Promise.all([
    fs.readFile(dataFile, 'utf8'),
    fs.readFile(csvPath, 'utf8'),
  ]);

  const items = loadItems(dataSource);
  const rows = parseCsv(csvSource);
  if (!rows.length || !('Book Id' in rows[0]) || !('Exclusive Shelf' in rows[0])) {
    throw new Error(`${csvPath} does not look like a Goodreads library export.`);
  }

  const readRows = rows.filter((row) => row['Exclusive Shelf'] === 'read' && row['Book Id']);
  const existingIds = new Set(items.map((item) => item.id));
  const existingPairs = new Set(
    items
      .filter((item) => item.type === 'book')
      .map((item) => `${normalizeText(item.title)}|||${normalizeText(item.author)}`)
  );

  const newRows = readRows.filter((row) => {
    if (existingIds.has(`gr-${row['Book Id']}`)) return false;
    return !existingPairs.has(`${normalizeText(cleanTitle(row.Title))}|||${normalizeText(row.Author)}`);
  });

  const added = [];
  const missingCovers = [];
  if (!dryRun) await fs.mkdir(coversDir, { recursive: true });

  for (const row of newRows) {
    const id = `gr-${row['Book Id']}`;
    const filename = `${id}.jpg`;
    let cover = path.posix.join('images', 'covers', filename);

    if (!dryRun) {
      try {
        await fetchCover(row['Book Id'], path.join(coversDir, filename));
      } catch (error) {
        missingCovers.push(`${row.Title}: ${error.message}`);
        cover = '';
      }
    }

    const item = {
      title: cleanTitle(row.Title),
      author: row.Author.trim(),
      type: 'book',
      date_read: normalizeDate(row['Date Read']) || normalizeDate(row['Date Added']),
      rating: Number.parseInt(row['My Rating'], 10) || 0,
      cover,
      id,
      ya: false,
    };
    items.push(item);
    added.push({ ...item, dateSource: normalizeDate(row['Date Read']) ? 'Date Read' : 'Date Added' });
  }

  let cacheKey = null;
  if (!dryRun && added.length) {
    await fs.writeFile(dataFile, serializeItems(items));
    cacheKey = await bumpItemsCacheKeys();
  }

  console.log(JSON.stringify({
    csv: path.relative(workspaceDir, csvPath) || csvPath,
    dryRun,
    readRows: readRows.length,
    added: added.length,
    skippedExisting: readRows.length - added.length,
    cacheKey,
    books: added.map((item) => `${item.date_read} (${item.dateSource}) ${item.title} — ${item.author}${item.rating ? ` ★${item.rating}` : ''}`),
    missingCovers,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
